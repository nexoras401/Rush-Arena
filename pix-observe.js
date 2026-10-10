/* Temporary checkout diagnostics; expires automatically. Never reads/logs PIX content. */
(() => {
  'use strict';
  if (Date.now() > Date.parse('2026-09-30T22:00:00Z') || window.__pixObserveStarted) return;
  const form = document.querySelector('.home-deposit-form');
  const csrf = form?.querySelector('[name="csrf_token"]')?.value;
  if (!form || !csrf) return;
  window.__pixObserveStarted = true;
  const flow = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
  const started = performance.now();
  const qr = document.querySelector('[data-modal="deposit-qr"]');
  const deposit = document.querySelector('[data-modal="deposit"]');
  const copy = document.getElementById('homeCopyPixButton');
  const generate = form.querySelector('button[type="submit"]');
  const low = document.getElementById('homeLowBalanceDepositButton');
  let budget = 45, recentCopy = -Infinity;
  const sent = new Set();
  function emit(event, extra = {}) {
    try {
      if (budget <= 0 || Date.now() > Date.parse('2026-09-30T22:00:00Z')) return;
      budget--;
      let allowed;
      try { allowed = (document.permissionsPolicy || document.featurePolicy)?.allowsFeature('clipboard-write'); } catch (_) {}
      const payload = {csrf,flow,event,token:qr?.dataset.pixToken || '',
        attempt:form.querySelector('[name="deposit_request_id"]')?.value || '',
        provider:qr?.dataset.pixProvider || 'unknown',surface:window.parent === window ? 'home' : 'iframe',
        elapsed_ms:Math.round(performance.now()-started),width:innerWidth,height:innerHeight,
        clipboard_available:!!navigator.clipboard?.writeText,secure:window.isSecureContext,
        ...(typeof allowed === 'boolean' ? {clipboard_allowed:allowed} : {}),...extra};
      navigator.sendBeacon('/pix-observe.php', new Blob([JSON.stringify(payload)], {type:'application/json'}));
    } catch (_) { /* Diagnostics must never interfere with checkout. */ }
  }
  const errorKind = error => ['NotAllowedError','SecurityError','NotFoundError','TypeError','ReferenceError','SyntaxError','AbortError'].includes(error?.name) ? error.name : 'other';
  const rendered = () => Array.from(document.querySelectorAll('#homePixQrCode canvas, #homePixQrCode img')).some(e => e.tagName === 'CANVAS' ? e.width > 0 && e.height > 0 : e.complete && e.naturalWidth > 0);
  function feedbackKind() {
    const text = document.querySelector('[data-modal="deposit"] .register-feedback--error')?.textContent || '';
    if (!text) return 'none';
    if (text.includes('tentativa de depósito expirou')) return 'expired_attempt';
    if (/CPF/i.test(text)) return 'invalid_cpf';
    if (/valor válido|valor mínimo|valor máximo/i.test(text)) return 'invalid_amount';
    if (text.includes('registro seguro do depósito')) return 'registration_failed';
    return 'other';
  }
  function once(event, data) { if (!sent.has(event)) {sent.add(event);emit(event,data);} }
  emit('checkout_ready', {qr_rendered:rendered(),pix_length:(qr?.dataset.pixKey || '').length,feedback:feedbackKind()});
  document.addEventListener('click', e => {
    const button = e.target.closest?.('button');
    if (button === generate || button === low) emit('generate_click', {disabled:button.disabled});
    if (button === copy) {recentCopy=performance.now();emit('copy_click');}
  }, true);
  document.addEventListener('submit', e => {
    if (e.target === form) emit('submit', {disabled:!!generate?.disabled,prevented:e.defaultPrevented});
  });
  // Observe actual clipboard results without changing values, return values, or exceptions.
  try {
    const original = document.execCommand;
    document.execCommand = function(...args) {
      try {
        const value = Reflect.apply(original, this, args);
        if (args[0] === 'copy' && performance.now()-recentCopy < 5000) emit(value ? 'copy_success' : 'copy_failed', {method:'execCommand',...(!value?{error:'false_result'}:{})});
        return value;
      } catch (error) {
        if (args[0] === 'copy' && performance.now()-recentCopy < 5000) emit('copy_failed', {method:'execCommand',error:errorKind(error)});
        throw error;
      }
    };
  } catch (_) {}
  try {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      const original = clipboard.writeText;
      clipboard.writeText = function(...args) {
        const observe = performance.now()-recentCopy < 5000;
        let result;
        try {result=Reflect.apply(original,this,args);} catch(error) {
          if(observe)emit('copy_failed',{method:'clipboard',error:errorKind(error)});
          throw error;
        }
        // Return the original Promise unchanged; observe only its settlement.
        if(observe)result.then(()=>emit('copy_success',{method:'clipboard'}),error=>emit('copy_failed',{method:'clipboard',error:errorKind(error)}));
        return result;
      };
    }
  } catch (_) {}
  let qrVisible = false, depositVisible = false, previousState = '';
  function inspect() {
    const isQrVisible=!!qr && !qr.hidden;
    const isDepositVisible=!!deposit && !deposit.hidden;
    if(isQrVisible&&!qrVisible) {
      emit('qr_open',{qr_rendered:rendered(),pix_length:(qr.dataset.pixKey||'').length});
      setTimeout(()=>{if(!qr.hidden&&!rendered())once('qr_missing',{qr_rendered:false});},2000);
    }
    if(!isQrVisible&&qrVisible)emit('qr_close');
    if(isDepositVisible&&!depositVisible)emit('deposit_open');
    qrVisible=isQrVisible; depositVisible=isDepositVisible;
    const state=document.getElementById('homePaymentStatusBadge')?.dataset.state || 'unknown';
    if(isQrVisible&&state!==previousState&&['pending','error','success'].includes(state))emit('status_'+state,{state});
    previousState=state;
  }
  const observer=new MutationObserver(inspect);
  if(qr)observer.observe(qr,{attributes:true,subtree:true,attributeFilter:['hidden','data-state']});
  if(deposit)observer.observe(deposit,{attributes:true,attributeFilter:['hidden']});
  inspect();
  document.addEventListener('visibilitychange',()=>emit(document.hidden?'page_hidden':'page_visible'));
  window.addEventListener('pagehide',()=>emit('page_exit'));
  window.addEventListener('error',e=>{
    if(qr && !qr.hidden)emit(e.target?.tagName==='SCRIPT'?'qr_resource_error':'js_error',{error:errorKind(e.error)});
  },true);
})();
