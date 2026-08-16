// page_interceptor.js - Runs in PAGE CONTEXT and forwards ordered Etsy conversation payloads.
(function () {
    'use strict';

    let interceptorInstalled = false;
    let requestSequence = 0;

    function setupFetchInterceptor() {
        if (interceptorInstalled) return;
        interceptorInstalled = true;

        const originalFetch = window.fetch;

        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            const isDetailRequest = !!url && url.includes('/conversations/detail-view-data');
            // Sequence is assigned when the request starts, not when it finishes. This lets
            // the content layer reject an older slow request that completes after a newer one.
            const sequence = isDetailRequest ? ++requestSequence : 0;
            const requestStartedAt = isDetailRequest ? Date.now() : 0;

            const response = await originalFetch.apply(this, args);
            const isConversationPage = /^\/messages\/\d+/.test(window.location.pathname);

            if (isConversationPage && isDetailRequest) {
                try {
                    const clone = response.clone();
                    const data = await clone.json();

                    window.postMessage({
                        type: 'ETSY_DETAIL_VIEW_DATA',
                        source: 'etsy-page-interceptor',
                        data,
                        requestSequence: sequence,
                        requestStartedAt
                    }, '*');
                } catch (error) {
                    console.error('🔴 Failed to process intercepted response:', error);
                }
            }

            return response;
        };
    }

    setupFetchInterceptor();
})();
