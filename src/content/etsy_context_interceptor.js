// etsy_context_interceptor.js - Optimized Context Extraction via Fetch Interception
// Intercepts Etsy's API calls for instant, reliable context updates

/**
 * EtsyContextInterceptor Module
 * Works ONLY on /messages/*id* pages
 * Intercepts /conversations/detail-view-data API for instant updates
 */
window.EtsyContextInterceptor = (function () {
    // === STORAGE KEYS ===
    const STORAGE_KEYS = {
        SHOP_ID: 'ETSY_GLOBAL_SHOP_ID',
        USER_ID: 'ETSY_GLOBAL_USER_ID',
        CHAT_HISTORY: 'ETSY_CHAT_HISTORY',
        CURRENT_LISTING_ID: 'ETSY_CURRENT_LISTING_ID'
    };

    // === STATE ===
    let initialized = false;
    let lastConvoId = null;

    // === MESSAGE LISTENER ===
    /**
     * Listen for messages from page_interceptor.js
     */
    function setupMessageListener() {
        window.addEventListener('message', (event) => {
            // Only accept messages from same window and our interceptor
            if (event.source !== window || event.data.source !== 'etsy-page-interceptor') {
                return;
            }

            if (event.data.type === 'ETSY_DETAIL_VIEW_DATA') {
                handleDetailViewData(event.data.data).catch(err => {
                    console.error('🔴 EtsyContextInterceptor: Failed to process detail-view-data:', err);
                });
            }
        });
    }

    /**
     * Process detail-view-data from page interceptor
     */
    async function handleDetailViewData(data) {
        try {
            const detail = data.detail;
            if (!detail) return;

            const shopId = detail.shop_id;
            await processDetailData(detail, shopId);
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Error processing response:', error);
        }
    }

    /**
     * Shared logic for processing detail data (from both interceptor and initial context)
     */
    async function processDetailData(detail, shopId) {
        const convoId = detail.conversation_id;
        const messages = detail.messages || [];
        const receiptHistory = detail.receipt_history || [];
        const responseTimestamp = Date.now();

        // Store shop_id (persistent)
        if (shopId && chrome.runtime?.id) {
            await updateGlobalParam(STORAGE_KEYS.SHOP_ID, shopId);
        }

        // Get receipt_id for mission-control API
        const receiptId = receiptHistory[0]?.receipt_id;
        let finalMessages = messages;

        // If receipt_id exists, fetch FULL history via mission-control API (has proper 'attachments')
        if (receiptId && shopId) {
            const missionControlMessages = await fetchMissionControlHistory(shopId, receiptId);
            if (missionControlMessages.length > 0) {
                finalMessages = missionControlMessages; // Use full history
            }
        }

        // Store chat history with timestamp for race condition detection
        if (finalMessages.length > 0 && chrome.runtime?.id) {
            // Check if there's a newer response already processed
            const existing = await chrome.storage.local.get([STORAGE_KEYS.CHAT_HISTORY]);
            const existingTimestamp = existing[STORAGE_KEYS.CHAT_HISTORY]?.timestamp || 0;

            // Only update if this response is newer (prevent race condition)
            if (responseTimestamp >= existingTimestamp) {
                // Normalize message structure (map 'images' to 'attachments')
                const normalizedMessages = finalMessages.map(msg => ({
                    ...msg,
                    attachments: msg.attachments || msg.images || []
                }));

                await chrome.storage.local.set({
                    [STORAGE_KEYS.CHAT_HISTORY]: {
                        convo_id: String(convoId),
                        customer_display_name: String(detail.other_user?.display_name || '').trim(),
                        customer_user_id: detail.other_user?.user_id ? String(detail.other_user.user_id) : null,
                        messages: normalizedMessages,
                        timestamp: responseTimestamp
                    }
                });

                window.ShopIntelligenceManager?.maybeBootstrap('conversation_loaded');
            }
        }

        // Get listing_id from detail payload first; fall back to transaction redirect.
        let listingId = extractListingId(detail);
        const transactionId = receiptHistory[0]?.transactions?.[0]?.transaction_id;
        if (!listingId && transactionId) {
            listingId = await getListingIdFromTransaction(transactionId);
        }

        if (listingId && chrome.runtime?.id) {
            await chrome.storage.local.set({
                [STORAGE_KEYS.CURRENT_LISTING_ID]: String(listingId)
            });
        } else {
            // Clear stale listing_id if no transaction in current chat
            if (chrome.runtime?.id) {
                await chrome.storage.local.remove(STORAGE_KEYS.CURRENT_LISTING_ID);
            }
        }
    }

    // === INITIALIZATION ===
    function init() {
        // Only run on /messages/* pages
        if (!window.location.pathname.startsWith('/messages')) {
            return;
        }

        if (initialized) return;
        initialized = true;

        // Clear stale storage on page load
        clearStaleStorage();

        // Parse initial Etsy.Context from DOM (for page load/refresh)
        parseInitialContext();

        // Setup message listener to receive data from page_interceptor.js
        setupMessageListener();
    }

    /**
     * Fetch full chat history via mission-control API (has proper 'attachments' field)
     * @param {string} shopId - Shop ID
     * @param {string} receiptId - Receipt ID
     * @returns {Array} Array of message objects with attachments
     */
    async function fetchMissionControlHistory(shopId, receiptId) {
        try {
            const url = `https://www.etsy.com/api/v3/ajax/shop/${shopId}/mission-control/orders/convos/${receiptId}`;

            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                console.warn(`⚠️ Mission-control API failed: ${response.status}`);
                return [];
            }

            const data = await response.json();
            return data.messages || [];

        } catch (error) {
            console.error('🔴 Mission-control API error:', error);
            return [];
        }
    }

    /**
     * Clear storage if it contains data from different conversation
     */
    async function clearStaleStorage() {
        const currentConvoId = getConvoIdFromUrl();
        if (!currentConvoId || !chrome.runtime?.id) return;

        try {
            const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
            const chatHistory = result.ETSY_CHAT_HISTORY;

            // If storage has data from different conversation - clear it
            if (chatHistory && chatHistory.convo_id !== currentConvoId) {
                await chrome.storage.local.remove(['ETSY_CHAT_HISTORY', 'ETSY_CURRENT_LISTING_ID']);
            }
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Failed to clear stale storage:', error);
        }
    }

    /**
     * Parse initial Etsy.Context from page HTML (for page load)
     */
    async function parseInitialContext() {
        try {
            const etsyContext = extractEtsyContext();
            if (!etsyContext) return;

            const detail = etsyContext.data?.initial_data?.detail;
            if (!detail) return;

            const shopId = etsyContext.data?.shop_id;
            await processDetailData(detail, shopId);
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Failed to parse initial context:', error);
        }
    }

    /**
     * Extract Etsy.Context JSON from page scripts
     */
    function extractEtsyContext() {
        // Try window.Etsy.Context first (fastest)
        if (window.Etsy?.Context) {
            return window.Etsy.Context;
        }

        // Fallback: parse from script tags
        const scripts = document.querySelectorAll('script[type="text/javascript"]');
        for (const script of scripts) {
            const content = script.textContent || '';
            const match = content.match(/Etsy\.Context\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);

            if (match) {
                try {
                    let jsonStr = match[1].replace(/;?\s*$/, '');
                    return JSON.parse(jsonStr);
                } catch (e) {
                    console.warn('⚠️ Failed to parse Etsy.Context:', e);
                }
            }
        }

        return null;
    }

    /**
     * Extract conversation ID from URL
     */
    function getConvoIdFromUrl() {
        const match = window.location.pathname.match(/\/messages\/(\d+)/);
        return match ? match[1] : null;
    }

    function normalizeListingId(value) {
        if (value === null || value === undefined) return null;
        const match = String(value).match(/\d{5,}/);
        return match ? match[0] : null;
    }

    function extractListingId(detail) {
        if (!detail) return null;

        const directCandidates = [
            detail.listing_id,
            detail.listingId,
            detail.listing?.listing_id,
            detail.listing?.listingId,
            detail.transaction?.listing_id,
            detail.transaction?.listingId,
            detail.receipt_history?.[0]?.transactions?.[0]?.listing_id,
            detail.receipt_history?.[0]?.transactions?.[0]?.listingId,
            detail.receipt_history?.[0]?.transactions?.[0]?.listing?.listing_id,
            detail.receipt_history?.[0]?.transactions?.[0]?.listing?.listingId
        ];

        for (const candidate of directCandidates) {
            const id = normalizeListingId(candidate);
            if (id) return id;
        }

        const seen = new Set();
        const stack = [detail.receipt_history, detail.messages, detail.order, detail.receipt, detail.transaction];

        while (stack.length > 0) {
            const item = stack.pop();
            if (!item || typeof item !== 'object' || seen.has(item)) continue;
            seen.add(item);

            if (Array.isArray(item)) {
                for (const child of item) stack.push(child);
                continue;
            }

            for (const [key, value] of Object.entries(item)) {
                const lowerKey = key.toLowerCase();
                if ((lowerKey === 'listing_id' || lowerKey === 'listingid') && value) {
                    const id = normalizeListingId(value);
                    if (id) return id;
                }

                if (typeof value === 'string' && /listing/.test(lowerKey + value)) {
                    const match = value.match(/\/listing\/(\d{5,})/);
                    if (match) return match[1];
                }

                if (value && typeof value === 'object') {
                    stack.push(value);
                }
            }
        }

        return null;
    }

    /**
     * Extract listing_id from transaction redirect
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<string|null>} Listing ID or null
     */
    async function getListingIdFromTransaction(transactionId) {
        try {
            const url = `https://www.etsy.com/transaction/${transactionId}`;

            const response = await fetch(url, {
                credentials: 'include',
                redirect: 'follow'
            });

            const finalUrl = response.url;
            if (!finalUrl) return null;

            const match = finalUrl.match(/\/listing\/(\d+)/);
            if (match) {
                return match[1];
            }

            return null;

        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Transaction redirect failed:', error);
            return null;
        }
    }

    /**
     * Update global parameter in storage (only if changed)
     */
    async function updateGlobalParam(key, value) {
        if (!chrome.runtime?.id) {
            return;
        }

        try {
            const result = await chrome.storage.local.get([key]);
            if (result[key] !== value) {
                await chrome.storage.local.set({ [key]: value });
            }
        } catch (error) {
            console.error(`🔴 EtsyContextInterceptor: Failed to update ${key}:`, error);
        }
    }

    // === PUBLIC API ===
    return {
        init: init,
        STORAGE_KEYS: STORAGE_KEYS,

        // Getters for other modules
        async getShopId() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.SHOP_ID]);
            return result[STORAGE_KEYS.SHOP_ID] || null;
        },

        async getUserId() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.USER_ID]);
            return result[STORAGE_KEYS.USER_ID] || null;
        },

        async getCurrentListingId() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.CURRENT_LISTING_ID]);
            return result[STORAGE_KEYS.CURRENT_LISTING_ID] || null;
        },

        async getChatHistory() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.CHAT_HISTORY]);
            return result[STORAGE_KEYS.CHAT_HISTORY] || null;
        },

        // Debug helper
        getState: () => ({
            initialized,
            lastConvoId
        })
    };
})();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.EtsyContextInterceptor.init());
} else {
    window.EtsyContextInterceptor.init();
}
