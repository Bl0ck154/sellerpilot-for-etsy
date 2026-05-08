// memory_manager.js - Persistent user memory for the Etsy AI agent
// Stores "remember this" facts across sessions and injects them into the system prompt.

window.MemoryManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_USER_MEMORY';
    const MAX_ENTRIES = 50;
    const MAX_LENGTH = 500;

    // Regexes detect common UA / RU / EN phrasings. Keep them anchored at the start
    // of the message so casual mentions ("I'll remember that tomorrow") don't trigger.
    const ADD_RE = /^(?:запам[''’`]?ятай|запомни|remember|note)(?:\s*,?\s*(?:що|that))?\s*[:,\-]?\s*(.+)$/is;
    const CLEAR_RE = /^(?:забудь\s+(?:все|всё|всю\s+пам[''’`]?ять)|очисти\s+пам[''’`]?ять|forget\s+(?:all|everything)|clear\s+(?:memory|all\s+memory))\s*\.?$/i;
    const REMOVE_RE = /^(?:забудь|не\s+пам[''’`]?ятай|forget)(?:\s+(?:що|про|about|that))?\s*[:,\-]?\s*(.+)$/is;

    /**
     * Detect whether a user message is a memory command.
     * Returns null if it's a regular message.
     * @param {string} text
     * @returns {{action:'add'|'remove'|'clear', text?:string, keyword?:string}|null}
     */
    function detectCommand(text) {
        if (!text) return null;
        const trimmed = text.trim();
        if (!trimmed) return null;

        if (CLEAR_RE.test(trimmed)) {
            return { action: 'clear' };
        }

        const addMatch = trimmed.match(ADD_RE);
        if (addMatch) {
            const fact = addMatch[1].trim().replace(/^["'`«]+|["'`»]+$/g, '').trim();
            if (fact) return { action: 'add', text: fact };
        }

        const removeMatch = trimmed.match(REMOVE_RE);
        if (removeMatch) {
            const keyword = removeMatch[1].trim().replace(/^["'`«]+|["'`»]+$/g, '').trim();
            if (keyword) return { action: 'remove', keyword };
        }

        return null;
    }

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

    async function add(text) {
        const clean = (text || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return null;
        const memory = await list();

        // Dedupe (case-insensitive exact match)
        const lower = clean.toLowerCase();
        const dup = memory.find(m => m.text.toLowerCase() === lower);
        if (dup) return { duplicate: true, entry: dup };

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

    async function removeById(id) {
        const memory = await list();
        const next = memory.filter(m => m.id !== id);
        if (next.length === memory.length) return 0;
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        return memory.length - next.length;
    }

    async function removeByKeyword(keyword) {
        const kw = (keyword || '').trim().toLowerCase();
        if (!kw) return { removed: 0, entries: [] };
        const memory = await list();
        const toRemove = memory.filter(m => m.text.toLowerCase().includes(kw));
        if (toRemove.length === 0) return { removed: 0, entries: [] };
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
        const lines = memory.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
        return `\n\n### USER_MEMORY (persistent facts about the Owner — treat as ground truth):\n${lines}`;
    }

    return {
        STORAGE_KEY,
        MAX_ENTRIES,
        MAX_LENGTH,
        detectCommand,
        list,
        add,
        removeById,
        removeByKeyword,
        update,
        clear,
        buildContextSection
    };
})();
