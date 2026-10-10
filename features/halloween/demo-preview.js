(() => {
    'use strict';
    const layer = document.getElementById('halloweenDemoLoading');
    if (!layer) return;
    if (getComputedStyle(layer).position !== 'fixed') return; // CSS unavailable: original UI wins.
    // Observe the original logo wrapper's DOM lifecycle. Do not wrap or replace
    // LoadingBar methods, engine callbacks, progress values or start events.
    const original = document.getElementById('message');
    if (!original || !original.querySelector('.game-loading-logo')) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pumpkin = layer.querySelector('.hw-demo-pumpkin');
    const poster = pumpkin.querySelector('img');
    const sprite = pumpkin.querySelector('.hw-demo-pumpkin-sprite');
    let closed = false;
    let observer;
    let image;
    function close() {
        if (closed) return;
        closed = true;
        layer.hidden = true;
        document.documentElement.classList.remove('hw-demo-loading-active');
        if (observer) observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        reduced.removeEventListener('change', onMotion);
        if (image) {
            image.onload = null;
            image.removeAttribute('src');
            image = null;
        }
        sprite.style.backgroundImage = '';
    }
    function onVisibility() {
        layer.toggleAttribute('data-document-hidden', document.hidden);
    }
    function onMotion() {
        if (closed) return;
        if (reduced.matches) {
            layer.removeAttribute('data-sprite-ready');
        } else if (image && image.complete && image.naturalWidth) {
            layer.setAttribute('data-sprite-ready', '');
        } else if (!image) {
            image = new Image();
            image.fetchPriority = 'low'; // Cosmetic asset must not outrank the game boot.
            image.decoding = 'async';
            image.onload = () => {
                if (closed) return;
                sprite.style.backgroundImage = `url("${image.src}")`;
                if (!reduced.matches) layer.setAttribute('data-sprite-ready', '');
            };
            // Supply enough physical pixels for the actual display density.
            // Only one atlas is requested; reduced motion uses the poster alone.
            const pixels = pumpkin.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 3);
            const resolution = pixels > 448 ? 672 : 448;
            image.src = `/features/halloween/assets/pumpkin-sprite-v15-${resolution}.webp`;
        }
    }
    const showPoster = () => { if (poster.naturalWidth) pumpkin.setAttribute('data-poster-ready', ''); };
    poster.addEventListener('load', showPoster, { once: true });
    showPoster();
    try {
        observer = new MutationObserver(() => { if (!original.isConnected) close(); });
        observer.observe(document.body, { childList: true });
        document.addEventListener('visibilitychange', onVisibility);
        reduced.addEventListener('change', onMotion);
        window.addEventListener('pagehide', close, { once: true });
        layer.hidden = false;
        document.documentElement.classList.add('hw-demo-loading-active');
        onVisibility();
        onMotion();
    } catch {
        close(); // Fail open to the original loader, never hold the game.
    }
})();
