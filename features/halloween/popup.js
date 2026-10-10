(() => {
  'use strict';
  const dialog = document.getElementById('halloweenPreview');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const stage = dialog.querySelector('.hw-stage');
  const canvas = dialog.querySelector('canvas');
  const fab = document.getElementById('halloweenFab');
  const fabCanvas = fab ? fab.querySelector('canvas') : null;
  const description = dialog.querySelector('.hw-description');
  const descriptionLines = [...dialog.querySelectorAll('.hw-description-line')];
  const cta = dialog.querySelector('.hw-cta');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previousFocus = document.activeElement;
  let previousOverflow = document.documentElement.style.overflow;
  const viewport = window.visualViewport;
  let paused = reducedMotion.matches;
  let requestId = 0;
  let renderer = null;
  let time = 0;
  let lastFrame = 0;
  let batsLayer = null;
  let batsTimer = 0;
  let fabRendered = false;

  function removeBats() {
    window.clearTimeout(batsTimer);
    batsTimer = 0;
    if (batsLayer) { batsLayer.remove(); batsLayer = null; }
  }

  function playBatsOnce() {
    if (paused || reducedMotion.matches || document.hidden || !dialog.open) return;
    // One short decorative pass. Native top layer avoids clipping at the dialog edge.
    const layer = document.createElement('div');
    layer.className = 'hw-bats';
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('inert', '');
    const height = viewport ? viewport.height : window.innerHeight;
    layer.style.cssText = `width:${viewport ? viewport.width : window.innerWidth}px;height:${height}px;left:${viewport ? viewport.offsetLeft : 0}px;top:${viewport ? viewport.offsetTop : 0}px;--hw-flight-height:${height + 140}px`;
    const svg = `<svg viewBox="0 0 120 64" focusable="false" aria-hidden="true">
      <g class="hw-bat-wing hw-bat-wing--left"><path d="M57 28C45 16 27 13 7 8C14 20 11 25 3 31C16 26 21 29 21 39C33 33 37 37 38 46C46 39 50 40 57 48Z"/></g>
      <g class="hw-bat-wing hw-bat-wing--right"><path d="M63 28C75 16 93 13 113 8C106 20 109 25 117 31C104 26 99 29 99 39C87 33 83 37 82 46C74 39 70 40 63 48Z"/></g>
      <path d="M55 27L54 17L59 22L61 22L66 17L65 27Q69 33 64 48L60 56L56 48Q51 33 55 27Z"/>
      <path class="hw-bat-eyes" d="M56 29L59 30L57 31ZM64 29L61 30L63 31Z"/>
    </svg>`;
    // x position, size, drift, delay and tilt; fixed values make the pass reproducible.
    const flock = [
      [16,62,45,0,-12],[78,42,-35,80,10],[43,78,22,150,-5],
      [88,54,-55,220,15],[28,66,38,300,-10],[63,46,-32,370,8],
      [7,40,30,40,-8],[55,58,-28,110,12],[35,44,40,185,-14],
      [72,70,-42,260,6],[20,48,34,335,-6],[93,38,-38,410,14]
    ];
    flock.forEach(([x,size,drift,delay,tilt]) => {
      const bat = document.createElement('span');
      bat.className = 'hw-bat';
      bat.style.cssText = `--bat-x:${x}%;--bat-size:${size}px;--bat-drift:${drift}px;--bat-delay:${delay}ms;--bat-tilt:${tilt}deg`;
      bat.innerHTML = svg;
      layer.appendChild(bat);
    });
    batsLayer = layer;
    if (typeof layer.showPopover === 'function') {
      layer.setAttribute('popover', 'manual');
      document.body.appendChild(layer);
      try { layer.showPopover(); }
      catch { layer.removeAttribute('popover'); dialog.appendChild(layer); }
    } else {
      // Older browsers still get a non-interactive pass inside the popup.
      dialog.appendChild(layer);
    }
    let completed = 0;
    layer.addEventListener('animationend', event => {
      if (event.animationName === 'hw-bat-rise' && ++completed === flock.length) removeBats();
    });
    batsTimer = window.setTimeout(removeBats, 2400);
  }

  const stop = () => { cancelAnimationFrame(requestId); requestId = 0; lastFrame = 0; };
  const close = () => dialog.close();
  dialog.querySelector('.hw-close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Visual prototype only: this CTA does not start a wager or create a payment.
  cta.addEventListener('click', close);

  // Procedural mesh: no model download, CDN, tracking, payment or game-state mutation.
  function makeRenderer(targetCanvas = canvas) {
    const gl = targetCanvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: targetCanvas === fabCanvas });
    if (!gl) return null;
    const vertexSource = `
      attribute vec3 aPosition; attribute vec3 aNormal;
      uniform vec2 uRotation; uniform float uAspect;
      varying vec3 vPosition; varying vec3 vNormal;
      vec3 rotate(vec3 p) {
        float c=cos(uRotation.x), s=sin(uRotation.x);
        vec3 q=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
        c=cos(uRotation.y); s=sin(uRotation.y);
        return vec3(q.x,c*q.y-s*q.z,s*q.y+c*q.z);
      }
      void main() {
        vec3 p=rotate(aPosition);
        vPosition=aPosition; vNormal=rotate(aNormal);
        gl_Position=vec4(p.x*.77/uAspect,(p.y-.12)*.77,-p.z*.12,1.0);
      }`;
    const fragmentSource = `
      precision mediump float;
      varying vec3 vPosition; varying vec3 vNormal;
      uniform float uMaterial;
      float side(vec2 p,vec2 a,vec2 b){return (p.x-b.x)*(a.y-b.y)-(a.x-b.x)*(p.y-b.y);}
      bool triangle(vec2 p,vec2 a,vec2 b,vec2 c){
        float d1=side(p,a,b),d2=side(p,b,c),d3=side(p,c,a);
        return !((d1<0.0||d2<0.0||d3<0.0)&&(d1>0.0||d2>0.0||d3>0.0));
      }
      void main(){
        vec3 n=normalize(vNormal); vec3 l=normalize(vec3(-.65,.85,1.3));
        float light=max(dot(n,l),0.0);
        float spec=pow(max(dot(n,normalize(l+vec3(0,0,1))),0.0),38.0);
        float rim=pow(1.0-abs(n.z),3.0);
        vec3 color;
        if(uMaterial<.5){
          float grooves=.5+.5*cos(atan(vPosition.x,vPosition.z)*10.0);
          color=mix(vec3(.56,.105,.014),vec3(1.0,.37,.038),.45+.55*grooves);
          color*=.35+.8*light;
          color+=vec3(1.0,.72,.30)*spec*.65+vec3(.60,.16,.07)*rim*.55;
          vec2 p=vPosition.xy; vec2 mirrored=vec2(abs(p.x),p.y);
          bool eye=triangle(mirrored,vec2(.22,.14),vec2(.79,.08),vec2(.58,.46));
          bool nose=triangle(p,vec2(-.115,-.13),vec2(.115,-.13),vec2(0.0,.09));
          float x=abs(p.x)/.79, upper=-.29+.24*x*x, lower=-.59+.48*x*x;
          bool mouth=x<1.0&&p.y<upper&&p.y>lower;
          bool teeth=(abs(abs(p.x)-.36)<.085&&p.y>upper-.115)||(abs(p.x)<.075&&p.y<lower+.115);
          if(vPosition.z>.58&&(eye||nose||(mouth&&!teeth))){
            color=vec3(1.0,.65,.10)*(0.9+0.1*cos(p.x*5.0));
          }
        } else if(uMaterial<1.5){
          color=vec3(.29,.24,.065)*(.45+.75*light)+vec3(.25,.15,.035)*spec;
        } else {
          color=vec3(.23,.44,.055)*(.5+.65*abs(dot(n,l)));
        }
        gl_FragColor=vec4(color,1.0);
      }`;
    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Pumpkin shader unavailable');
      return result;
    }
    const program = gl.createProgram();
    const vs = shader(gl.VERTEX_SHADER, vertexSource), fs = shader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Pumpkin renderer unavailable');
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPosition'), normal = gl.getAttribLocation(program, 'aNormal');
    const rotation = gl.getUniformLocation(program, 'uRotation'), aspect = gl.getUniformLocation(program, 'uAspect'), material = gl.getUniformLocation(program, 'uMaterial');
    const meshes = [];
    function mesh(surface, rows, columns, type) {
      const data = [], indices = [];
      for (let i=0;i<=rows;i++) for(let j=0;j<=columns;j++) {
        const u=i/rows, v=j/columns, p=surface(u,v);
        const a=surface(Math.min(.9999,u+.0001),v), b=surface(Math.max(.0001,u-.0001),v);
        const c=surface(u,v+.0001), d=surface(u,v-.0001);
        const du=a.map((x,k)=>x-b[k]), dv=c.map((x,k)=>x-d[k]);
        const n=[dv[1]*du[2]-dv[2]*du[1],dv[2]*du[0]-dv[0]*du[2],dv[0]*du[1]-dv[1]*du[0]];
        const length=Math.hypot(...n)||1;
        data.push(...p,...n.map(x=>(type===0?-x:x)/length));
        if(i<rows&&j<columns){const k=i*(columns+1)+j;indices.push(k,k+columns+1,k+1,k+1,k+columns+1,k+columns+2);}
      }
      const vertices=gl.createBuffer(), elements=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
      meshes.push({vertices,elements,count:indices.length,type});
    }
    mesh((u,v)=>{
      const theta=Math.PI*u, phi=2*Math.PI*v;
      const r=1.22*Math.pow(Math.max(0,Math.sin(theta)),.72)*(1+.075*Math.cos(10*phi));
      return [r*Math.sin(phi),Math.cos(theta)*(.99-.19*Math.pow(Math.abs(Math.cos(theta)),12)),r*Math.cos(phi)];
    },48,96,0);
    mesh((u,v)=>{
      const phi=v*Math.PI*2, r=(.145-.068*u)*(1+.12*Math.cos(phi*7));
      return [.22*u*u+r*Math.sin(phi),.77+.62*u,r*Math.cos(phi)];
    },16,24,1);
    mesh((u,v)=>[-.05-.61*u, .9+.2*Math.sin(u*Math.PI), .04+(v-.5)*.48*Math.sin(u*Math.PI)],14,6,2);
    gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);
    function resize() {
      const rect=targetCanvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
      const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
      if(targetCanvas.width!==w||targetCanvas.height!==h){targetCanvas.width=w;targetCanvas.height=h;}
      gl.viewport(0,0,w,h);gl.uniform1f(aspect,w/h);
    }
    function draw(t) {
      resize();gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      // Gentle rotation keeps the carved face readable, without distracting spins.
      gl.uniform2f(rotation,Math.sin(t*.56)*.46-.08,.08+Math.sin(t*.7)*.035);
      for(const m of meshes){
        gl.bindBuffer(gl.ARRAY_BUFFER,m.vertices);gl.enableVertexAttribArray(position);gl.enableVertexAttribArray(normal);
        gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.elements);gl.uniform1f(material,m.type);
        gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);
      }
    }
    function destroy(){gl.useProgram(null);for(const m of meshes){gl.deleteBuffer(m.vertices);gl.deleteBuffer(m.elements);}gl.deleteProgram(program);}
    return {draw,destroy};
  }

  function tick(now) {
    requestId=0;
    if(!dialog.open||document.hidden||paused||!renderer) return;
    if(!lastFrame||now-lastFrame>=32){time+=lastFrame?Math.min(now-lastFrame,100)/1000:0;lastFrame=now;renderer.draw(time);}
    requestId=requestAnimationFrame(tick);
  }
  function syncMotion() {
    stop();dialog.classList.toggle('hw-paused',paused);
    if(paused) removeBats();
    if(renderer&&dialog.open){renderer.draw(time);if(!paused&&!document.hidden)requestId=requestAnimationFrame(tick);}
  }
  const onVisibility=()=>{if(document.hidden){stop();removeBats();}else syncMotion();};
  const onReducedMotion=()=>{paused=reducedMotion.matches;syncMotion();};
  function fitDescription() {
    if(!dialog.open||!description||descriptionLines.length!==2) return;
    // Measure actual font metrics, including the bold phrases, rather than
    // guessing a font size from the device name or viewport breakpoint.
    description.style.setProperty('--hw-description-size','20px');
    const available=description.getBoundingClientRect().width;
    const longest=Math.max(...descriptionLines.map(line=>line.getBoundingClientRect().width));
    if(available>1&&longest>0){
      const size=Math.floor(Math.min(20,20*(available-1)/longest)*100)/100;
      description.style.setProperty('--hw-description-size',size+'px');
    }
  }
  function fitViewport() {
    const height=viewport?viewport.height:window.innerHeight;
    const width=viewport?viewport.width:window.innerWidth;
    dialog.style.setProperty('--hw-visible-height',height+'px');
    dialog.style.setProperty('--hw-visible-width',width+'px');
    dialog.style.setProperty('--hw-offset-top',(viewport?viewport.offsetTop:0)+'px');
    dialog.style.setProperty('--hw-offset-left',(viewport?viewport.offsetLeft:0)+'px');
    dialog.dataset.density=height<570?'micro':height<660?'tight':height<780?'compact':'full';
  }
  const onResize=()=>{if(!dialog.open)return;fitViewport();fitDescription();if(renderer)renderer.draw(time);};
  let observedWidth=0;
  const descriptionObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>{
    const width=description.clientWidth;
    if(width!==observedWidth){observedWidth=width;fitDescription();}
  }):null;
  document.addEventListener('visibilitychange',onVisibility);
  reducedMotion.addEventListener('change',onReducedMotion);
  window.addEventListener('resize',onResize);
  if(viewport){viewport.addEventListener('resize',onResize);viewport.addEventListener('scroll',onResize);}
  function showFab() {
    if(!fab) return;
    fab.hidden=false;
    fab.setAttribute('aria-expanded','false');
    if(fabRendered||!fabCanvas) return;
    // Reuse the exact modal mesh, but render only one static frame on the home.
    let iconRenderer=null;
    try{iconRenderer=makeRenderer(fabCanvas);if(iconRenderer)iconRenderer.draw(0);}
    catch{if(iconRenderer)iconRenderer.destroy();iconRenderer=null;}
    fab.dataset.renderer=iconRenderer?'webgl':'fallback';
    if(iconRenderer)iconRenderer.destroy();
    fabRendered=true;
  }
  function openPromotion(trigger=document.activeElement) {
    if(dialog.open) return;
    previousFocus=trigger;
    previousOverflow=document.documentElement.style.overflow;
    paused=reducedMotion.matches;
    time=0;
    if(fab){fab.hidden=true;fab.setAttribute('aria-expanded','true');}
    fitViewport();dialog.showModal();document.documentElement.style.overflow='hidden';
    fitDescription();
    try{renderer=makeRenderer();}catch{renderer=null;}
    stage.dataset.renderer=renderer?'webgl':'fallback';
    syncMotion();
    playBatsOnce();
  }
  if(fab)fab.addEventListener('click',()=>openPromotion(fab));
  dialog.addEventListener('close',()=>{
    stop();removeBats();document.documentElement.style.overflow=previousOverflow;
    if(renderer){renderer.destroy();renderer=null;}
    showFab();
    if(previousFocus instanceof HTMLElement&&previousFocus!==document.body&&previousFocus.isConnected) previousFocus.focus({preventScroll:true});
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();stop();renderer=null;stage.dataset.renderer='fallback';});
  if(fabCanvas){
    fabCanvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fab.dataset.renderer='fallback';fabRendered=false;});
    fabCanvas.addEventListener('webglcontextrestored',()=>{if(!dialog.open)showFab();});
  }
  if(descriptionObserver&&description)descriptionObserver.observe(description);
  if(document.fonts)document.fonts.ready.then(fitDescription);
  if(dialog.dataset.autoOpen==='1')openPromotion();
  else showFab();
})();
