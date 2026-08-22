// shop_intelligence_manager.js - Async Gemini shop intelligence cache
// Uses existing Etsy/page context only. Does not crawl Etsy or execute remote code.

window.ShopIntelligenceManager = (function () {
    const SUMMARY_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_SUMMARY';
    const REFRESH_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_LAST_REFRESH';
    const HASH_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_LAST_HASH';
    const VERSION = '2026-08-14.2';
    const COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const DEBOUNCE_MS = 45000;
    const MAX_CHAT_MESSAGES = 12;
    const MAX_MESSAGE_CHARS = 900;
    const MAX_PAGE_CHARS = 2500;
    const MAX_LISTING_DESC_CHARS = 2200;
    const MAX_CONTEXT_CHARS = 2200;

    let debounceTimer = null;
    let refreshInFlight = false;
    let lastMetadata = null;

    function trimText(text, maxChars) {
        if (!text || typeof text !== 'string') return '';
        const clean = text.replace(/\s+/g, ' ').trim();
        return clean.length > maxChars ? `${clean.slice(0, maxChars).trim()} [trimmed]` : clean;
    }

    function simpleHash(value) {
        const str = typeof value === 'string' ? value : JSON.stringify(value || {});
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function formatAge(ms) {
        if (!ms && ms !== 0) return 'unknown';
        if (ms < 60 * 1000) return `${Math.floor(ms / 1000)}s`;
        if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m`;
        if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)}h`;
        return `${Math.floor(ms / 86400000)}d`;
    }

    function getPageIdentity(urlValue) {
        let pathname = '';
        try {
            pathname = new URL(urlValue || location.href).pathname || '';
        } catch (_) {
            pathname = location.pathname || '';
        }

        const conversationId = pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
        const listingId = pathname.match(/^\/(?:listing|your\/shops\/me\/listing-editor\/edit)\/(\d+)/)?.[1] || null;
        let pageKind = 'other';
        if (conversationId) pageKind = 'messages';
        else if (listingId) pageKind = 'listing';
        else if (/^\/your\/shops\/me(?:\/|$)/.test(pathname)) pageKind = 'shop-dashboard';
        else if (/^\/messages(?:\/|$)/.test(pathname)) pageKind = 'messages-inbox';

        return { pageKind, pageKey: `${pageKind}:${pathname}`, conversationId, listingId };
    }

    function senderId(message) {
        return String(message?.sender_user_id || message?.sender_id || message?.user_id || message?.from_user_id || '').trim();
    }

    function participantRole(message, chatHistory, ownerIds) {
        const id = senderId(message);
        const customerId = String(chatHistory?.customer_user_id || '').trim();
        if (customerId && id) return customerId === id ? 'CUSTOMER' : 'OWNER';
        if (id && ownerIds.has(id)) return 'OWNER';

        const roleText = `${message?.sender_type || ''} ${message?.role || ''} ${message?.author_role || ''}`.toLowerCase();
        if (/buyer|customer/.test(roleText)) return 'CUSTOMER';
        if (/seller|shop|owner/.test(roleText)) return 'OWNER';

        const customerName = String(chatHistory?.customer_display_name || '').trim().toLowerCase();
        const senderName = String(message?.sender_display_name || message?.sender_name || '').trim().toLowerCase();
        if (customerName && senderName && customerName === senderName) return 'CUSTOMER';
        return 'PARTICIPANT';
    }

    function contextMatchesLivePage(context) {
        const url = context?.metadata?.url || context?.page_url || context?.page_content?.metadata?.url || '';
        if (!url) return false;
        return getPageIdentity(url).pageKey === getPageIdentity(location.href).pageKey;
    }

    function buildLivePageContext() {
        try {
            const page = window.PageParser?.getFullPageData?.();
            if (!page) return null;
            return {
                page_content: {
                    title: page.title,
                    markdown: page.markdown,
                    excerpt: page.excerpt,
                    siteName: page.siteName,
                    hasContent: page.hasContent
                },
                metadata: page.metadata,
                page_url: location.href
            };
        } catch (_) {
            return null;
        }
    }

    async function getLiveScopedConversationState(legacyHistory, legacyListingId) {
        const page = getPageIdentity(location.href);
        if (!page.conversationId || !window.ScopedConversationStore) {
            return { history: legacyHistory || null, listingId: legacyListingId || null };
        }

        const [scopedHistory, scopedListing] = await Promise.all([
            window.ScopedConversationStore.getHistory(page.conversationId),
            window.ScopedConversationStore.getListing(page.conversationId)
        ]);
        const legacyHistoryMatchesLive = String(legacyHistory?.convo_id || '').trim() === page.conversationId
            ? legacyHistory
            : null;
        return {
            history: scopedHistory || legacyHistoryMatchesLive,
            // getListing() already performs a guarded legacy migration when the
            // legacy listing scope matches this conversation. If it returned null,
            // using the unscoped mirror here could attach another tab's listing.
            listingId: scopedListing?.listingId || null
        };
    }

    function deriveSourceScope(metadata, chatHistory, storedListingId) {
        // The live tab URL is the authoritative scope guard. Stored page context can
        // briefly lag behind SPA navigation and must not reopen the previous customer.
        const liveUrl = typeof location !== 'undefined' && location.href ? location.href : metadata?.url;
        const page = getPageIdentity(liveUrl);
        const storedConversationId = String(chatHistory?.convo_id || '').trim() || null;
        const conversationId = page.conversationId && storedConversationId === page.conversationId
            ? page.conversationId
            : null;
        const contextualListingId = page.listingId || (page.pageKind === 'messages' ? storedListingId : null);
        const listingId = String(contextualListingId || '').trim() || null;
        return {
            conversationId,
            listingId,
            pageKind: page.pageKind,
            pageKey: page.pageKey
        };
    }

    function sameSourceScope(sourceScope, currentScope) {
        if (!sourceScope || !currentScope) return false;
        return (sourceScope.conversationId || null) === (currentScope.conversationId || null) &&
            (sourceScope.listingId || null) === (currentScope.listingId || null) &&
            !!sourceScope.pageKey && sourceScope.pageKey === currentScope.pageKey;
    }

    function evidenceSources(observation) {
        return Array.isArray(observation?.evidence)
            ? observation.evidence.map(item => item?.source).filter(Boolean)
            : [];
    }

    function isDefensibleListingObservation(observation, sourceScope) {
        const evidence = evidenceSources(observation);
        if (!sourceScope?.listingId || !evidence.length) return false;
        return evidence.every(source => source === 'listing_cache' || (
            source === 'page_context' && sourceScope.pageKind === 'listing'
        ));
    }

    function isDefensibleGlobalShopObservation(observation, sourceScope) {
        const evidence = evidenceSources(observation);
        return sourceScope?.pageKind === 'shop-dashboard' &&
            evidence.length > 0 &&
            evidence.every(source => source === 'page_context');
    }

    function selectObservationsForScope(summary, currentScope) {
        const observations = Array.isArray(summary?.summaryJson?.observations)
            ? summary.summaryJson.observations
            : [];
        const sourceScope = summary?.sourceScope;
        const sameSource = sameSourceScope(sourceScope, currentScope);

        return observations.flatMap(observation => {
            if (!observation?.statement) return [];
            const scope = String(observation.scope || '').toLowerCase();
            if (scope === 'conversation') {
                return sourceScope?.conversationId && sourceScope.conversationId === currentScope?.conversationId
                    ? [observation]
                    : [];
            }
            if (scope === 'listing') {
                if (sourceScope?.listingId === currentScope?.listingId && isDefensibleListingObservation(observation, sourceScope)) {
                    return [observation];
                }
                return sameSource ? [{ ...observation, scope: sourceScope?.conversationId ? 'conversation' : 'listing' }] : [];
            }
            if (scope === 'shop') {
                if (isDefensibleGlobalShopObservation(observation, sourceScope)) return [observation];
                if (!sameSource) return [];
                const localScope = sourceScope?.conversationId ? 'conversation' : sourceScope?.listingId ? 'listing' : null;
                return localScope ? [{ ...observation, scope: localScope }] : [];
            }
            return [];
        });
    }

    async function getStorage(keys) {
        if (!chrome.runtime?.id) return {};
        try { return await chrome.storage.local.get(keys); }
        catch (error) { console.warn('ShopIntelligence: storage get failed', error); return {}; }
    }

    async function setStorage(data) {
        if (!chrome.runtime?.id) return false;
        try { await chrome.storage.local.set(data); return true; }
        catch (error) { console.warn('ShopIntelligence: storage set failed', error); return false; }
    }

    async function getCurrentSourceScope() {
        const state = await getStorage([
            'current_context',
            'ETSY_CHAT_HISTORY',
            'ETSY_CURRENT_LISTING_ID'
        ]);
        const currentContext = contextMatchesLivePage(state.current_context)
            ? state.current_context
            : (buildLivePageContext() || {});
        const pageContent = currentContext.page_content || currentContext || {};
        const metadata = currentContext.metadata || pageContent.metadata || {};
        const liveState = await getLiveScopedConversationState(
            state.ETSY_CHAT_HISTORY || null,
            state.ETSY_CURRENT_LISTING_ID
        );
        return deriveSourceScope(metadata, liveState.history, liveState.listingId);
    }

    async function collectSnapshot() {
        const base = await getStorage([
            'current_context',
            'ETSY_CHAT_HISTORY',
            'ETSY_CURRENT_LISTING_ID',
            'ETSY_GLOBAL_USER_ID',
            'ETSY_GLOBAL_SHOP_ID',
            'gemini_api_key'
        ]);

        const currentContext = contextMatchesLivePage(base.current_context)
            ? base.current_context
            : (buildLivePageContext() || {});
        const pageContent = currentContext.page_content || currentContext || {};
        const metadata = currentContext.metadata || pageContent.metadata || {};
        const liveState = await getLiveScopedConversationState(
            base.ETSY_CHAT_HISTORY || null,
            base.ETSY_CURRENT_LISTING_ID
        );
        const storedChatHistory = liveState.history;
        const sourceScope = deriveSourceScope(metadata, storedChatHistory, liveState.listingId);
        const chatHistory = sourceScope.conversationId ? storedChatHistory : null;
        const listingId = sourceScope.listingId;
        const ownerIds = new Set([
            base.ETSY_GLOBAL_USER_ID,
            base.ETSY_GLOBAL_SHOP_ID
        ].filter(Boolean).map(String));

        let listing = null;
        if (listingId) {
            const listingResult = await getStorage([`RAG_LISTING_${listingId}`]);
            listing = listingResult[`RAG_LISTING_${listingId}`] || null;
        }

        const messages = (chatHistory?.messages || []).slice(-MAX_CHAT_MESSAGES).map(msg => ({
            role: participantRole(msg, chatHistory, ownerIds),
            sender: msg.sender_display_name || `User ${msg.sender_user_id || msg.sender_id || 'unknown'}`,
            text: trimText(msg.message_body || msg.message || '', MAX_MESSAGE_CHARS),
            hasAttachments: !!(msg.attachments?.length || msg.has_images)
        })).filter(msg => msg.text || msg.hasAttachments);

        const snapshot = {
            page: {
                url: metadata.url || location.href,
                title: pageContent.title || metadata.title || document.title || '',
                excerpt: trimText(pageContent.excerpt || '', 700),
                markdown: trimText(pageContent.markdown || '', MAX_PAGE_CHARS)
            },
            listing: listing ? {
                id: listingId,
                title: trimText(listing.title || '', 300),
                personalization: trimText(listing.personalization || '', 600),
                description: trimText(listing.description || '', MAX_LISTING_DESC_CHARS)
            } : null,
            conversation: chatHistory?.convo_id ? {
                convoId: chatHistory.convo_id,
                messages
            } : null
        };

        const sources = [];
        if (snapshot.page.markdown || snapshot.page.excerpt) sources.push('page_context');
        if (snapshot.listing) sources.push('listing_cache');
        if (snapshot.conversation?.messages?.length) sources.push('etsy_conversation');

        return {
            snapshot,
            sources,
            sourceScope,
            apiKey: base.gemini_api_key || null,
            hash: simpleHash({ snapshot, sourceScope })
        };
    }

    function hasUsefulContext(snapshot) {
        return !!(
            snapshot?.conversation?.messages?.length ||
            snapshot?.listing?.title ||
            snapshot?.listing?.description ||
            snapshot?.page?.markdown ||
            snapshot?.page?.excerpt
        );
    }

    async function shouldRefresh(hash, snapshot, apiKey) {
        if (!apiKey || !hasUsefulContext(snapshot)) return false;
        const now = Date.now();
        const state = await getStorage([SUMMARY_KEY, REFRESH_KEY, HASH_KEY]);
        const summary = state[SUMMARY_KEY];
        const lastRefresh = state[REFRESH_KEY] || 0;
        const lastHash = state[HASH_KEY] || '';

        if (summary?.version === VERSION && summary.updatedAt && now - summary.updatedAt < TTL_MS && hash === lastHash) {
            return false;
        }
        // Cooldown only suppresses repeated work for the same evidence. A changed
        // conversation/listing/page must never inherit the previous source's delay.
        if (hash === lastHash && now - lastRefresh < COOLDOWN_MS && summary?.summaryText) {
            return false;
        }
        return true;
    }

    function buildGeminiPrompt(snapshot, sources, reason) {
        return `Create a compact evidence map for an Etsy assistant.
Return JSON only. Do not force the evidence into a preset business taxonomy and do not infer a shop-wide policy from a single customer-specific event.
Include only observations that are explicit or strongly supported. Give each observation its true scope and confidence. Omit unsupported fields rather than filling them with defaults.

JSON schema:
{
  "observations": [
    {
      "statement": "concise evidence-grounded observation",
      "scope": "shop|listing|conversation",
      "confidence": "high|medium|low",
      "evidence": [{"source":"page_context|listing_cache|etsy_conversation","quote":"short quote"}]
    }
  ],
  "uncertainties": ["important ambiguity that remains unresolved"]
}

Reason: ${reason}
Sources: ${sources.join(', ') || 'none'}

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`;
    }

    function stripTrailingCommas(jsonText) {
        let result = '';
        let inString = false;
        let escaped = false;

        for (let index = 0; index < jsonText.length; index++) {
            const char = jsonText[index];
            if (inString) {
                result += char;
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (char === '"') {
                inString = true;
                result += char;
                continue;
            }

            if (char === ',') {
                let nextIndex = index + 1;
                while (nextIndex < jsonText.length && /\s/.test(jsonText[nextIndex])) nextIndex++;
                if (jsonText[nextIndex] === '}' || jsonText[nextIndex] === ']') continue;
            }
            result += char;
        }
        return result;
    }

    function parseJsonResponse(text) {
        const withoutFences = String(text || '')
            .trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        const objectStart = withoutFences.indexOf('{');
        const objectEnd = withoutFences.lastIndexOf('}');
        const clean = objectStart >= 0 && objectEnd > objectStart
            ? withoutFences.slice(objectStart, objectEnd + 1)
            : withoutFences;

        let parsed;
        try {
            parsed = JSON.parse(clean);
        } catch (originalError) {
            const repaired = stripTrailingCommas(clean);
            if (repaired === clean) throw originalError;
            parsed = JSON.parse(repaired);
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new SyntaxError('Shop intelligence response must be a JSON object');
        }
        return parsed;
    }

    function buildSummaryText(data, sources, options = {}) {
        const observations = Array.isArray(options.observations)
            ? options.observations
            : (Array.isArray(data.observations) ? data.observations : []);
        const includeUncertainties = options.includeUncertainties !== false;
        const lines = ['\n\n### AUTO_SHOP_INTELLIGENCE'];
        lines.push('(Model-generated, evidence-scoped observations. Conversation- or listing-scoped items are not global shop policy.)');
        if (observations.length) {
            observations.slice(0, 10).forEach(item => {
                if (!item?.statement) return;
                const scope = item.scope || 'unknown scope';
                const confidence = item.confidence || 'unknown confidence';
                lines.push(`- [${scope}; ${confidence}] ${trimText(item.statement, 220)}`);
                if (Array.isArray(item.evidence)) {
                    item.evidence.slice(0, 2).forEach(ev => {
                        if (ev?.quote) lines.push(`  Evidence (${ev.source || 'source'}): "${trimText(ev.quote, 160)}"`);
                    });
                }
            });
        }
        if (includeUncertainties && Array.isArray(data.uncertainties) && data.uncertainties.length) {
            lines.push(`Uncertainties: ${data.uncertainties.slice(0, 6).map(item => trimText(item, 100)).join('; ')}`);
        }
        lines.push(`Sources: ${sources.join(', ') || 'none'}`);
        return trimText(lines.join('\n'), MAX_CONTEXT_CHARS);
    }

    async function callGeminiSummary(apiKey, snapshot, sources, reason) {
        if (window.GeminiAuxiliaryService) {
            const result = await window.GeminiAuxiliaryService.generateContent({
                apiKey,
                timeoutMs: 20000,
                body: {
                    contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(snapshot, sources, reason) }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 900,
                        responseMimeType: 'application/json'
                    }
                }
            });
            return parseJsonResponse(result.data.candidates?.[0]?.content?.parts?.[0]?.text || '');
        }
        const model = window.ETSY_AI_GEMINI_FALLBACK_CHAIN?.[0] || 'gemini-flash-latest';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(snapshot, sources, reason) }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 900,
                        responseMimeType: 'application/json'
                    }
                }),
                signal: controller.signal
            });

            if (!response.ok) throw new Error(`Gemini shop intelligence failed: ${response.status}`);
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return parseJsonResponse(text);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function refresh(reason) {
        if (refreshInFlight) return false;
        refreshInFlight = true;
        try {
            const { snapshot, sources, sourceScope, apiKey, hash } = await collectSnapshot();
            if (!await shouldRefresh(hash, snapshot, apiKey)) {
                lastMetadata = await getMetadata();
                return false;
            }

            const summaryJson = await callGeminiSummary(apiKey, snapshot, sources, reason);
            const currentScope = await getCurrentSourceScope();
            if (!sameSourceScope(sourceScope, currentScope)) {
                console.log('ShopIntelligence: source changed before refresh completed; discarding stale result');
                return false;
            }
            const summary = {
                version: VERSION,
                policyVersion: window.AgentPolicyManager ? (await window.AgentPolicyManager.getPolicy()).version : null,
                updatedAt: Date.now(),
                reason,
                sources,
                sourceScope,
                sourceHash: hash,
                summaryText: buildSummaryText(summaryJson, sources),
                summaryJson
            };

            await setStorage({
                [SUMMARY_KEY]: summary,
                [HASH_KEY]: hash,
                [REFRESH_KEY]: Date.now()
            });
            lastMetadata = await getMetadata();
            console.log('ShopIntelligence: refreshed', { reason, sources });
            return true;
        } catch (error) {
            console.warn('ShopIntelligence: refresh failed', error);
            return false;
        } finally {
            refreshInFlight = false;
        }
    }

    function maybeBootstrap(reason = 'startup') {
        if (!chrome.runtime?.id) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { refresh(reason); }, DEBOUNCE_MS);
    }

    async function buildContextSection() {
        const result = await getStorage([SUMMARY_KEY]);
        const summary = result[SUMMARY_KEY];
        if (summary?.version !== VERSION || !summary?.summaryJson || !summary.updatedAt || !summary.sourceScope) return '';
        if (Date.now() - summary.updatedAt > TTL_MS) return '';
        const currentScope = await getCurrentSourceScope();
        const observations = selectObservationsForScope(summary, currentScope);
        const includeUncertainties = sameSourceScope(summary.sourceScope, currentScope);
        const hasLocalUncertainties = includeUncertainties &&
            Array.isArray(summary.summaryJson.uncertainties) &&
            summary.summaryJson.uncertainties.length > 0;
        if (!observations.length && !hasLocalUncertainties) return '';
        const scopedText = buildSummaryText(summary.summaryJson, summary.sources || [], {
            observations,
            includeUncertainties
        });
        return `${scopedText}\n[SHOP_INTELLIGENCE_AGE: ${formatAge(Date.now() - summary.updatedAt)}]`;
    }

    async function getMetadata() {
        const result = await getStorage([SUMMARY_KEY]);
        const summary = result[SUMMARY_KEY];
        if (!summary?.updatedAt) {
            return { shopIntelVersion: null, shopIntelAge: null, shopIntelSources: [], shopIntelActive: false };
        }
        return {
            shopIntelVersion: summary.version || null,
            shopIntelAge: formatAge(Date.now() - summary.updatedAt),
            shopIntelSources: summary.sources || [],
            shopIntelActive: Date.now() - summary.updatedAt <= TTL_MS,
            shopIntelReason: summary.reason || null
        };
    }

    return {
        SUMMARY_KEY,
        VERSION,
        maybeBootstrap,
        refresh,
        buildContextSection,
        getMetadata
    };
})();
