// inject_interceptor.js - Injects page_interceptor.js when Etsy enters messages, including SPA navigation.
(function () {
    'use strict';

    function isMessagesPage() {
        return window.location.pathname.startsWith('/messages');
    }

    function maybeInject() {
        if (!isMessagesPage() || window.__ETSY_INTERCEPTOR_INJECTED__) return false;
        window.__ETSY_INTERCEPTOR_INJECTED__ = true;

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/page_interceptor.js');
        script.type = 'text/javascript';
        script.onload = () => script.remove();
        script.onerror = () => {
            // Allow a later navigation/retry to attempt injection again.
            window.__ETSY_INTERCEPTOR_INJECTED__ = false;
            script.remove();
            console.error('🔴 Etsy Interceptor: Failed to inject page script');
        };
        (document.head || document.documentElement).appendChild(script);
        return true;
    }

    maybeInject();
    window.addEventListener('etsy-ai-locationchange', maybeInject);
    window.addEventListener('popstate', maybeInject);
    window.addEventListener('hashchange', maybeInject);

    window.EtsyInterceptorInjector = { maybeInject };
})();
