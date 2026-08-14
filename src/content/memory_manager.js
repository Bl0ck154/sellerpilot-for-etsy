// memory_manager.js - Persistent facts the Owner explicitly chooses to save.

window.MemoryManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_USER_MEMORY';
    const MAX_ENTRIES = 50;
    const MAX_LENGTH = 500;

    async function list() {
        try {
            if (!chrome?.runtime?.id) return [];
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        } catch (error) {
            console.warn('MemoryManager: failed to load memory', error);
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

    // Removal is deliberately conservative. Meaning-based management happens in
    // the model classifier; storage code must not guess meaning from token overlap.
    function findRemovalCandidates(keyword, memory) {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) return [];

        return sortNewestFirst(memory)
            .map(entry => {
                const normalizedEntry = normalizeText(entry.text);
                const exact = normalizedEntry === normalizedKeyword;
                const contained = normalizedEntry.includes(normalizedKeyword)
                    || normalizedKeyword.includes(normalizedEntry);
                return { entry, score: exact ? 2 : contained ? 1 : 0 };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.entry);
    }

    async function add(text) {
        const clean = String(text || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return null;

        let memory = await list();
        const normalized = normalizeText(clean);
        const duplicate = memory.find(entry => normalizeText(entry.text) === normalized);
        if (duplicate) {
            duplicate.updatedAt = Date.now();
            await chrome.storage.local.set({ [STORAGE_KEY]: memory });
            return { duplicate: true, entry: duplicate, replaced: [] };
        }

        const entry = {
            id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: clean,
            createdAt: Date.now()
        };
        memory.push(entry);
        memory = sortNewestFirst(memory).slice(0, MAX_ENTRIES).reverse();
        await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        return { duplicate: false, entry, replaced: [] };
    }

    async function addSmart(text) {
        return add(text);
    }

    async function removeById(id) {
        const memory = await list();
        const next = memory.filter(entry => entry.id !== id);
        if (next.length === memory.length) return 0;
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        return memory.length - next.length;
    }

    async function removeByKeyword(keyword, options = {}) {
        const memory = await list();
        const candidates = findRemovalCandidates(keyword, memory);
        if (!candidates.length) return { removed: 0, entries: [] };
        if (candidates.length > 1 && !options.allowMultiple) {
            return { removed: 0, entries: candidates, ambiguous: true };
        }

        const ids = new Set(candidates.map(entry => entry.id));
        const next = memory.filter(entry => !ids.has(entry.id));
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        return { removed: candidates.length, entries: candidates };
    }

    async function update(id, newText) {
        const clean = String(newText || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return false;
        const memory = await list();
        const index = memory.findIndex(entry => entry.id === id);
        if (index === -1) return false;
        memory[index].text = clean;
        memory[index].updatedAt = Date.now();
        await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        return true;
    }

    async function clear() {
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
        return true;
    }

    async function buildContextSection() {
        const memory = await list();
        if (!memory.length) return '';
        const lines = sortNewestFirst(memory).map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');
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
        findRemovalCandidates,
        update,
        clear,
        buildContextSection
    };
})();
