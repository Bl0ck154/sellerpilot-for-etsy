// memory_manager.js - Explicit, local-only persistent Owner memory.
// No model calls happen here. Memory is saved only when the Owner explicitly asks for it.

window.MemoryManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_USER_MEMORY';
    const MAX_ENTRIES = 80;
    const MAX_LENGTH = 500;
    const MAX_CONTEXT_CHARS = 12000;

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[’`ʼ]/g, "'")
            .replace(/[^\p{L}\p{N}\s']/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function classifyKind(text) {
        const value = normalizeText(text);
        if (!value) return 'general';
        if (/(prefer|preference|always|never|tone|style|short replies|long replies|reply in|respond in|не пиши|пиши|відповідай|відповідь|тон|стиль|предпочита|отвечай|не отвечай)/iu.test(value)) {
            return 'preference';
        }
        if (/(shop|store|etsy|policy|shipping|delivery|refund|discount|price|turnaround|we offer|we don't|we do not|магазин|доставка|повернен|знижк|ціна|термін|ми робимо|ми не|возврат|скидк|цена|срок|мы делаем|мы не)/iu.test(value)) {
            return 'shop_fact';
        }
        return 'general';
    }

    function hydrateEntry(raw) {
        const text = String(raw?.text || '').trim().slice(0, MAX_LENGTH);
        if (!text) return null;
        return {
            id: String(raw?.id || ('mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6))),
            text,
            kind: ['preference', 'shop_fact', 'general'].includes(raw?.kind)
                ? raw.kind
                : classifyKind(text),
            createdAt: Number(raw?.createdAt) || Date.now(),
            updatedAt: Number(raw?.updatedAt) || undefined
        };
    }

    async function list() {
        try {
            if (!chrome?.runtime?.id) return [];
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            return Array.isArray(result[STORAGE_KEY])
                ? result[STORAGE_KEY].map(hydrateEntry).filter(Boolean)
                : [];
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

    async function save(memory) {
        const hydrated = (memory || []).map(hydrateEntry).filter(Boolean);
        await chrome.storage.local.set({ [STORAGE_KEY]: hydrated.slice(-MAX_ENTRIES) });
        return hydrated;
    }

    async function add(text, options = {}) {
        const clean = String(text || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return null;

        let memory = await list();
        const normalized = normalizeText(clean);
        const duplicate = memory.find(entry => normalizeText(entry.text) === normalized);
        if (duplicate) {
            duplicate.updatedAt = Date.now();
            duplicate.kind = options.kind || duplicate.kind || classifyKind(clean);
            await save(memory);
            return { duplicate: true, entry: duplicate, replaced: [] };
        }

        const entry = {
            id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: clean,
            kind: ['preference', 'shop_fact', 'general'].includes(options.kind)
                ? options.kind
                : classifyKind(clean),
            createdAt: Date.now()
        };
        memory.push(entry);
        memory = memory.slice(-MAX_ENTRIES);
        await save(memory);
        return { duplicate: false, entry, replaced: [] };
    }

    async function addSmart(text, options = {}) {
        return add(text, options);
    }

    async function removeById(id) {
        const memory = await list();
        const next = memory.filter(entry => entry.id !== id);
        if (next.length === memory.length) return 0;
        await save(next);
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
        await save(next);
        return { removed: candidates.length, entries: candidates };
    }

    async function update(id, newText, options = {}) {
        const clean = String(newText || '').trim().slice(0, MAX_LENGTH);
        if (!clean) return false;
        const memory = await list();
        const index = memory.findIndex(entry => entry.id === id);
        if (index === -1) return false;
        memory[index].text = clean;
        memory[index].kind = ['preference', 'shop_fact', 'general'].includes(options.kind)
            ? options.kind
            : classifyKind(clean);
        memory[index].updatedAt = Date.now();
        await save(memory);
        return true;
    }

    async function clear() {
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
        return true;
    }

    function formatContextEntries(entries) {
        const groups = { preference: [], shop_fact: [], general: [] };
        for (const entry of sortNewestFirst(entries)) groups[entry.kind || 'general'].push(entry);

        const sections = [];
        const labels = {
            preference: 'Owner preferences',
            shop_fact: 'Shop facts',
            general: 'Other explicitly saved facts'
        };
        for (const kind of ['preference', 'shop_fact', 'general']) {
            if (!groups[kind].length) continue;
            sections.push(`${labels[kind]}:`);
            for (const entry of groups[kind]) sections.push(`- ${entry.text}`);
        }
        return sections;
    }

    async function buildContextSection() {
        const memory = await list();
        if (!memory.length) return '';

        const header = '\n\n### USER_MEMORY\n' +
            '(Only facts/preferences explicitly saved by the Owner. This is not customer/order context. Newer conflicting entries take precedence. Use only entries relevant to the current task.)\n';
        const lines = formatContextEntries(memory);
        let body = '';
        let omitted = 0;
        for (const line of lines) {
            const candidate = body ? `${body}\n${line}` : line;
            if (candidate.length > MAX_CONTEXT_CHARS) {
                omitted += 1;
                continue;
            }
            body = candidate;
        }
        if (omitted) body += `\n- [${omitted} older memory line(s) omitted from this prompt to control context size]`;
        return `${header}${body}`;
    }

    return {
        STORAGE_KEY,
        MAX_ENTRIES,
        MAX_LENGTH,
        MAX_CONTEXT_CHARS,
        list,
        add,
        addSmart,
        removeById,
        removeByKeyword,
        findRemovalCandidates,
        update,
        clear,
        buildContextSection,
        classifyKind
    };
})();
