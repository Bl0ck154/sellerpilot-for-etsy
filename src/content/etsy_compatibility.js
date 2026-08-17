// Etsy compatibility layer - resilient DOM adapters, fallbacks, diagnostics, and remote selector data.
(function () {
    'use strict';

    const CONFIG_SCHEMA_VERSION = 1;
    const CONFIG_PATH = 'config/etsy_compatibility.json';
    const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/Bl0ck154/ChromeExtensionEtsyAI/main/src/config/etsy_compatibility.json';
    const CONFIG_CACHE_KEY = 'ETSY_COMPATIBILITY_CONFIG_CACHE';
    const DIAGNOSTICS_KEY = 'ETSY_COMPATIBILITY_DIAGNOSTICS';
    const FALLBACK_HISTORY_SOURCE_PREFIX = 'compatibility-';
    const DEFAULT_REMOTE_TTL_MS = 6 * 60 * 60 * 1000;
    const MAX_DOM_FALLBACK_MESSAGES = 50;
    const MAX_DOM_MESSAGE_CHARS = 5000;

    const BASE_CONFIG = {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        configVersion: 'builtin-1',
        remoteTtlMs: DEFAULT_REMOTE_TTL_MS,
        selectors: {
            composer: [
                { id: 'legacy-textarea', selector: 'textarea.wt-textarea', confidence: 1 },
                { id: 'reply-placeholder', selector: 'textarea[placeholder*="reply" i]', confidence: 0.96 },
                { id: 'reply-aria', selector: 'textarea[aria-label*="reply" i]', confidence: 0.96 },
                { id: 'messages-form-textarea', selector: '.detail-view form textarea, main form textarea', confidence: 0.78 },
                { id: 'contenteditable-reply', selector: '[contenteditable="true"][role="textbox"]', confidence: 0.6 }
            ],
            composeContainer: [
                { id: 'legacy-inline-compose', selector: '.inline-compose-container', confidence: 1 },
                { id: 'composer-form', selector: 'form:has(textarea[placeholder*="reply" i])', confidence: 0.85 },
                { id: 'composer-form-aria', selector: 'form:has(textarea[aria-label*="reply" i])', confidence: 0.85 }
            ],
            messageList: [
                { id: 'legacy-message-list', selector: '.msg-list-container', confidence: 1 },
                { id: 'legacy-scrolling-list', selector: '.scrolling-message-list', confidence: 0.9 },
                { id: 'message-log', selector: '[role="log"]', confidence: 0.82 },
                { id: 'message-region', selector: '[aria-label*="message" i][role="region"]', confidence: 0.7 }
            ],
            scrollingMessageList: [
                { id: 'legacy-scrolling-list', selector: '.scrolling-message-list', confidence: 1 },
                { id: 'message-log', selector: '[role="log"]', confidence: 0.82 }
            ],
            detailView: [
                { id: 'legacy-detail-view', selector: '.detail-view', confidence: 1 },
                { id: 'composer-ancestor-main', selector: 'main', confidence: 0.55 }
            ],
            gridRoot: [
                { id: 'legacy-grid-root', selector: '.wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full', confidence: 1 },
                { id: 'messages-main-grid', selector: 'main .wt-grid.wt-width-full', confidence: 0.78 }
            ],
            leftColumn: [
                { id: 'legacy-left-column', selector: '.wt-grid__item-lg-2', confidence: 1 },
                { id: 'inbox-navigation', selector: 'nav[aria-label*="message" i], aside nav', confidence: 0.55 }
            ],
            rightColumn: [
                { id: 'legacy-right-column', selector: '.wt-grid__item-lg-3', confidence: 1 },
                { id: 'order-details-aside', selector: 'aside[aria-label*="order" i], aside[aria-label*="detail" i]', confidence: 0.7 }
            ],
            messageBubble: [
                { id: 'message-id', selector: '[data-message-id]', confidence: 0.92 },
                { id: 'conversation-message-id', selector: '[data-conversation-message-id]', confidence: 0.92 },
                { id: 'message-list-items', selector: '[role="log"] > *', confidence: 0.55 }
            ]
        },
        knownLayouts: [
            {
                id: 'etsy-messages-three-column',
                pageKind: 'conversation',
                required: ['composer', 'messageList', 'detailView'],
                optional: ['gridRoot', 'leftColumn', 'rightColumn']
            },
            {
                id: 'etsy-messages-inbox',
                pageKind: 'inbox',
                required: ['gridRoot'],
                optional: ['leftColumn']
            }
        ]
    };

    let activeConfig = BASE_CONFIG;
    let configSource = 'builtin';
    let observer = null;
    let refreshTimer = null;
    let configLoadPromise = null;
    let lastDiagnosticSignature = '';
    let lastDiagnostics = null;
    let lastNetworkSeenAt = 0;

    function normalizeId(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function trimText(value, maxChars = MAX_DOM_MESSAGE_CHARS) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return text.length > maxChars ? `${text.slice(0, maxChars).trim()} [trimmed]` : text;
    }

    function getConversationId() {
        return location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function getPageKind() {
        if (getConversationId()) return 'conversation';
        if (/^\/messages(?:\/|$)/.test(location.pathname)) return 'inbox';
        return 'other';
    }

    function isSelectorDefinition(value) {
        return !!value &&
            typeof value === 'object' &&
            typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 80 &&
            typeof value.selector === 'string' && value.selector.length > 0 && value.selector.length <= 300 &&
            !/[\u0000-\u001f]/.test(value.selector) &&
            (value.confidence === undefined || (Number.isFinite(Number(value.confidence)) && Number(value.confidence) >= 0 && Number(value.confidence) <= 1));
    }

    function validateConfig(candidate) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
        if (Number(candidate.schemaVersion) !== CONFIG_SCHEMA_VERSION) return null;
        if (!candidate.selectors || typeof candidate.selectors !== 'object' || Array.isArray(candidate.selectors)) return null;

        const selectors = {};
        for (const [key, list] of Object.entries(candidate.selectors)) {
            if (!Array.isArray(list)) continue;
            const valid = list.filter(isSelectorDefinition).slice(0, 20).map(item => ({
                id: item.id,
                selector: item.selector,
                confidence: item.confidence === undefined ? 0.5 : Number(item.confidence)
            }));
            if (valid.length) selectors[key] = valid;
        }
        if (!Object.keys(selectors).length) return null;

        const knownLayouts = Array.isArray(candidate.knownLayouts)
            ? candidate.knownLayouts.filter(layout => layout && typeof layout.id === 'string').slice(0, 20).map(layout => ({
                id: layout.id.slice(0, 100),
                pageKind: ['conversation', 'inbox', 'other'].includes(layout.pageKind) ? layout.pageKind : 'other',
                required: Array.isArray(layout.required) ? layout.required.filter(item => typeof item === 'string').slice(0, 20) : [],
                optional: Array.isArray(layout.optional) ? layout.optional.filter(item => typeof item === 'string').slice(0, 20) : []
            }))
            : [];

        const ttl = Number(candidate.remoteTtlMs);
        return {
            schemaVersion: CONFIG_SCHEMA_VERSION,
            configVersion: String(candidate.configVersion || 'unknown').slice(0, 80),
            remoteTtlMs: Number.isFinite(ttl) ? Math.min(Math.max(ttl, 5 * 60 * 1000), 7 * 24 * 60 * 60 * 1000) : DEFAULT_REMOTE_TTL_MS,
            selectors,
            knownLayouts
        };
    }

    function mergeConfig(base, overlay) {
        const validOverlay = validateConfig(overlay);
        if (!validOverlay) return base;
        return {
            ...base,
            ...validOverlay,
            selectors: {
                ...base.selectors,
                ...validOverlay.selectors
            },
            knownLayouts: validOverlay.knownLayouts.length ? validOverlay.knownLayouts : base.knownLayouts
        };
    }

    async function storageGet(keys) {
        if (!chrome.runtime?.id) return {};
        try { return await chrome.storage.local.get(keys); }
        catch (_) { return {}; }
    }

    async function storageSet(values) {
        if (!chrome.runtime?.id) return false;
        try {
            await chrome.storage.local.set(values);
            return true;
        } catch (_) {
            return false;
        }
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    async function loadConfig(forceRemote = false) {
        if (configLoadPromise && !forceRemote) return configLoadPromise;

        configLoadPromise = (async () => {
            let next = BASE_CONFIG;
            let nextSource = 'builtin';

            try {
                const local = await fetchJson(chrome.runtime.getURL(CONFIG_PATH), { cache: 'no-store' });
                const validatedLocal = validateConfig(local);
                if (validatedLocal) {
                    next = mergeConfig(next, validatedLocal);
                    nextSource = 'packaged';
                }
            } catch (error) {
                console.warn('Etsy compatibility: packaged config unavailable, using built-in defaults', error);
            }

            const cache = await storageGet([CONFIG_CACHE_KEY]);
            const cached = cache[CONFIG_CACHE_KEY];
            const ttl = next.remoteTtlMs || DEFAULT_REMOTE_TTL_MS;
            const cachedFresh = cached?.fetchedAt && Date.now() - Number(cached.fetchedAt) < ttl;
            const validatedCached = validateConfig(cached?.config);

            if (!forceRemote && cachedFresh && validatedCached) {
                next = mergeConfig(next, validatedCached);
                nextSource = 'remote-cache';
            } else {
                try {
                    const remote = await fetchJson(REMOTE_CONFIG_URL, { cache: 'no-store', credentials: 'omit' });
                    const validatedRemote = validateConfig(remote);
                    if (validatedRemote) {
                        next = mergeConfig(next, validatedRemote);
                        nextSource = 'remote';
                        await storageSet({
                            [CONFIG_CACHE_KEY]: {
                                fetchedAt: Date.now(),
                                config: validatedRemote
                            }
                        });
                    } else if (validatedCached) {
                        next = mergeConfig(next, validatedCached);
                        nextSource = 'stale-remote-cache';
                    }
                } catch (_) {
                    // Private repository, temporary network failures, or raw GitHub outages are non-fatal.
                    if (validatedCached) {
                        next = mergeConfig(next, validatedCached);
                        nextSource = cachedFresh ? 'remote-cache' : 'stale-remote-cache';
                    }
                }
            }

            activeConfig = next;
            configSource = nextSource;
            scheduleRefresh(true);
            return activeConfig;
        })().finally(() => {
            configLoadPromise = null;
        });

        return configLoadPromise;
    }

    function safeQuery(root, selector) {
        if (!root?.querySelector || !selector) return null;
        try { return root.querySelector(selector); }
        catch (_) { return null; }
    }

    function safeQueryAll(root, selector) {
        if (!root?.querySelectorAll || !selector) return [];
        try { return Array.from(root.querySelectorAll(selector)); }
        catch (_) { return []; }
    }

    function find(name, root = document) {
        const strategies = activeConfig.selectors?.[name] || BASE_CONFIG.selectors[name] || [];
        for (const strategy of strategies) {
            const element = safeQuery(root, strategy.selector);
            if (element) {
                return {
                    element,
                    strategy: strategy.id,
                    confidence: Number(strategy.confidence) || 0.5,
                    selector: strategy.selector
                };
            }
        }
        return null;
    }

    function findAll(name, root = document) {
        const strategies = activeConfig.selectors?.[name] || BASE_CONFIG.selectors[name] || [];
        for (const strategy of strategies) {
            const elements = safeQueryAll(root, strategy.selector);
            if (elements.length) {
                return {
                    elements,
                    strategy: strategy.id,
                    confidence: Number(strategy.confidence) || 0.5,
                    selector: strategy.selector
                };
            }
        }
        return { elements: [], strategy: null, confidence: 0, selector: null };
    }

    function resolveComposeContainer(composerResult) {
        const direct = find('composeContainer');
        if (direct) return direct;
        const composer = composerResult?.element;
        if (!composer) return null;
        const form = composer.closest?.('form');
        if (form) return { element: form, strategy: 'composer-closest-form', confidence: 0.75, selector: null };
        const parent = composer.parentElement;
        return parent ? { element: parent, strategy: 'composer-parent', confidence: 0.45, selector: null } : null;
    }

    function resolveDetailView(composerResult) {
        const direct = find('detailView');
        if (direct && direct.strategy !== 'composer-ancestor-main') return direct;
        const composer = composerResult?.element;
        const candidate = composer?.closest?.('.detail-view, main, [role="main"]');
        if (candidate) return { element: candidate, strategy: 'composer-ancestor', confidence: 0.7, selector: null };
        return direct;
    }

    function resolveGridRoot(detailResult) {
        const direct = find('gridRoot');
        if (direct) return direct;
        const detail = detailResult?.element;
        const candidate = detail?.parentElement;
        return candidate ? { element: candidate, strategy: 'detail-parent', confidence: 0.4, selector: null } : null;
    }

    function addClasses(element, classNames) {
        if (!element?.classList) return;
        for (const className of classNames) element.classList.add(className);
    }

    function normalizeDom() {
        const pageKind = getPageKind();
        if (pageKind === 'other') return null;

        const composer = find('composer');
        const composeContainer = resolveComposeContainer(composer);
        const messageList = find('messageList');
        const scrollingMessageList = find('scrollingMessageList');
        const detailView = resolveDetailView(composer);
        const gridRoot = resolveGridRoot(detailView);
        const leftColumn = find('leftColumn', gridRoot?.element || document);
        const rightColumn = find('rightColumn', gridRoot?.element || document);

        // Existing modules intentionally consume these compatibility classes. If Etsy changes
        // its CSS names, the adapter can re-identify the semantic element and restore the
        // legacy class contract without rewriting every feature module.
        addClasses(composer?.element, ['wt-textarea', 'etsy-ai-compat-composer']);
        addClasses(composeContainer?.element, ['inline-compose-container', 'etsy-ai-compat-compose-container']);
        addClasses(messageList?.element, ['msg-list-container', 'etsy-ai-compat-message-list']);
        addClasses(scrollingMessageList?.element, ['scrolling-message-list', 'etsy-ai-compat-scrolling-list']);

        // Full-page layout rewrites are more invasive than composer/message detection. Only
        // expose the legacy layout contract when both the detail view and grid root were
        // identified with strong confidence. Unknown layouts stay intact and diagnostics
        // report them instead of risking a destructive mis-layout.
        const layoutSafeToNormalize = (Number(detailView?.confidence) || 0) >= 0.65 &&
            (Number(gridRoot?.confidence) || 0) >= 0.7;
        if (layoutSafeToNormalize) {
            addClasses(detailView?.element, ['detail-view', 'etsy-ai-compat-detail-view']);
            addClasses(gridRoot?.element, ['wt-grid', 'wt-overflow-hidden', 'wt-bt-xs', 'wt-width-full', 'etsy-ai-compat-grid-root']);
            addClasses(leftColumn?.element, ['wt-grid__item-lg-2', 'etsy-ai-compat-left-column']);
            addClasses(rightColumn?.element, ['wt-grid__item-lg-3', 'etsy-ai-compat-right-column']);
        }

        return { composer, composeContainer, messageList, scrollingMessageList, detailView, gridRoot, leftColumn, rightColumn };
    }

    function extractEtsyContextFromScripts() {
        if (window.Etsy?.Context) return window.Etsy.Context;
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
            const content = script.textContent || '';
            if (!content.includes('Etsy.Context')) continue;
            const match = content.match(/Etsy\.Context\s*=\s*(\{[\s\S]*?\});?\s*(?:$|\n)/);
            if (!match) continue;
            try { return JSON.parse(match[1].replace(/;?\s*$/, '')); }
            catch (_) { /* keep scanning */ }
        }
        return null;
    }

    function normalizeFallbackMessages(messages) {
        return (Array.isArray(messages) ? messages : []).slice(-MAX_DOM_FALLBACK_MESSAGES).map((message, index) => ({
            ...message,
            message_body: trimText(message?.message_body ?? message?.message ?? message?.body ?? message?.text),
            attachments: Array.isArray(message?.attachments) ? message.attachments : (Array.isArray(message?.images) ? message.images : []),
            compatibility_fallback: true,
            compatibility_index: index
        })).filter(message => message.message_body || message.attachments.length);
    }

    function extractEmbeddedConversation(conversationId) {
        const context = extractEtsyContextFromScripts();
        const detail = context?.data?.initial_data?.detail;
        if (!detail || normalizeId(detail.conversation_id) !== normalizeId(conversationId)) return null;
        const messages = normalizeFallbackMessages(detail.messages);
        if (!messages.length) return null;
        return {
            convo_id: normalizeId(conversationId),
            customer_display_name: trimText(detail.other_user?.display_name, 200),
            customer_user_id: detail.other_user?.user_id ? String(detail.other_user.user_id) : null,
            messages,
            source: `${FALLBACK_HISTORY_SOURCE_PREFIX}embedded-context`,
            compatibilityDegraded: true,
            timestamp: Date.now()
        };
    }

    function extractDomConversation(conversationId) {
        const list = find('messageList')?.element || document;
        const result = findAll('messageBubble', list);
        const seen = new Set();
        const messages = [];

        for (const element of result.elements) {
            const text = trimText(element.innerText || element.textContent || '');
            if (!text || seen.has(text)) continue;
            seen.add(text);
            messages.push({
                message_body: text,
                sender_type: 'participant',
                compatibility_fallback: true,
                compatibility_source: 'visible-dom'
            });
            if (messages.length >= MAX_DOM_FALLBACK_MESSAGES) break;
        }

        if (!messages.length) return null;
        return {
            convo_id: normalizeId(conversationId),
            customer_display_name: '',
            customer_user_id: null,
            messages,
            source: `${FALLBACK_HISTORY_SOURCE_PREFIX}visible-dom`,
            compatibilityDegraded: true,
            timestamp: Date.now()
        };
    }

    function isFallbackHistory(history) {
        return typeof history?.source === 'string' && history.source.startsWith(FALLBACK_HISTORY_SOURCE_PREFIX);
    }

    async function hydrateConversationFallback() {
        const conversationId = getConversationId();
        if (!conversationId || !chrome.runtime?.id) return { source: 'none', updated: false };

        const state = await storageGet(['ETSY_CHAT_HISTORY']);
        const existing = state.ETSY_CHAT_HISTORY;
        if (existing?.messages?.length && normalizeId(existing.convo_id) === conversationId && !isFallbackHistory(existing)) {
            return { source: 'primary', updated: false };
        }

        const embedded = extractEmbeddedConversation(conversationId);
        const fallback = embedded || extractDomConversation(conversationId);
        if (!fallback) return { source: 'unavailable', updated: false };

        const existingMessageCount = Array.isArray(existing?.messages) ? existing.messages.length : 0;
        const candidateMessageCount = fallback.messages.length;
        const sameConversation = normalizeId(existing?.convo_id) === conversationId;
        const shouldWrite = !sameConversation || !existingMessageCount || (isFallbackHistory(existing) && candidateMessageCount >= existingMessageCount);
        if (!shouldWrite) return { source: existing?.source || 'existing', updated: false };

        await storageSet({ ETSY_CHAT_HISTORY: fallback });
        return { source: fallback.source, updated: true };
    }

    function classifyLayout(snapshot) {
        const pageKind = getPageKind();
        for (const layout of activeConfig.knownLayouts || []) {
            if (layout.pageKind !== pageKind) continue;
            if ((layout.required || []).every(key => !!snapshot[key]?.element)) return layout.id;
        }
        return pageKind === 'other' ? 'not-messages' : 'unknown';
    }

    function getLayoutFingerprint(snapshot = normalizeDom() || {}) {
        const pageKind = getPageKind();
        const keys = ['composer', 'messageList', 'detailView', 'gridRoot', 'leftColumn', 'rightColumn'];
        const parts = keys.map(key => `${key}:${snapshot[key]?.strategy || 'missing'}`);
        return `${pageKind}|${parts.join('|')}`;
    }

    async function runSelfTest() {
        const pageKind = getPageKind();
        const snapshot = normalizeDom() || {};
        const fallbackState = await hydrateConversationFallback();
        const conversationId = getConversationId();
        const layout = classifyLayout(snapshot);
        const fingerprint = getLayoutFingerprint(snapshot);
        const interceptorInjected = window.__ETSY_INTERCEPTOR_INJECTED__ === true;
        const networkRecentlySeen = lastNetworkSeenAt > 0 && Date.now() - lastNetworkSeenAt < 5 * 60 * 1000;

        const checks = {
            conversationId: pageKind !== 'conversation' || !!conversationId,
            composer: pageKind !== 'conversation' || !!snapshot.composer?.element,
            messageList: pageKind !== 'conversation' || !!snapshot.messageList?.element,
            detailView: pageKind !== 'conversation' || !!snapshot.detailView?.element,
            interceptorInjected,
            conversationContext: pageKind !== 'conversation' || fallbackState.source === 'primary' || fallbackState.source.startsWith(FALLBACK_HISTORY_SOURCE_PREFIX)
        };

        const requiredHealthy = checks.conversationId && checks.composer && checks.messageList && checks.detailView;
        let status = 'healthy';
        if (pageKind === 'other') status = 'inactive';
        else if (!requiredHealthy || layout === 'unknown') status = 'unknown-layout';
        else if (!interceptorInjected || fallbackState.source !== 'primary') status = 'degraded';

        const diagnostics = {
            version: 1,
            checkedAt: Date.now(),
            urlPath: location.pathname,
            pageKind,
            status,
            layout,
            fingerprint,
            configVersion: activeConfig.configVersion,
            configSource,
            networkRecentlySeen,
            fallbackSource: fallbackState.source,
            checks,
            strategies: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value?.strategy || null]))
        };

        lastDiagnostics = diagnostics;
        await storageSet({ [DIAGNOSTICS_KEY]: diagnostics });
        document.documentElement.dataset.etsyAiCompatibility = status;
        document.documentElement.dataset.etsyAiLayout = layout;
        window.dispatchEvent(new CustomEvent('etsy-ai-compatibility-status', { detail: diagnostics }));

        const signature = `${status}|${layout}|${fingerprint}|${fallbackState.source}`;
        if (signature !== lastDiagnosticSignature && (status === 'degraded' || status === 'unknown-layout')) {
            console.warn('Etsy compatibility:', status, diagnostics);
        }
        lastDiagnosticSignature = signature;
        return diagnostics;
    }

    function scheduleRefresh(forceConfig = false) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            normalizeDom();
            runSelfTest().catch(error => console.warn('Etsy compatibility self-test failed', error));
            if (forceConfig) normalizeDom();
        }, 120);
    }

    function onNavigation() {
        scheduleRefresh();
    }

    function installObservers() {
        if (observer || !document.documentElement) return;
        observer = new MutationObserver(() => scheduleRefresh());
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('etsy-ai-locationchange', onNavigation);
        window.addEventListener('popstate', onNavigation);
        window.addEventListener('hashchange', onNavigation);
        window.addEventListener('message', event => {
            if (event.source !== window || event.data?.source !== 'etsy-page-interceptor') return;
            if (event.data?.type === 'ETSY_DETAIL_VIEW_DATA') {
                lastNetworkSeenAt = Date.now();
                scheduleRefresh();
            }
        });
    }

    function init() {
        installObservers();
        normalizeDom();
        loadConfig().catch(error => console.warn('Etsy compatibility config load failed', error));
        scheduleRefresh();
    }

    const EtsyAdapter = {
        getConversationId,
        getPageKind,
        getConfig: () => activeConfig,
        find,
        findAll,
        findComposer: () => find('composer'),
        findMessageList: () => find('messageList'),
        findDetailView: () => resolveDetailView(find('composer')),
        findGridRoot: () => resolveGridRoot(resolveDetailView(find('composer'))),
        normalizeDom,
        extractEmbeddedConversation,
        extractDomConversation,
        getLayoutFingerprint
    };

    const EtsyCompatibility = {
        init,
        reloadConfig: () => loadConfig(true),
        runSelfTest,
        hydrateConversationFallback,
        normalizeDom,
        getDiagnostics: () => lastDiagnostics,
        getConfigSource: () => configSource
    };

    window.EtsyAdapter = EtsyAdapter;
    window.EtsyCompatibility = EtsyCompatibility;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
