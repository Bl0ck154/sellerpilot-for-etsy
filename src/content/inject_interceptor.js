// inject_interceptor.js - Installs the lightweight page fetch interceptor once on Etsy.
(function () {
    'use strict';

    function maybeInject() {
        if (window.__ETSY_INTERCEPTOR_INJECTED__) return false;
        window.__ETSY_INTERCEPTOR_INJECTED__ = true;

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/page_interceptor.js');
        script.type = 'text/javascript';
        script.onload = () => script.remove();
        script.onerror = () => {
            window.__ETSY_INTERCEPTOR_INJECTED__ = false;
            script.remove();
            console.error('🔴 Etsy Interceptor: Failed to inject page script');
        };
        (document.head || document.documentElement).appendChild(script);
        return true;
    }

    // Install before any later Etsy SPA transition. page_interceptor.js itself only reads
    // conversation payloads while the live path is /messages/<id>, so the wrapper remains
    // inert on normal Etsy pages but cannot miss the first fetch after pushState navigation.
    maybeInject();

    // Navigation listeners are retry points only if the first injection failed.
    window.addEventListener('etsy-ai-locationchange', maybeInject);
    window.addEventListener('popstate', maybeInject);
    window.addEventListener('hashchange', maybeInject);

    window.EtsyInterceptorInjector = { maybeInject };
})();
