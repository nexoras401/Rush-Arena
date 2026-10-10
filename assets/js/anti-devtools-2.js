(function () {
    'use strict';

    var GOOGLE_URL = 'https://www.google.com';
    var redirected = false;
    var mobileUaPattern = /Android|iPhone|iPad|iPod|Mobile/i;

    function redirectNow() {
        if (redirected) {
            return;
        }

        redirected = true;
        window.location.replace(GOOGLE_URL);
    }

    function getPlatformString() {
        if (navigator.userAgentData && navigator.userAgentData.platform) {
            return String(navigator.userAgentData.platform || '');
        }

        return String(navigator.platform || '');
    }

    function hasRealTouch() {
        var maxTouchPoints = Number(navigator.maxTouchPoints || 0);
        var coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

        return maxTouchPoints > 0 || coarsePointer;
    }

    function hasClearDesktopSignals() {
        var ua = String(navigator.userAgent || '');
        var platform = getPlatformString();
        var userAgentDataPlatform = navigator.userAgentData && navigator.userAgentData.platform
            ? String(navigator.userAgentData.platform || '')
            : '';
        var platformSignalsDesktop = /MacIntel|MacPPC|Win32|Win64|Windows|Linux x86_64|Linux i686|Linux/i.test(platform);
        var uaDataSignalsDesktop = /macOS|Windows|Linux/i.test(userAgentDataPlatform);
        var desktopChromeLike = (/Chrome|CriOS|Edg|OPR/i.test(ua) || /Google Inc\./i.test(String(navigator.vendor || '')))
            && !/Android/i.test(ua);
        var iosRealMobile = /Macintosh/i.test(ua) && /Mobile/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;

        if (iosRealMobile) {
            return false;
        }

        return platformSignalsDesktop || uaDataSignalsDesktop || desktopChromeLike;
    }

    function isRealMobileDevice() {
        var ua = String(navigator.userAgent || '');
        var mobileUa = mobileUaPattern.test(ua);
        var iosRealMobile = /Macintosh/i.test(ua) && /Mobile/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;

        if (iosRealMobile) {
            return true;
        }

        return mobileUa && hasRealTouch() && !hasClearDesktopSignals();
    }

    function handleForbiddenShortcut(event) {
        var key = String(event.key || '').toLowerCase();
        var ctrlKey = !!event.ctrlKey;
        var metaKey = !!event.metaKey;
        var shiftKey = !!event.shiftKey;
        var altKey = !!event.altKey;

        if (key === 'f12') {
            event.preventDefault();
            redirectNow();
            return;
        }

        if ((ctrlKey && shiftKey && (key === 'i' || key === 'j'))
            || (metaKey && altKey && (key === 'i' || key === 'j'))) {
            event.preventDefault();
            redirectNow();
            return;
        }

        if ((ctrlKey || metaKey) && key === 'u') {
            event.preventDefault();
            redirectNow();
        }
    }

    function handleContextMenu(event) {
        if (event.pointerType === 'touch') {
            return;
        }

        event.preventDefault();
        redirectNow();
    }

    if (isRealMobileDevice()) {
        return;
    }

    document.addEventListener('keydown', handleForbiddenShortcut, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
}());
