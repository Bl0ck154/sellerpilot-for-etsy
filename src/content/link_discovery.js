// link_discovery.js - Fetches and caches the listing associated with the live Etsy conversation.
window.LinkDiscovery = (function () {
    const RAG_STORAGE_PREFIX = 'RAG_LISTING_';
    const LISTING_SCOPE_KEY = 'ETSY_CURRENT_LISTING_SCOPE';
    const TTL_MS = 24 * 60 * 60 * 1000;

    let initialized = false;
    let isFetching = false;
    let pendingDiscovery = false;
    let retryTimer = null;
    let lastPathname = window.location.pathname;

    function getLiveConversationId() {
        return window.location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function init() {
        if (!window.location.pathname.startsWith('/messages')) return;
        if (initialized) return;
        initialized = true;

        setupTriggers();
        setupStorageListener();
        setupNavigationWatcher();
        scheduleDiscovery(250);
    }

    function setupTriggers() {
        document.addEventListener('focusin', event => {
            if (isAIAssistantInput(event.target)) triggerDiscovery();
        });
        document.addEventListener('input', event => {
            if (isAIAssistantInput(event.target)) triggerDiscovery();
        });
    }

    function setupStorageListener() {
        if (!chrome.runtime?.id || !chrome.storage?.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (changes.ETSY_CURRENT_LISTING_ID ||
                changes[LISTING_SCOPE_KEY] ||
                changes.ETSY_GLOBAL_SHOP_ID) {
                scheduleDiscovery(100);
            }
        });
    }

    function setupNavigationWatcher() {
        const checkForConversationChange = () => {
            const currentPathname = window.location.pathname;
            if (currentPathname === lastPathname) return;
            lastPathname = currentPathname;
            if (/^\/messages\/\d+/.test(currentPathname)) scheduleDiscovery(200);
        };

        window.addEventListener('etsy-ai-locationchange', checkForConversationChange);
        window.addEventListener('popstate', checkForConversationChange);
        window.addEventListener('hashchange', checkForConversationChange);
    }

    function scheduleDiscovery(delayMs = 1500) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            triggerDiscovery();
        }, delayMs);
    }

    function isAIAssistantInput(element) {
        if (!element) return false;
        if (element.id === 'user-input' && element.contentEditable === 'true') return true;
        return element.closest?.('#etsy-ai-chat-container [contenteditable]') !== null;
    }

    async function readScopedListing() {
        const liveConversationId = getLiveConversationId();
        if (!liveConversationId) return null;

        const result = await chrome.storage.local.get([
            'ETSY_GLOBAL_SHOP_ID',
            'ETSY_CURRENT_LISTING_ID',
            LISTING_SCOPE_KEY
        ]);
        const listingId = result.ETSY_CURRENT_LISTING_ID
            ? String(result.ETSY_CURRENT_LISTING_ID)
            : null;
        const scope = result[LISTING_SCOPE_KEY];

        // A global listing id without matching conversation scope is unsafe during SPA
        // transitions. Wait for the context interceptor/scope guard to bind it.
        if (!listingId ||
            String(scope?.convoId || '') !== liveConversationId ||
            String(scope?.listingId || '') !== listingId) {
            return null;
        }

        return {
            liveConversationId,
            shopId: result.ETSY_GLOBAL_SHOP_ID || null,
            listingId
        };
    }

    async function triggerDiscovery() {
        if (!/^\/messages\/\d+/.test(window.location.pathname) || !chrome.runtime?.id) return;

        if (isFetching) {
            pendingDiscovery = true;
            return;
        }
        isFetching = true;

        try {
            const scope = await readScopedListing();
            if (!scope?.shopId || !scope.listingId) {
                scheduleDiscovery(1200);
                return;
            }

            const storageKey = `${RAG_STORAGE_PREFIX}${scope.listingId}`;
            const cachedResult = await chrome.storage.local.get([storageKey]);
            const cached = cachedResult[storageKey];
            if (cached?.title && Date.now() - Number(cached.timestamp || 0) < TTL_MS) return;

            const listingData = await fetchListingDataViaAPI(scope.shopId, scope.listingId);
            if (!listingData) {
                scheduleDiscovery(5000);
                return;
            }

            // Re-read the live scope after network I/O. A slow response from customer A
            // must never populate customer B's active context after an SPA navigation.
            const currentScope = await readScopedListing();
            if (!currentScope ||
                currentScope.liveConversationId !== scope.liveConversationId ||
                currentScope.listingId !== scope.listingId) {
                return;
            }

            await chrome.storage.local.set({
                [storageKey]: {
                    title: listingData.title,
                    description: listingData.description,
                    personalization: listingData.personalization,
                    timestamp: Date.now(),
                    storageKey
                }
            });
        } catch (error) {
            console.error('🔴 LinkDiscovery: Error during discovery:', error);
            scheduleDiscovery(5000);
        } finally {
            isFetching = false;
            if (pendingDiscovery) {
                pendingDiscovery = false;
                scheduleDiscovery(100);
            }
        }
    }

    async function fetchListingDataViaAPI(shopId, listingId) {
        try {
            const url = `https://www.etsy.com/api/v3/ajax/bespoke/shop/${encodeURIComponent(shopId)}/listing-editor-data/edit/${encodeURIComponent(listingId)}`;
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
            if (!listing) return null;

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

    return { init, triggerDiscovery };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LinkDiscovery.init());
} else {
    window.LinkDiscovery.init();
}
