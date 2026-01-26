// page_interceptor.js - Runs in PAGE CONTEXT (not content script)
// Intercepts fetch calls to Etsy API and sends data to content script via postMessage

(function () {
    'use strict';

    let interceptorInstalled = false;

    function setupFetchInterceptor() {
        if (interceptorInstalled) {
            return;
        }

        interceptorInstalled = true;

        const originalFetch = window.fetch;

        window.fetch = async function (...args) {
            // Call original fetch
            const response = await originalFetch.apply(this, args);

            // Only intercept on conversation pages (/messages/\d+)
            const isConversationPage = /^\/messages\/\d+/.test(window.location.pathname);

            // Check if this is the detail-view-data endpoint
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

            if (isConversationPage && url && url.includes('/conversations/detail-view-data')) {
                try {
                    // Clone response to read without consuming original
                    const clone = response.clone();
                    const data = await clone.json();

                    // Send data to content script via postMessage
                    window.postMessage({
                        type: 'ETSY_DETAIL_VIEW_DATA',
                        source: 'etsy-page-interceptor',
                        data: data
                    }, '*');
                } catch (error) {
                    console.error('🔴 Failed to process intercepted response:', error);
                }
            }

            // Return original response to Etsy
            return response;
        };
    }

    // Install interceptor immediately
    setupFetchInterceptor();
})();
