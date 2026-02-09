// inject_interceptor.js - Injects page_interceptor.js into page context
// This runs as a content script and injects the fetch interceptor into the actual page context

(function () {
    'use strict';

    // Only run on /messages/* pages (any messages page)
    if (!window.location.pathname.startsWith('/messages')) {
        return;
    }

    // Prevent double injection
    if (window.__ETSY_INTERCEPTOR_INJECTED__) {
        return;
    }
    window.__ETSY_INTERCEPTOR_INJECTED__ = true;

    // Create and inject script element
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/page_interceptor.js');
    script.type = 'text/javascript';

    script.onload = function () {
        // Remove script tag after execution to keep DOM clean
        script.remove();
    };

    script.onerror = function () {
        console.error('🔴 Etsy Interceptor: Failed to inject page script');
    };

    // Inject as early as possible
    (document.head || document.documentElement).appendChild(script);
})();
