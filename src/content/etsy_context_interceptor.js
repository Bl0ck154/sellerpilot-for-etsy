// etsy_context_interceptor.js - Live Etsy conversation ingestion with strict SPA scope guards.
window.EtsyContextInterceptor = (function () {
    const STORAGE_KEYS = {
        SHOP_ID: 'ETSY_GLOBAL_SHOP_ID',
        USER_ID: 'ETSY_GLOBAL_USER_ID',
        CHAT_HISTORY: 'ETSY_CHAT_HISTORY',
        CURRENT_LISTING_ID: 'ETSY_CURRENT_LISTING_ID',
        CURRENT_LISTING_SCOPE: 'ETSY_CURRENT_LISTING_SCOPE'
    };

    // A full page reload creates a new content-script session. Request sequence numbers only
    // have meaning inside one such session, so old persisted sequence values can never block
    // fresh data after a reload.
    const CONTENT_SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    let initialized = false;
    let lastConvoId = null;
    let messageListenerInstalled = false;
    let navigationListenersInstalled = false;

    function getConvoIdFromUrl() {
        return window.location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function normalizeId(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function normalizeSequence(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    }

    function isLiveConversation(convoId) {
        const live = getConvoIdFromUrl();
        return !!live && live === normalizeId(convoId);
    }

    function messageTimeMs(message) {
        const raw = message?.create_date ?? message?.created_at ?? message?.timestamp ?? null;
        const numeric = Number(raw);
        if (raw !== null && raw !== '' && Number.isFinite(numeric) && numeric > 0) {
            return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }
        const parsed = Date.parse(String(raw || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeMessages(messages) {
        const normalized = (messages || []).map(message => ({
            ...message,
            attachments: message.attachments || message.images || []
        }));
        if (normalized.length > 1 && normalized.every(message => messageTimeMs(message) > 0)) {
            normalized.sort((a, b) => messageTimeMs(a) - messageTimeMs(b));
        }
        return normalized;
    }

    function storedSourceSequence(record, convoId) {
        if (!record || normalizeId(record.convo_id || record.convoId) !== convoId) return 0;
        if (record.sourceSessionId !== CONTENT_SESSION_ID) return 0;
        return normalizeSequence(record.sourceSequence);
    }

    async function isResponseCurrent(convoId, sourceSequence) {
        if (!isLiveConversation(convoId)) return false;
        const state = await chrome.storage.local.get([
            STORAGE_KEYS.CHAT_HISTORY,
            STORAGE_KEYS.CURRENT_LISTING_SCOPE
        ]);
        if (!isLiveConversation(convoId)) return false;

        const newestStoredSequence = Math.max(
            storedSourceSequence(state[STORAGE_KEYS.CHAT_HISTORY], convoId),
            storedSourceSequence(state[STORAGE_KEYS.CURRENT_LISTING_SCOPE], convoId)
        );
        return normalizeSequence(sourceSequence) >= newestStoredSequence;
    }

    function setupMessageListener() {
        if (messageListenerInstalled) return;
        messageListenerInstalled = true;
        window.addEventListener('message', event => {
            if (event.source !== window || event.data?.source !== 'etsy-page-interceptor') return;
            if (event.data?.type !== 'ETSY_DETAIL_VIEW_DATA') return;

            handleDetailViewData(event.data.data, {
                requestSequence: event.data.requestSequence,
                requestStartedAt: event.data.requestStartedAt
            }).catch(error => {
                console.error('🔴 EtsyContextInterceptor: Failed to process detail-view-data:', error);
            });
        });
    }

    async function handleDetailViewData(data, ordering = {}) {
        const detail = data?.detail;
        if (!detail) return;
        const shopId = data?.shop_id || detail?.shop_id || null;
        await processDetailData(detail, shopId, ordering);
    }

    async function processDetailData(detail, shopId, ordering = {}) {
        const convoId = normalizeId(detail?.conversation_id);
        if (!convoId || !isLiveConversation(convoId) || !chrome.runtime?.id) return false;

        lastConvoId = convoId;
        const responseTimestamp = Date.now();
        const sourceSequence = normalizeSequence(ordering.requestSequence);
        const receiptHistory = Array.isArray(detail.receipt_history) ? detail.receipt_history : [];
        const receiptId = receiptHistory[0]?.receipt_id;
        let finalMessages = Array.isArray(detail.messages) ? detail.messages : [];

        if (shopId) await updateGlobalParam(STORAGE_KEYS.SHOP_ID, String(shopId));

        if (receiptId && shopId) {
            const missionControlMessages = await fetchMissionControlHistory(shopId, receiptId);
            if (!(await isResponseCurrent(convoId, sourceSequence))) return false;
            if (missionControlMessages.length > 0) finalMessages = missionControlMessages;
        }

        if (finalMessages.length > 0 && await isResponseCurrent(convoId, sourceSequence)) {
            await chrome.storage.local.set({
                [STORAGE_KEYS.CHAT_HISTORY]: {
                    convo_id: convoId,
                    customer_display_name: String(detail.other_user?.display_name || '').trim(),
                    customer_user_id: detail.other_user?.user_id
                        ? String(detail.other_user.user_id)
                        : null,
                    messages: normalizeMessages(finalMessages),
                    timestamp: responseTimestamp,
                    sourceSessionId: CONTENT_SESSION_ID,
                    sourceSequence
                }
            });
            window.ShopIntelligenceManager?.maybeBootstrap?.('conversation_loaded');
        }

        if (!(await isResponseCurrent(convoId, sourceSequence))) return false;

        let listingId = extractListingId(detail);
        const transactionId = receiptHistory[0]?.transactions?.[0]?.transaction_id;
        if (!listingId && transactionId) listingId = await getListingIdFromTransaction(transactionId);

        if (!(await isResponseCurrent(convoId, sourceSequence))) return false;

        if (listingId) {
            await chrome.storage.local.set({
                [STORAGE_KEYS.CURRENT_LISTING_ID]: String(listingId),
                [STORAGE_KEYS.CURRENT_LISTING_SCOPE]: {
                    convoId,
                    listingId: String(listingId),
                    updatedAt: responseTimestamp,
                    sourceSessionId: CONTENT_SESSION_ID,
                    sourceSequence
                }
            });
        } else {
            await chrome.storage.local.remove([
                STORAGE_KEYS.CURRENT_LISTING_ID,
                STORAGE_KEYS.CURRENT_LISTING_SCOPE
            ]);
        }

        if (!(await isResponseCurrent(convoId, sourceSequence))) return false;

        // Analyze every newly received customer image after listing context is ready.
        // The image manager itself is additionally guarded against cross-conversation scope.
        if (window.ImageIntelligenceManager?.analyzeCurrentCustomerImages) {
            window.ImageIntelligenceManager.analyzeCurrentCustomerImages().catch(error => {
                console.warn('ImageIntelligence: background analysis failed', error);
            });
        }
        return true;
    }

    function setupNavigationListeners() {
        if (navigationListenersInstalled) return;
        navigationListenersInstalled = true;
        const onNavigation = () => {
            clearStaleStorage();
            if (window.location.pathname.startsWith('/messages')) {
                setTimeout(parseInitialContext, 0);
            }
        };
        window.addEventListener('etsy-ai-locationchange', onNavigation);
        window.addEventListener('popstate', onNavigation);
        window.addEventListener('hashchange', onNavigation);
    }

    function init() {
        // Install listeners globally even when the extension initially loads on a non-message
        // Etsy page. This lets an in-app SPA transition into /messages become fully hydrated
        // without requiring a page reload.
        if (!initialized) {
            initialized = true;
            setupMessageListener();
            setupNavigationListeners();
        }

        clearStaleStorage();
        if (window.location.pathname.startsWith('/messages')) parseInitialContext();
    }

    async function fetchMissionControlHistory(shopId, receiptId) {
        try {
            const url = `https://www.etsy.com/api/v3/ajax/shop/${encodeURIComponent(shopId)}/mission-control/orders/convos/${encodeURIComponent(receiptId)}`;
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
            return Array.isArray(data.messages) ? data.messages : [];
        } catch (error) {
            console.error('🔴 Mission-control API error:', error);
            return [];
        }
    }

    async function clearStaleStorage() {
        if (!chrome.runtime?.id) return;
        const currentConvoId = getConvoIdFromUrl();

        try {
            const result = await chrome.storage.local.get([
                STORAGE_KEYS.CHAT_HISTORY,
                STORAGE_KEYS.CURRENT_LISTING_SCOPE
            ]);
            const chatHistory = result[STORAGE_KEYS.CHAT_HISTORY];
            const listingScope = result[STORAGE_KEYS.CURRENT_LISTING_SCOPE];
            const remove = [];

            if (!currentConvoId) {
                if (chatHistory) remove.push(STORAGE_KEYS.CHAT_HISTORY);
                if (listingScope) remove.push(STORAGE_KEYS.CURRENT_LISTING_ID, STORAGE_KEYS.CURRENT_LISTING_SCOPE);
            } else {
                if (chatHistory && normalizeId(chatHistory.convo_id) !== currentConvoId) {
                    remove.push(STORAGE_KEYS.CHAT_HISTORY);
                }
                if (listingScope && normalizeId(listingScope.convoId) !== currentConvoId) {
                    remove.push(STORAGE_KEYS.CURRENT_LISTING_ID, STORAGE_KEYS.CURRENT_LISTING_SCOPE);
                }
            }

            if (remove.length) await chrome.storage.local.remove([...new Set(remove)]);
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Failed to clear stale storage:', error);
        }
    }

    async function parseInitialContext() {
        if (!getConvoIdFromUrl()) return;
        try {
            const etsyContext = extractEtsyContext();
            const detail = etsyContext?.data?.initial_data?.detail;
            if (!detail || !isLiveConversation(detail.conversation_id)) return;

            const shopId = etsyContext?.data?.shop_id || detail?.shop_id || null;
            await processDetailData(detail, shopId, { requestSequence: 0 });
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Failed to parse initial context:', error);
        }
    }

    function extractEtsyContext() {
        if (window.Etsy?.Context) return window.Etsy.Context;

        const scripts = document.querySelectorAll('script[type="text/javascript"], script:not([src])');
        for (const script of scripts) {
            const content = script.textContent || '';
            if (!content.includes('Etsy.Context')) continue;
            const match = content.match(/Etsy\.Context\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
            if (!match) continue;
            try {
                return JSON.parse(match[1].replace(/;?\s*$/, ''));
            } catch (_) {
                // Keep scanning; Etsy can include unrelated script text before the real object.
            }
        }
        return null;
    }

    function normalizeListingId(value) {
        const match = normalizeId(value).match(/\d{5,}/);
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
                if (value && typeof value === 'object') stack.push(value);
            }
        }
        return null;
    }

    async function getListingIdFromTransaction(transactionId) {
        try {
            const response = await fetch(`https://www.etsy.com/transaction/${encodeURIComponent(transactionId)}`, {
                credentials: 'include',
                redirect: 'follow'
            });
            return response.url?.match(/\/listing\/(\d+)/)?.[1] || null;
        } catch (error) {
            console.error('🔴 EtsyContextInterceptor: Transaction redirect failed:', error);
            return null;
        }
    }

    async function updateGlobalParam(key, value) {
        if (!chrome.runtime?.id) return;
        try {
            const result = await chrome.storage.local.get([key]);
            if (result[key] !== value) await chrome.storage.local.set({ [key]: value });
        } catch (error) {
            console.error(`🔴 EtsyContextInterceptor: Failed to update ${key}:`, error);
        }
    }

    return {
        init,
        STORAGE_KEYS,
        getSessionId: () => CONTENT_SESSION_ID,
        async getShopId() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.SHOP_ID]);
            return result[STORAGE_KEYS.SHOP_ID] || null;
        },
        async getUserId() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.USER_ID]);
            return result[STORAGE_KEYS.USER_ID] || null;
        },
        async getCurrentListingId() {
            const result = await chrome.storage.local.get([
                STORAGE_KEYS.CURRENT_LISTING_ID,
                STORAGE_KEYS.CURRENT_LISTING_SCOPE
            ]);
            const listingId = result[STORAGE_KEYS.CURRENT_LISTING_ID];
            const scope = result[STORAGE_KEYS.CURRENT_LISTING_SCOPE];
            const live = getConvoIdFromUrl();
            if (live && normalizeId(scope?.convoId) !== live) return null;
            return listingId || null;
        },
        async getChatHistory() {
            const result = await chrome.storage.local.get([STORAGE_KEYS.CHAT_HISTORY]);
            const history = result[STORAGE_KEYS.CHAT_HISTORY] || null;
            return history && isLiveConversation(history.convo_id) ? history : null;
        },
        getState: () => ({ initialized, lastConvoId, sessionId: CONTENT_SESSION_ID })
    };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.EtsyContextInterceptor.init());
} else {
    window.EtsyContextInterceptor.init();
}
