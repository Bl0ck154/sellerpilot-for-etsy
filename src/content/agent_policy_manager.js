// agent_policy_manager.js - Remote agent policy loader
// Loads JSON policy data only. Never executes remote code.

window.AgentPolicyManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_AGENT_POLICY_CACHE';
    const BUNDLED_POLICY_PATH = 'config/agent_policy.json';
    const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
    const MAX_ADDENDUM_CHARS = 3000;
    const MAX_PROMPT_CHARS = 1200;
    const MAX_PHRASES = 40;
    const MAX_PHRASE_CHARS = 80;

    let inMemoryPolicy = null;

    function trimString(value, maxChars) {
        if (typeof value !== 'string') return '';
        return value.trim().slice(0, maxChars);
    }

    function normalizePolicy(raw, fallback = {}) {
        const ttlHours = Number(raw?.ttlHours);
        const forbiddenPhrases = Array.isArray(raw?.forbiddenPhrases)
            ? raw.forbiddenPhrases
                .map(item => trimString(item, MAX_PHRASE_CHARS))
                .filter(Boolean)
                .slice(0, MAX_PHRASES)
            : (fallback.forbiddenPhrases || []);

        return {
            version: trimString(raw?.version, 80) || fallback.version || 'bundled',
            remoteUrl: trimString(fallback.remoteUrl || raw?.remoteUrl, 300),
            ttlHours: Number.isFinite(ttlHours) && ttlHours > 0 && ttlHours <= 24
                ? ttlHours
                : (fallback.ttlHours || 6),
            systemAddendum: trimString(raw?.systemAddendum, MAX_ADDENDUM_CHARS) || fallback.systemAddendum || '',
            suggestResponsePrompt: trimString(raw?.suggestResponsePrompt, MAX_PROMPT_CHARS) || fallback.suggestResponsePrompt || '',
            forbiddenPhrases
        };
    }

    async function fetchJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Policy fetch failed: ${response.status}`);
        return await response.json();
    }

    async function loadBundledPolicy() {
        const url = chrome.runtime.getURL(BUNDLED_POLICY_PATH);
        return normalizePolicy(await fetchJson(url));
    }

    async function loadCachedPolicy() {
        try {
            if (!chrome.runtime?.id) return null;
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            return result[STORAGE_KEY] || null;
        } catch (error) {
            console.warn('AgentPolicyManager: failed to read cache', error);
            return null;
        }
    }

    async function saveCachedPolicy(policy) {
        try {
            if (!chrome.runtime?.id) return;
            await chrome.storage.local.set({
                [STORAGE_KEY]: {
                    policy,
                    fetchedAt: Date.now()
                }
            });
        } catch (error) {
            console.warn('AgentPolicyManager: failed to write cache', error);
        }
    }

    function isFresh(cache, ttlMs) {
        return cache?.policy && cache?.fetchedAt && Date.now() - cache.fetchedAt < ttlMs;
    }

    async function getPolicy(options = {}) {
        if (inMemoryPolicy && !options.forceRefresh) return inMemoryPolicy;

        const bundled = await loadBundledPolicy();
        const ttlMs = (bundled.ttlHours || 6) * 60 * 60 * 1000 || DEFAULT_TTL_MS;
        const cached = await loadCachedPolicy();

        if (!options.forceRefresh && isFresh(cached, ttlMs)) {
            inMemoryPolicy = normalizePolicy(cached.policy, bundled);
            return inMemoryPolicy;
        }

        if (!bundled.remoteUrl) {
            inMemoryPolicy = bundled;
            return inMemoryPolicy;
        }

        try {
            // Only the bundled URL controls where remote policy is loaded from.
            const remote = normalizePolicy(await fetchJson(bundled.remoteUrl), bundled);
            await saveCachedPolicy(remote);
            inMemoryPolicy = remote;
            return inMemoryPolicy;
        } catch (error) {
            console.warn('AgentPolicyManager: remote policy unavailable, using fallback', error);
            inMemoryPolicy = cached?.policy ? normalizePolicy(cached.policy, bundled) : bundled;
            return inMemoryPolicy;
        }
    }

    async function buildSystemAddendum() {
        const policy = await getPolicy();
        return policy.systemAddendum ? `\n\n${policy.systemAddendum}` : '';
    }

    async function getSuggestResponsePrompt(fallbackPrompt) {
        const policy = await getPolicy();
        return policy.suggestResponsePrompt || fallbackPrompt;
    }

    async function getForbiddenPhrases() {
        const policy = await getPolicy();
        return policy.forbiddenPhrases || [];
    }

    return {
        STORAGE_KEY,
        getPolicy,
        buildSystemAddendum,
        getSuggestResponsePrompt,
        getForbiddenPhrases
    };
})();
