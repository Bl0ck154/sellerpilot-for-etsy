// agent_scope_guard.js - Cross-conversation/page safety guards for AI context.
(() => {
    'use strict';

    if (!chrome?.runtime?.id) return;

    const CHAT_HISTORY_KEY = 'ETSY_CHAT_HISTORY';
    const LISTING_ID_KEY = 'ETSY_CURRENT_LISTING_ID';
    const LISTING_SCOPE_KEY = 'ETSY_CURRENT_LISTING_SCOPE';
    const ACTIVE_FACTS_KEY = 'ETSY_AI_ACTIVE_CONTEXT_FACTS';
    const CURRENT_CONTEXT_KEY = 'current_context';

    let cleanupInFlight = false;
    let contextSyncTimer = null;
    let listingValidationTimer = null;
    let lastKnownLiveConversationId = getLiveConversationId();

    function normalizeId(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function getPathname(urlValue = location.href) {
        try { return new URL(urlValue, location.href).pathname || '/'; }
        catch (_) { return location.pathname || '/'; }
    }

    function getPageIdentity(urlValue = location.href) {
        const pathname = getPathname(urlValue);
        const conversationId = pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
        const editorListingId = pathname.match(/^\/your\/shops\/me\/listing-editor\/edit\/(\d+)/)?.[1] || null;
        const publicListingId = pathname.match(/^\/listing\/(\d+)/)?.[1] || null;
        let pageKind = 'other';
        if (conversationId) pageKind = 'messages';
        else if (/^\/messages(?:\/|$)/.test(pathname)) pageKind = 'messages-inbox';
        else if (editorListingId) pageKind = 'listing-editor';
        else if (publicListingId) pageKind = 'public-listing';
        else if (/^\/your\/shops\/me(?:\/|$)/.test(pathname)) pageKind = 'shop-dashboard';
        return {
            pathname,
            conversationId,
            listingId: editorListingId || publicListingId || null,
            pageKind,
            pageKey: `${pageKind}:${pathname}`
        };
    }

    function getLiveConversationId() {
        return getPageIdentity(location.href).conversationId;
    }

    function contextUrl(context) {
        return context?.metadata?.url || context?.page_url || context?.page_content?.metadata?.url || '';
    }

    function contextMatchesLive(context) {
        const url = contextUrl(context);
        if (!url) return false;
        return getPageIdentity(url).pageKey === getPageIdentity(location.href).pageKey;
    }

    function historyMatchesLive(chatHistory) {
        const liveConversationId = getLiveConversationId();
        if (!liveConversationId) return false;
        return normalizeId(chatHistory?.convo_id || chatHistory?.conversation_id) === liveConversationId;
    }

    async function storageGet(keys) {
        try { return await chrome.storage.local.get(keys); }
        catch (error) {
            console.warn('AgentScopeGuard: storage get failed', error);
            return {};
        }
    }

    async function storageSet(values) {
        try { await chrome.storage.local.set(values); return true; }
        catch (error) {
            console.warn('AgentScopeGuard: storage set failed', error);
            return false;
        }
    }

    async function storageRemove(keys) {
        try { await chrome.storage.local.remove(keys); return true; }
        catch (error) {
            console.warn('AgentScopeGuard: storage remove failed', error);
            return false;
        }
    }

    function extractDirectListingId(detail) {
        const candidates = [
            detail?.listing_id,
            detail?.listingId,
            detail?.listing?.listing_id,
            detail?.listing?.listingId,
            detail?.transaction?.listing_id,
            detail?.transaction?.listingId,
            detail?.receipt_history?.[0]?.transactions?.[0]?.listing_id,
            detail?.receipt_history?.[0]?.transactions?.[0]?.listingId,
            detail?.receipt_history?.[0]?.transactions?.[0]?.listing?.listing_id,
            detail?.receipt_history?.[0]?.transactions?.[0]?.listing?.listingId
        ];
        for (const value of candidates) {
            const match = normalizeId(value).match(/\d{5,}/);
            if (match) return match[0];
        }
        return null;
    }

    function getTransactionId(detail) {
        return normalizeId(
            detail?.transaction?.transaction_id ||
            detail?.transaction_id ||
            detail?.receipt_history?.[0]?.transactions?.[0]?.transaction_id
        ) || null;
    }

    async function setScopedListing(convoId, listingId) {
        if (!convoId || !listingId || getLiveConversationId() !== String(convoId)) return false;
        await storageSet({
            [LISTING_ID_KEY]: String(listingId),
            [LISTING_SCOPE_KEY]: {
                convoId: String(convoId),
                listingId: String(listingId),
                updatedAt: Date.now()
            }
        });
        return true;
    }

    async function resolveListingFromTransaction(transactionId, convoId) {
        if (!transactionId || !convoId) return null;
        try {
            const response = await fetch(`https://www.etsy.com/transaction/${encodeURIComponent(transactionId)}`, {
                credentials: 'include',
                redirect: 'follow'
            });
            const listingId = response?.url?.match(/\/listing\/(\d+)/)?.[1] || null;
            if (!listingId || getLiveConversationId() !== String(convoId)) return null;
            await setScopedListing(convoId, listingId);
            return listingId;
        } catch (error) {
            console.debug('AgentScopeGuard: transaction listing resolution skipped', error?.message || error);
            return null;
        }
    }

    function buildFreshPageContext() {
        try {
            const pageData = window.PageParser?.getFullPageData?.();
            if (!pageData) return null;
            return {
                page_content: {
                    title: pageData.title,
                    markdown: pageData.markdown,
                    excerpt: pageData.excerpt,
                    siteName: pageData.siteName,
                    hasContent: pageData.hasContent
                },
                metadata: pageData.metadata,
                page_url: location.href
            };
        } catch (error) {
            console.debug('AgentScopeGuard: fresh page parsing skipped', error?.message || error);
            return null;
        }
    }

    function installFreshContextGuard() {
        const original = window.EtsyAI_GetFreshContext;
        if (typeof original !== 'function' || original.__etsyScopeGuarded) return;

        const guarded = function () {
            const cached = original();
            if (cached && contextMatchesLive(cached)) return cached;
            return buildFreshPageContext() || null;
        };
        guarded.__etsyScopeGuarded = true;
        window.EtsyAI_GetFreshContext = guarded;
    }

    async function syncFreshCurrentContext() {
        const fresh = buildFreshPageContext();
        if (!fresh || !contextMatchesLive(fresh)) return false;
        await storageSet({ [CURRENT_CONTEXT_KEY]: fresh });
        return true;
    }

    function scheduleFreshContextSync(delayMs = 100) {
        if (contextSyncTimer) clearTimeout(contextSyncTimer);
        contextSyncTimer = setTimeout(() => {
            contextSyncTimer = null;
            syncFreshCurrentContext();
        }, delayMs);
    }

    async function clearStaleScopedState({ forceListingClear = false } = {}) {
        if (cleanupInFlight) return;
        cleanupInFlight = true;
        try {
            const liveConversationId = getLiveConversationId();
            const state = await storageGet([
                CHAT_HISTORY_KEY,
                LISTING_ID_KEY,
                LISTING_SCOPE_KEY,
                ACTIVE_FACTS_KEY
            ]);
            const remove = new Set();
            const history = state[CHAT_HISTORY_KEY];
            const listingScope = state[LISTING_SCOPE_KEY];
            const activeFacts = state[ACTIVE_FACTS_KEY];

            if (!liveConversationId) {
                if (history) remove.add(CHAT_HISTORY_KEY);
                if (state[LISTING_ID_KEY]) remove.add(LISTING_ID_KEY);
                if (listingScope) remove.add(LISTING_SCOPE_KEY);
                if (activeFacts) remove.add(ACTIVE_FACTS_KEY);
            } else {
                if (history && !historyMatchesLive(history)) remove.add(CHAT_HISTORY_KEY);
                if (listingScope && normalizeId(listingScope.convoId) !== liveConversationId) {
                    remove.add(LISTING_ID_KEY);
                    remove.add(LISTING_SCOPE_KEY);
                } else if (forceListingClear && (!listingScope || normalizeId(listingScope.convoId) !== liveConversationId)) {
                    remove.add(LISTING_ID_KEY);
                    remove.add(LISTING_SCOPE_KEY);
                }
                if (activeFacts && normalizeId(activeFacts.convoId) !== liveConversationId) {
                    remove.add(ACTIVE_FACTS_KEY);
                }
            }

            if (remove.size) await storageRemove([...remove]);
        } finally {
            cleanupInFlight = false;
        }
    }

    async function validateCurrentListingId() {
        const liveConversationId = getLiveConversationId();
        if (!liveConversationId) return;
        const state = await storageGet([LISTING_ID_KEY, LISTING_SCOPE_KEY]);
        const listingId = normalizeId(state[LISTING_ID_KEY]);
        if (!listingId) return;
        const scope = state[LISTING_SCOPE_KEY];
        const valid = normalizeId(scope?.convoId) === liveConversationId &&
            normalizeId(scope?.listingId) === listingId;
        if (!valid) await storageRemove([LISTING_ID_KEY, LISTING_SCOPE_KEY]);
    }

    function scheduleListingValidation() {
        if (listingValidationTimer) clearTimeout(listingValidationTimer);
        listingValidationTimer = setTimeout(() => {
            listingValidationTimer = null;
            validateCurrentListingId();
        }, 120);
    }

    async function bindListingScopeFromDetail(data) {
        const detail = data?.detail;
        const liveConversationId = getLiveConversationId();
        const detailConversationId = normalizeId(detail?.conversation_id);
        if (!detail || !liveConversationId || detailConversationId !== liveConversationId) return false;

        const listingId = extractDirectListingId(detail);
        if (listingId) return setScopedListing(liveConversationId, listingId);

        const transactionId = getTransactionId(detail);
        if (transactionId) {
            resolveListingFromTransaction(transactionId, liveConversationId);
        }
        return false;
    }

    async function getScopedListingId() {
        const live = getPageIdentity(location.href);
        if (live.listingId) return live.listingId;
        if (!live.conversationId) return null;
        const state = await storageGet([LISTING_ID_KEY, LISTING_SCOPE_KEY]);
        const listingId = normalizeId(state[LISTING_ID_KEY]);
        const scope = state[LISTING_SCOPE_KEY];
        return listingId &&
            normalizeId(scope?.convoId) === live.conversationId &&
            normalizeId(scope?.listingId) === listingId
            ? listingId
            : null;
    }

    function patchRagContext() {
        const instructions = window.BaseAIService?.INSTRUCTIONS;
        if (!instructions || instructions.getRAGContext?.__etsyScopeGuarded) return;
        const original = instructions.getRAGContext.bind(instructions);
        const guarded = async function () {
            if (/^\/messages\/\d+/.test(location.pathname)) {
                const scopedListingId = await getScopedListingId();
                if (!scopedListingId) return '';
            }
            return original();
        };
        guarded.__etsyScopeGuarded = true;
        instructions.getRAGContext = guarded;
    }

    function emptyImageMetadata() {
        return {
            imageIntelCount: 0,
            imageIntelCustomerCount: 0,
            imageIntelUnknownRoleCount: 0,
            imageIntelAvailableCount: 0,
            imageIntelFailedCount: 0,
            imageIntelOversizedCount: 0,
            imageIntelDeferredCount: 0,
            imageIntelCoverage: 0,
            imageIntelAnalyzedThisRequest: 0,
            imageIntelErrors: []
        };
    }

    function patchImageIntelligence() {
        const manager = window.ImageIntelligenceManager;
        if (!manager || manager.__etsyScopeGuarded) return;
        const originalAnalyze = manager.analyzeCurrentCustomerImages.bind(manager);
        const originalBuild = manager.buildContextSection.bind(manager);
        const originalMetadata = manager.getMetadata.bind(manager);

        manager.analyzeCurrentCustomerImages = async function (...args) {
            const state = await storageGet([CHAT_HISTORY_KEY]);
            if (!historyMatchesLive(state[CHAT_HISTORY_KEY])) return emptyImageMetadata();
            return originalAnalyze(...args);
        };
        manager.buildContextSection = async function (...args) {
            const state = await storageGet([CHAT_HISTORY_KEY]);
            if (!historyMatchesLive(state[CHAT_HISTORY_KEY])) return '';
            return originalBuild(...args);
        };
        manager.getMetadata = function (...args) {
            if (lastKnownLiveConversationId !== getLiveConversationId()) return emptyImageMetadata();
            return originalMetadata(...args);
        };
        manager.__etsyScopeGuarded = true;
    }

    function summaryIdentity(chatHistory, omittedMessages) {
        const convoId = normalizeId(chatHistory?.convo_id);
        if (!convoId || !omittedMessages?.length) return '';
        let material = `${convoId}|${omittedMessages.length}`;
        for (const item of omittedMessages) {
            const message = item?.message || item || {};
            material += `|${item?.sourceIndex ?? ''}:${message.message_id || message.convo_message_id || message.id || ''}:${message.create_date || ''}:${message.message_body || message.message || message.body || message.text || ''}`;
        }
        let hash = 0;
        for (let index = 0; index < material.length; index++) {
            hash = ((hash << 5) - hash) + material.charCodeAt(index);
            hash |= 0;
        }
        return `${convoId}:${Math.abs(hash).toString(36)}`;
    }

    function patchConversationSummaryQueue() {
        const manager = window.ConversationContextManager;
        if (!manager || manager.__etsyWriteSerialized) return;
        const originalCached = manager.getCachedSummary.bind(manager);
        const originalPrecompute = manager.precomputeSummary.bind(manager);
        let writeQueue = Promise.resolve();
        const tasks = new Map();

        function enqueue(chatHistory, omittedMessages) {
            const key = summaryIdentity(chatHistory, omittedMessages);
            if (!key) return Promise.resolve('');
            if (tasks.has(key)) return tasks.get(key);

            const task = writeQueue
                .catch(() => undefined)
                .then(() => originalPrecompute(chatHistory, omittedMessages));
            writeQueue = task.then(() => undefined, () => undefined);
            tasks.set(key, task);
            task.finally(() => {
                if (tasks.get(key) === task) tasks.delete(key);
            });
            return task;
        }

        manager.precomputeSummary = enqueue;
        manager.getOrCreateSummary = async function (chatHistory, omittedMessages, options = {}) {
            const cached = await originalCached(chatHistory, omittedMessages);
            if (cached) return cached;

            const task = enqueue(chatHistory, omittedMessages);
            const requested = Number(options.maxWaitMs);
            const waitMs = Number.isFinite(requested)
                ? Math.max(0, Math.min(requested, 10000))
                : Number(manager.DEFAULT_FOREGROUND_WAIT_MS || 1200);
            if (waitMs <= 0) return '';
            return new Promise(resolve => {
                let settled = false;
                const timeoutId = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    resolve('');
                }, waitMs);
                task.then(summary => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(summary || '');
                }, () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve('');
                });
            });
        };
        manager.__etsyWriteSerialized = true;
    }

    function patchShopIntelligence() {
        const manager = window.ShopIntelligenceManager;
        if (!manager || manager.__etsyScopeGuarded) return;
        const originalBuild = manager.buildContextSection.bind(manager);
        const originalMetadata = manager.getMetadata.bind(manager);

        manager.buildContextSection = async function (...args) {
            const state = await storageGet([CURRENT_CONTEXT_KEY]);
            if (!contextMatchesLive(state[CURRENT_CONTEXT_KEY])) return '';
            return originalBuild(...args);
        };
        manager.getMetadata = async function (...args) {
            const state = await storageGet([CURRENT_CONTEXT_KEY]);
            const metadata = await originalMetadata(...args);
            if (contextMatchesLive(state[CURRENT_CONTEXT_KEY])) return metadata;
            return { ...metadata, shopIntelActive: false, shopIntelReason: 'page_scope_mismatch' };
        };
        manager.__etsyScopeGuarded = true;
    }

    async function handleNavigation() {
        const previousConversationId = lastKnownLiveConversationId;
        const currentConversationId = getLiveConversationId();
        lastKnownLiveConversationId = currentConversationId;

        // Never leave the previous page snapshot available while Etsy's SPA is between
        // routes. A fresh deterministic snapshot is stored shortly after the new DOM settles.
        await storageRemove([CURRENT_CONTEXT_KEY]);
        await clearStaleScopedState({
            forceListingClear: previousConversationId !== currentConversationId
        });
        installFreshContextGuard();
        scheduleFreshContextSync(100);
    }

    window.addEventListener('message', event => {
        if (event.source !== window || event.data?.source !== 'etsy-page-interceptor') return;
        if (event.data?.type !== 'ETSY_DETAIL_VIEW_DATA') return;
        const detailConversationId = normalizeId(event.data.data?.detail?.conversation_id);
        const liveConversationId = getLiveConversationId();
        if (!liveConversationId || detailConversationId !== liveConversationId) {
            clearStaleScopedState();
            return;
        }
        bindListingScopeFromDetail(event.data.data).catch(() => {});
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes[CHAT_HISTORY_KEY]) {
            const history = changes[CHAT_HISTORY_KEY].newValue;
            if (historyMatchesLive(history)) {
                lastKnownLiveConversationId = getLiveConversationId();
            } else if (history) {
                clearStaleScopedState();
            }
        }
        if (changes[LISTING_ID_KEY]) scheduleListingValidation();
    });

    window.addEventListener('etsy-ai-locationchange', handleNavigation);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);

    installFreshContextGuard();
    patchRagContext();
    patchImageIntelligence();
    patchConversationSummaryQueue();
    patchShopIntelligence();
    clearStaleScopedState({ forceListingClear: true });

    window.EtsyAgentScopeGuard = {
        LISTING_SCOPE_KEY,
        getPageIdentity,
        contextMatchesLive,
        historyMatchesLive,
        getScopedListingId,
        buildFreshPageContext,
        clearStaleScopedState,
        bindListingScopeFromDetail,
        resolveListingFromTransaction
    };
})();
