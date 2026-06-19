// memory_manager.js - Persistent user memory for the Etsy AI agent
// Stores "remember this" facts across sessions and injects them into the system prompt.

window.MemoryManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_USER_MEMORY';
    const MAX_ENTRIES = 50;
    const MAX_LENGTH = 500;
    const MAX_CONFLICTS = 3;

    async function list() {
        try {
            if (!chrome?.runtime?.id) return [];
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        } catch (e) {
            console.warn('MemoryManager: failed to load memory', e);
            return [];
        }
    }

    function entryTime(entry) {
        return Number(entry?.updatedAt || entry?.createdAt || 0) || 0;
    }

    function sortNewestFirst(entries) {
        return [...(entries || [])].sort((a, b) => entryTime(b) - entryTime(a));
    }

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[’`]/g, "'")
            .replace(/[^\p{L}\p{N}\s']/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tokenSet(value) {
        const stop = new Set([
            'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'our', 'you', 'your',
            'про', 'що', 'для', 'але', 'або', 'ми', 'нам', 'наш', 'наша', 'мені', 'моя', 'це', 'так',
            'это', 'для', 'или', 'что', 'наш', 'нам'
        ]);
        return new Set(normalizeText(value).split(' ').filter(t => t.length > 2 && !stop.has(t)));
    }

    function hasNegation(value) {
        return /\b(no|not|never|don't|do not|doesn't|cannot|can't|without)\b|\b(не|ніколи|без|нельзя|никогда)\b/i.test(value || '');
    }

    function similarity(a, b) {
        const left = tokenSet(a);
        const right = tokenSet(b);
        if (!left.size || !right.size) return { score: 0, overlap: 0 };
        let overlap = 0;
        for (const token of left) if (right.has(token)) overlap++;
        const union = new Set([...left, ...right]).size || 1;
        return { score: overlap / union, overlap };
    }

    function findPotentialConflicts(text, memory) {
        const clean = normalizeText(text);
        if (!clean) return [];

        return sortNewestFirst(memory)
            .map(entry => {
                const sim = similarity(clean, entry.text);
                const negationMismatch = hasNegation(clean) !== hasNegation(entry.text);
                const conflictScore = sim.score + (negationMismatch && sim.overlap >= 2 ? 0.25 : 0);
                return { entry, score: conflictScore, overlap: sim.overlap, negationMismatch };
            })
            .filter(item => item.overlap >= 3 && (item.score >= 0.45 || (item.negationMismatch && item.overlap >= 2)))
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_CONFLICTS)
            .map(item => item.entry);
    }

    function findRemovalCandidates(keyword, memory) {
        const kw = normalizeText(keyword);
        if (!kw) return [];
        return sortNewestFirst(memory)
            .map(entry => {
                const entryText = normalizeText(entry.text);
                const exact = entryText.includes(kw);
                const sim = similarity(kw, entry.text);
                return { entry, exact, score: exact ? 1 : sim.score, overlap: sim.overlap };
            })
            .filter(item => item.exact || (item.overlap >= 2 && item.score >= 0.28))
            .sort((a, b) => b.score - a.score)
            .map(item => item.entry);
    }

    async function add(text) {
        const clean = (text || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return null;
        const memory = await list();

        // Dedupe (case-insensitive exact match)
        const lower = clean.toLowerCase();
        const dup = memory.find(m => m.text.toLowerCase() === lower);
        if (dup) {
            dup.updatedAt = Date.now();
            await chrome.storage.local.set({ [STORAGE_KEY]: memory });
            return { duplicate: true, entry: dup };
        }

        const entry = {
            id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: clean,
            createdAt: Date.now()
        };
        memory.push(entry);
        while (memory.length > MAX_ENTRIES) memory.shift(); // LRU drop oldest

        await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        return { duplicate: false, entry };
    }

    async function addSmart(text, options = {}) {
        const clean = (text || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return null;

        let memory = await list();
        const lower = clean.toLowerCase();
        const dup = memory.find(m => m.text.toLowerCase() === lower);
        if (dup) {
            dup.updatedAt = Date.now();
            await chrome.storage.local.set({ [STORAGE_KEY]: memory });
            return { duplicate: true, entry: dup, replaced: [] };
        }

        const conflicts = findPotentialConflicts(clean, memory);
        if (conflicts.length && !options.replaceConflicts) {
            return { conflict: true, conflicts, text: clean };
        }

        if (conflicts.length && options.replaceConflicts) {
            const conflictIds = new Set(conflicts.map(entry => entry.id));
            memory = memory.filter(entry => !conflictIds.has(entry.id));
        }

        const entry = {
            id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: clean,
            createdAt: Date.now()
        };
        memory.push(entry);
        memory = sortNewestFirst(memory).slice(0, MAX_ENTRIES).reverse();
        await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        return { duplicate: false, entry, replaced: conflicts };
    }

    async function removeById(id) {
        const memory = await list();
        const next = memory.filter(m => m.id !== id);
        if (next.length === memory.length) return 0;
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        return memory.length - next.length;
    }

    async function removeByKeyword(keyword, options = {}) {
        const kw = (keyword || '').trim().toLowerCase();
        if (!kw) return { removed: 0, entries: [] };
        const memory = await list();
        const toRemove = findRemovalCandidates(kw, memory);
        if (toRemove.length === 0) return { removed: 0, entries: [] };
        if (toRemove.length > 1 && !options.allowMultiple) {
            return { removed: 0, entries: toRemove, ambiguous: true };
        }
        const next = memory.filter(m => !toRemove.includes(m));
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        return { removed: toRemove.length, entries: toRemove };
    }

    async function update(id, newText) {
        const clean = (newText || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return false;
        const memory = await list();
        const idx = memory.findIndex(m => m.id === id);
        if (idx === -1) return false;
        memory[idx].text = clean;
        memory[idx].updatedAt = Date.now();
        await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        return true;
    }

    async function clear() {
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
        return true;
    }

    /**
     * Build the USER_MEMORY section for injection into the system prompt.
     * @returns {Promise<string>} formatted block or empty string
     */
    async function buildContextSection() {
        const memory = await list();
        if (!memory.length) return '';
        const lines = sortNewestFirst(memory).map((m, i) => `${i + 1}. ${m.text}`).join('\n');
        return `\n\n### USER_MEMORY (persistent facts about the Owner — newest first; if entries conflict, newer entries win):\n${lines}`;
    }

    return {
        STORAGE_KEY,
        MAX_ENTRIES,
        MAX_LENGTH,
        list,
        add,
        addSmart,
        removeById,
        removeByKeyword,
        findPotentialConflicts,
        findRemovalCandidates,
        update,
        clear,
        buildContextSection
    };
})();
