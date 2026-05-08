// shop_intelligence_manager.js - Async Gemini shop intelligence cache
// Uses existing Etsy/page context only. Does not crawl Etsy or execute remote code.

window.ShopIntelligenceManager = (function () {
    const SUMMARY_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_SUMMARY';
    const REFRESH_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_LAST_REFRESH';
    const HASH_KEY = 'ETSY_AI_SHOP_INTELLIGENCE_LAST_HASH';
    const VERSION = '2026-05-08.1';
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

    async function collectSnapshot() {
        const base = await getStorage([
            'current_context',
            'ETSY_CHAT_HISTORY',
            'ETSY_CURRENT_LISTING_ID',
            'gemini_api_key'
        ]);

        const currentContext = base.current_context || {};
        const pageContent = currentContext.page_content || currentContext || {};
        const metadata = currentContext.metadata || pageContent.metadata || {};
        const chatHistory = base.ETSY_CHAT_HISTORY || null;
        const listingId = base.ETSY_CURRENT_LISTING_ID || null;

        let listing = null;
        if (listingId) {
            const listingResult = await getStorage([`RAG_LISTING_${listingId}`]);
            listing = listingResult[`RAG_LISTING_${listingId}`] || null;
        }

        const messages = (chatHistory?.messages || []).slice(-MAX_CHAT_MESSAGES).map(msg => ({
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
            apiKey: base.gemini_api_key || null,
            hash: simpleHash(snapshot)
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

        if (summary?.updatedAt && now - summary.updatedAt < TTL_MS && hash === lastHash) {
            return false;
        }
        if (now - lastRefresh < COOLDOWN_MS && summary?.summaryText) {
            return false;
        }
        return true;
    }

    function buildGeminiPrompt(snapshot, sources, reason) {
        return `You summarize Etsy shop behavior from evidence for a customer-reply assistant.
Return JSON only. Do not invent shop policies. If evidence is missing, use "unknown".
Prefer cautious defaults for custom work, but mark them as guidance unless supported by evidence.

JSON schema:
{
  "customWorkStance": "review_first|accepts_simple|unknown",
  "requiredDetails": ["reference_photo|size|deadline|quantity|color_material|personalization_text"],
  "riskTriggers": ["exact_recreation|rush_deadline|refund_demand|unclear_reference|copyrighted_design"],
  "doNotPromise": ["short rule"],
  "tone": "warm_cautious|short_direct|friendly|unknown",
  "guidance": ["short rule"],
  "evidence": [{"source":"page_context|listing_cache|etsy_conversation","quote":"short quote"}],
  "unknowns": ["missing policy/info"]
}

Reason: ${reason}
Sources: ${sources.join(', ') || 'none'}

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`;
    }

    function parseJsonResponse(text) {
        const clean = (text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        return JSON.parse(clean);
    }

    function buildSummaryText(data, sources) {
        const lines = ['\n\n### AUTO_SHOP_INTELLIGENCE'];
        lines.push('(Async Gemini summary from existing Etsy/page context. Treat as guidance from evidence; if unsure, ask the Owner.)');
        if (data.customWorkStance) lines.push(`Custom work stance: ${data.customWorkStance}`);
        if (data.tone) lines.push(`Tone: ${data.tone}`);
        if (Array.isArray(data.requiredDetails) && data.requiredDetails.length) {
            lines.push(`Required before confirming custom work: ${data.requiredDetails.slice(0, 8).join(', ')}`);
        }
        if (Array.isArray(data.riskTriggers) && data.riskTriggers.length) {
            lines.push(`Risk triggers: ${data.riskTriggers.slice(0, 8).join(', ')}`);
        }
        if (Array.isArray(data.doNotPromise) && data.doNotPromise.length) {
            lines.push('Do not promise:');
            data.doNotPromise.slice(0, 5).forEach(item => lines.push(`- ${trimText(item, 160)}`));
        }
        if (Array.isArray(data.guidance) && data.guidance.length) {
            lines.push('Guidance:');
            data.guidance.slice(0, 6).forEach(item => lines.push(`- ${trimText(item, 180)}`));
        }
        if (Array.isArray(data.evidence) && data.evidence.length) {
            lines.push('Evidence:');
            data.evidence.slice(0, 4).forEach(item => lines.push(`- ${item.source || 'source'}: "${trimText(item.quote, 180)}"`));
        }
        if (Array.isArray(data.unknowns) && data.unknowns.length) {
            lines.push(`Unknowns: ${data.unknowns.slice(0, 5).map(item => trimText(item, 80)).join('; ')}`);
        }
        lines.push(`Sources: ${sources.join(', ') || 'none'}`);
        return trimText(lines.join('\n'), MAX_CONTEXT_CHARS);
    }

    async function callGeminiSummary(apiKey, snapshot, sources, reason) {
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
                    generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
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
            const { snapshot, sources, apiKey, hash } = await collectSnapshot();
            if (!await shouldRefresh(hash, snapshot, apiKey)) {
                lastMetadata = await getMetadata();
                return false;
            }

            await setStorage({ [REFRESH_KEY]: Date.now() });
            const summaryJson = await callGeminiSummary(apiKey, snapshot, sources, reason);
            const summary = {
                version: VERSION,
                policyVersion: window.AgentPolicyManager ? (await window.AgentPolicyManager.getPolicy()).version : null,
                updatedAt: Date.now(),
                reason,
                sources,
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
        if (!summary?.summaryText || !summary.updatedAt) return '';
        if (Date.now() - summary.updatedAt > TTL_MS) return '';
        return `${summary.summaryText}\n[SHOP_INTELLIGENCE_AGE: ${formatAge(Date.now() - summary.updatedAt)}]`;
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
