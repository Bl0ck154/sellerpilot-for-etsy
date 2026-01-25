// etsy_context_interceptor.js - Optimized Context Extraction from Etsy.Context JSON
// Parses embedded JSON data from page scripts for faster data retrieval

/**
 * EtsyContextInterceptor Module
 * Works ONLY on /messages/*id* pages
 * Extracts shop_id, user_id, listing_id, receipt_id, and chat history
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
    let navigationIntervalId = null; // Track interval to prevent memory leak

    // === INITIALIZATION ===
    function init() {
        // Only run on specific message conversation pages: /messages/{conversation_id}
        if (!/^\/messages\/\d+/.test(window.location.pathname)) {
            return;
        }

        if (initialized && lastConvoId === getConvoIdFromUrl()) {
            return;
        }

        const convoId = getConvoIdFromUrl();
        if (convoId !== lastConvoId) {
            lastConvoId = convoId;
            initialized = false;
        }

        if (initialized) return;
        initialized = true;

        extractAndStoreContext();

        // Setup navigation listener for SPA
        setupNavigationListener();
    }

    /**
     * Extract conversation ID from URL
     */
    function getConvoIdFromUrl() {
        const match = window.location.pathname.match(/\/messages\/(\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Setup listener for SPA navigation
     */
    function setupNavigationListener() {
        // Prevent multiple intervals (memory leak fix)
        if (navigationIntervalId) {
            return; // Already listening
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
                const newConvoId = getConvoIdFromUrl();

                if (newConvoId && newConvoId !== lastConvoId) {
                    console.log('🔄 EtsyContextInterceptor: Navigation detected, re-extracting...');
                    lastConvoId = newConvoId;
                    initialized = false;
                    extractAndStoreContext();
                }
            }
        }, 1000);
    }

    // === CORE EXTRACTION ===

    /**
     * Extract Etsy.Context JSON from page scripts
     * @returns {Object|null} Parsed Etsy.Context object or null
     */
    function extractEtsyContext() {
        const scripts = document.querySelectorAll('script[type="text/javascript"]');

        for (const script of scripts) {
            const content = script.textContent || '';

            // Look for Etsy.Context = {...}
            const match = content.match(/Etsy\.Context\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
            if (match) {
                try {
                    // Clean up the JSON string
                    let jsonStr = match[1];
                    // Remove trailing semicolon if present
                    jsonStr = jsonStr.replace(/;?\s*$/, '');

                    const parsed = JSON.parse(jsonStr);
                    return parsed;
                } catch (e) {
                    console.warn('⚠️ EtsyContextInterceptor: Failed to parse Etsy.Context JSON:', e);
                }
            }
        }

        // Alternative: Look for window.Etsy.Context pattern
        if (window.Etsy && window.Etsy.Context) {
            console.log('✅ EtsyContextInterceptor: Found Etsy.Context on window object');
            return window.Etsy.Context;
        }

        console.warn('⚠️ EtsyContextInterceptor: Etsy.Context not found');
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
     * Extract listing_id from title string
     * Example: "Product Name | Custom Art, listing #4420886705" -> "4420886705"
     * @param {string} title - The title string containing listing ID
     * @returns {string|null} Listing ID or null
     */
    function parseListingIdFromTitle(title) {
        if (!title) return null;
        const match = title.match(/listing\s*#(\d+)/i);
        return match ? match[1] : null;
    }

    /**
     * Main extraction and storage function
     */
    async function extractAndStoreContext() {
        try {
            const etsyContext = extractEtsyContext();
            if (!etsyContext) {
                console.log('⚠️ EtsyContextInterceptor: No context found, fallback to old method');
                return;
            }

            const data = etsyContext.data || etsyContext;

            const shopId = data.shop_id;
            const userId = data.user_id;

            if (shopId) {
                await updateGlobalParam(STORAGE_KEYS.SHOP_ID, shopId);
            }
            if (userId) {
                await updateGlobalParam(STORAGE_KEYS.USER_ID, userId);
            }

            const detail = data.initial_data?.detail || {};
            const title = detail.title;
            let listingId = parseListingIdFromTitle(title);

            if (!listingId) {
                const receiptHistory = detail.receipt_history || [];
                const transactions = receiptHistory[0]?.transactions || [];
                const transactionId = transactions[0]?.transaction_id;

                if (transactionId) {
                    listingId = await getListingIdFromTransaction(transactionId);
                }
            }

            if (listingId) {
                if (chrome.runtime?.id) {
                    await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_LISTING_ID]: listingId });
                }
            }

            // Extract receipt_id (from receipt_history)
            const receiptHistory = detail.receipt_history || [];
            const receiptId = receiptHistory[0]?.receipt_id;

            // Fetch and store chat history
            await fetchAndStoreChatHistory(shopId, receiptId, detail);

        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Error during extraction:', error);
        }
    }

    /**
     * Update global parameter in storage (only if changed)
     */
    async function updateGlobalParam(key, value) {
        // Check extension context before storage operation
        if (!chrome.runtime?.id) {
            console.log('⛔ EtsyContextInterceptor: Extension context invalidated');
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

    // === CHAT HISTORY FETCHING ===

    /**
     * Fetch and store chat history using appropriate method
     * @param {string} shopId - Shop ID
     * @param {string} receiptId - Receipt ID (optional)
     * @param {Object} detail - Initial data detail object
     */
    async function fetchAndStoreChatHistory(shopId, receiptId, detail) {
        let messages = [];

        if (receiptId && shopId) {
            messages = await fetchChatViaApi(shopId, receiptId);
        }

        if (messages.length === 0) {
            messages = await getMessagesFromInitialData(detail);
        }

        if (messages.length > 0) {
            if (!chrome.runtime?.id) {
                return;
            }

            const chatHistory = {
                convo_id: getConvoIdFromUrl(),
                messages: messages,
                timestamp: Date.now()
            };

            await chrome.storage.local.set({ [STORAGE_KEYS.CHAT_HISTORY]: chatHistory });
        }
    }

    /**
     * Fetch chat history via mission-control API
     * @param {string} shopId - Shop ID
     * @param {string} receiptId - Receipt ID
     * @returns {Array} Array of message objects
     */
    async function fetchChatViaApi(shopId, receiptId) {
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
                console.warn(`⚠️ EtsyContextInterceptor: API request failed: ${response.status}`);
                return [];
            }

            const data = await response.json();
            const rawMessages = data.messages || [];

            // Map to our format (keep only needed fields)
            return rawMessages.map(msg => ({
                convo_message_id: msg.convo_message_id,
                sender_user_id: msg.sender_user_id,
                sender_display_name: msg.sender_display_name,
                message_body: msg.message_body,
                create_date: msg.create_date,
                attachments: (msg.attachments || []).map(att => ({
                    attachment_id: att.convo_message_attachment_id,
                    url: att.url,
                    thumb_url: att.thumb_url
                }))
            }));

        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: API fetch error:', error);
            return [];
        }
    }

    /**
     * Get messages from initial_data.detail.messages with pagination
     * @param {Object} detail - Initial data detail object
     * @returns {Array} Array of message objects
     */
    async function getMessagesFromInitialData(detail) {
        const initialMessages = detail.messages || [];

        if (initialMessages.length === 0) {
            return [];
        }

        // Check if we need to fetch older messages
        const firstMessage = initialMessages[0];
        const messageOrder = firstMessage?.message_order;

        let olderMessages = [];
        if (messageOrder && messageOrder > 10) {
            // Fetch older messages
            const convoId = getConvoIdFromUrl();
            const offset = messageOrder - 1;
            olderMessages = await fetchOlderMessages(convoId, offset);
        }

        // Map initial messages to our format
        const mappedInitial = initialMessages.map(msg => ({
            conversation_message_id: msg.conversation_message_id,
            sender_id: msg.sender_id,
            sender_display_name: msg.sender_name || msg.sender_display_name,
            message_body: msg.message,
            create_date: msg.create_date,
            attachments: []
        }));

        // Merge: older messages first, then initial messages
        return [...olderMessages, ...mappedInitial];
    }

    /**
     * Fetch older messages via pagination API
     * @param {string} convoId - Conversation ID
     * @param {number} offset - Message offset
     * @returns {Array} Array of older message objects
     */
    async function fetchOlderMessages(convoId, offset) {
        try {
            const url = `https://www.etsy.com/api/v3/ajax/member/conversations/detail/${convoId}/message-list?offset=${offset}&fetch_older=true`;

            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                console.warn(`⚠️ EtsyContextInterceptor: Pagination API failed: ${response.status}`);
                return [];
            }

            const data = await response.json();
            const rawMessages = data.messages || [];

            // Map to our format
            return rawMessages.map(msg => ({
                conversation_message_id: msg.conversation_message_id,
                sender_id: msg.sender_id,
                sender_display_name: msg.sender_name || msg.sender_display_name,
                message_body: msg.message,
                create_date: msg.create_date,
                attachments: []
            }));

        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Pagination fetch error:', error);
            return [];
        }
    }

    // === PUBLIC API ===
    return {
        init: init,
        extractEtsyContext: extractEtsyContext,
        parseListingIdFromTitle: parseListingIdFromTitle,
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
