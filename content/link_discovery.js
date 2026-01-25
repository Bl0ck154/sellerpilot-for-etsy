// link_discovery.js - Simplified API-Based Listing Data Fetcher
// Fetches listing description via Etsy API for RAG context

/**
 * LinkDiscovery Module
 * Works ONLY on /messages/* pages
 * Triggers on user focus/input in AI assistant field
 * Fetches listing data via API instead of parsing HTML
 */
window.LinkDiscovery = (function () {
    // === STATE ===
    let initialized = false;
    let discoveryTriggered = false;
    let lastListingId = null; // Track to avoid duplicate fetches
    let navigationIntervalId = null; // Track interval to prevent memory leak
    let retryCount = 0; // Track retry attempts to prevent infinite loop

    // === STORAGE ===
    const RAG_STORAGE_PREFIX = 'RAG_LISTING_';

    // === INITIALIZATION ===
    function init() {
        // Only run on specific message conversation pages
        if (!/^\/messages\/\d+/.test(window.location.pathname)) {
            return;
        }

        if (initialized) return;
        initialized = true;

        setupTriggers();
        setupNavigationListener();
    }

    // === TRIGGER SETUP ===
    function setupTriggers() {
        // Trigger 1: Focus on AI assistant input field
        document.addEventListener('focusin', (e) => {
            if (isAIAssistantInput(e.target)) {
                triggerDiscovery();
            }
        });

        // Trigger 2: Typing in AI assistant input (backup trigger)
        document.addEventListener('input', (e) => {
            if (isAIAssistantInput(e.target) && !discoveryTriggered) {
                triggerDiscovery();
            }
        });
    }

    /**
     * Setup listener for SPA navigation to reset discovery state
     */
    function setupNavigationListener() {
        // Prevent multiple intervals (memory leak fix)
        if (navigationIntervalId) {
            return;
        }

        let lastUrl = window.location.href;

        navigationIntervalId = setInterval(() => {
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                clearInterval(navigationIntervalId);
                navigationIntervalId = null;
                return;
            }

            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                discoveryTriggered = false; // Reset so new chat can trigger discovery
                lastListingId = null; // Reset listing cache
            }
        }, 1000);
    }

    /**
     * Check if element is our AI assistant input field
     */
    function isAIAssistantInput(element) {
        if (!element) return false;

        // Check for our specific AI assistant input
        // ID: user-input (contenteditable div)
        if (element.id === 'user-input' && element.contentEditable === 'true') {
            return true;
        }

        // Also check if inside our chat container
        return element.closest('#etsy-ai-chat-container') !== null &&
            element.closest('#etsy-ai-chat-container [contenteditable]') !== null;
    }

    // === MAIN DISCOVERY FLOW ===
    async function triggerDiscovery() {
        if (discoveryTriggered) {
            return;
        }

        if (!chrome.runtime?.id) {
            return;
        }

        try {
            // Get shop_id and listing_id from storage (set by etsy_context_interceptor)
            const result = await chrome.storage.local.get([
                'ETSY_GLOBAL_SHOP_ID',
                'ETSY_CURRENT_LISTING_ID'
            ]);

            const shopId = result.ETSY_GLOBAL_SHOP_ID;
            const listingId = result.ETSY_CURRENT_LISTING_ID;

            if (!shopId || !listingId) {
                // Limit retries to prevent infinite loop
                if (retryCount >= 2) {
                    console.warn('❌ LinkDiscovery: Max retries reached. shop_id or listing_id not available.');
                    discoveryTriggered = true; // Block further attempts
                    return;
                }

                retryCount++;
                // Retry after 1.5 seconds
                setTimeout(() => {
                    triggerDiscovery();
                }, 1500);

                return;
            }

            // Reset retry count on success
            retryCount = 0;

            // Skip if already fetched for this listing
            if (listingId === lastListingId) {
                discoveryTriggered = true; // Set flag to prevent re-triggering
                return;
            }

            const listingData = await fetchListingDataViaAPI(shopId, listingId);

            if (!listingData) {
                return;
            }

            // Update cache
            lastListingId = listingId;

            // Store in same format as before for compatibility with base_ai_service.js
            const storageKey = `${RAG_STORAGE_PREFIX}${listingId}`;

            if (!chrome.runtime?.id) {
                return; // Context invalidated during fetch
            }

            await chrome.storage.local.set({
                [storageKey]: {
                    title: listingData.title,
                    description: listingData.description,
                    personalization: listingData.personalization,
                    timestamp: Date.now(),
                    storageKey: storageKey
                }
            });

            discoveryTriggered = true;

        } catch (error) {
            console.error('🔴 LinkDiscovery: Error during discovery:', error);
            // Don't set discoveryTriggered on error, allow retry
        }
    }

    /**
     * Fetch listing data via Etsy API
     * @param {string} shopId - Shop ID
     * @param {string} listingId - Listing ID
     * @returns {Object|null} {title, description, personalization}
     */
    async function fetchListingDataViaAPI(shopId, listingId) {
        try {
            const url = `https://www.etsy.com/api/v3/ajax/bespoke/shop/${shopId}/listing-editor-data/edit/${listingId}`;

            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                console.warn(`⚠️ LinkDiscovery: API request failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const listing = data.listing;

            if (!listing) {
                console.warn('⚠️ LinkDiscovery: No listing data in API response');
                return null;
            }

            return {
                title: listing.title || '',
                description: listing.form_fields?.description || '',
                personalization: listing.form_fields?.personalization?.personalization_instructions || ''
            };

        } catch (error) {
            console.error('🔴 LinkDiscovery: API fetch error:', error);
            return null;
        }
    }

    // === PUBLIC API ===
    return {
        init: init
    };
})();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LinkDiscovery.init());
} else {
    window.LinkDiscovery.init();
}
