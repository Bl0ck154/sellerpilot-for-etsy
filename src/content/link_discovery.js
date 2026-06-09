// link_discovery.js - Simplified API-Based Listing Data Fetcher
// Fetches listing description via Etsy API for RAG context

/**
 * LinkDiscovery Module
 * Works ONLY on /messages/* pages
 * Triggers automatically from conversation/listing storage updates, with
 * focus/input as backup triggers.
 * Fetches listing data via API instead of parsing HTML
 */
window.LinkDiscovery = (function () {
    // === STATE ===
    let initialized = false;
    let isFetching = false;
    let lastListingId = null; // Track to avoid duplicate fetches
    let retryTimer = null;
    let lastPathname = window.location.pathname;

    // === STORAGE ===
    const RAG_STORAGE_PREFIX = 'RAG_LISTING_';

    // === INITIALIZATION ===
    function init() {
        // Only run on Etsy messages pages. Conversation detail pages may be
        // reached via SPA navigation after landing on /messages.
        if (!window.location.pathname.startsWith('/messages')) {
            return;
        }

        if (initialized) return;
        initialized = true;

        setupTriggers();
        setupStorageListener();
        setupNavigationWatcher();
        scheduleDiscovery(250);
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
            if (isAIAssistantInput(e.target)) {
                triggerDiscovery();
            }
        });
    }

    function setupStorageListener() {
        if (!chrome.runtime?.id || !chrome.storage?.onChanged) return;

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (changes.ETSY_CURRENT_LISTING_ID || changes.ETSY_GLOBAL_SHOP_ID) {
                scheduleDiscovery(100);
            }
        });
    }

    function setupNavigationWatcher() {
        const checkForConversationChange = () => {
            const currentPathname = window.location.pathname;
            if (currentPathname === lastPathname) return;
            lastPathname = currentPathname;

            if (/^\/messages\/\d+/.test(currentPathname)) {
                lastListingId = null;
                scheduleDiscovery(250);
            }
        };

        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            if (typeof original !== 'function') return;

            history[methodName] = function (...args) {
                const result = original.apply(this, args);
                setTimeout(checkForConversationChange, 0);
                return result;
            };
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');
        window.addEventListener('popstate', checkForConversationChange);
    }

    function scheduleDiscovery(delayMs = 1500) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            triggerDiscovery();
        }, delayMs);
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
        if (!/^\/messages\/\d+/.test(window.location.pathname)) {
            return;
        }

        if (isFetching) {
            return;
        }
        isFetching = true;

        if (!chrome.runtime?.id) {
            isFetching = false;
            return;
        }

        try {
            // Get shop_id and listing_id from storage (set by etsy_context_interceptor)
            const result = await chrome.storage.local.get([
                'ETSY_GLOBAL_SHOP_ID',
                'ETSY_CURRENT_LISTING_ID'
            ]);

            const shopId = result.ETSY_GLOBAL_SHOP_ID;
            const listingId = result.ETSY_CURRENT_LISTING_ID ? String(result.ETSY_CURRENT_LISTING_ID) : null;

            if (!shopId || !listingId) {
                isFetching = false;
                scheduleDiscovery(1500);
                return;
            }

            const storageKey = `${RAG_STORAGE_PREFIX}${listingId}`;
            const cachedResult = await chrome.storage.local.get([storageKey]);
            const cached = cachedResult[storageKey];
            const TTL_24_HOURS = 24 * 60 * 60 * 1000;

            // Skip if already fetched and still fresh for this listing.
            if (cached?.title && Date.now() - (cached.timestamp || 0) < TTL_24_HOURS) {
                lastListingId = listingId;
                isFetching = false;
                return;
            }

            const listingData = await fetchListingDataViaAPI(shopId, listingId);

            if (!listingData) {
                isFetching = false;
                scheduleDiscovery(5000);
                return;
            }

            // Update cache
            lastListingId = listingId;

            // Store in same format as before for compatibility with base_ai_service.js
            if (!chrome.runtime?.id) {
                isFetching = false;
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

            isFetching = false;

        } catch (error) {
            console.error('🔴 LinkDiscovery: Error during discovery:', error);
            isFetching = false;
            scheduleDiscovery(5000);
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
        init: init,
        triggerDiscovery: triggerDiscovery
    };
})();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LinkDiscovery.init());
} else {
    window.LinkDiscovery.init();
}
