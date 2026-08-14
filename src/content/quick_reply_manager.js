// quick_reply_manager.js - User-managed reply templates for Etsy Messages.
// Templates are stored locally and are only inserted into Etsy's draft field.

window.QuickReplyManager = (function () {
    const STORAGE_KEY = 'ETSY_AI_QUICK_REPLIES';
    const MAX_ENTRIES = 30;
    const MAX_LABEL_LENGTH = 48;
    const MAX_TEXT_LENGTH = 1500;
    const DEFAULT_REPLIES = [
        {
            label: 'Thanks',
            text: 'Thank you for reaching out!'
        },
        {
            label: 'Checking',
            text: 'Thank you for the message. I’ll check the details and get back to you shortly.'
        },
        {
            label: 'Need details',
            text: 'Thank you! Could you please share a few more details so I can help you accurately?'
        }
    ];

    function createId() {
        return 'reply_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    function cleanLabel(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
    }

    function cleanText(value) {
        return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH);
    }

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[’`]/g, "'")
            .replace(/[^\p{L}\p{N}\s']/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function hydrateEntry(raw) {
        const label = cleanLabel(raw?.label);
        const text = cleanText(raw?.text);
        if (!label || !text) return null;
        return {
            id: String(raw?.id || createId()),
            label,
            text,
            createdAt: Number(raw?.createdAt) || Date.now(),
            updatedAt: Number(raw?.updatedAt) || undefined
        };
    }

    function createDefaultEntries() {
        const now = Date.now();
        return DEFAULT_REPLIES.map((reply, index) => ({
            id: `reply_default_${index + 1}`,
            label: reply.label,
            text: reply.text,
            createdAt: now + index
        }));
    }

    async function readRaw() {
        try {
            if (!chrome?.runtime?.id) return { exists: false, entries: [] };
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            const exists = Object.prototype.hasOwnProperty.call(result, STORAGE_KEY);
            const entries = Array.isArray(result[STORAGE_KEY])
                ? result[STORAGE_KEY].map(hydrateEntry).filter(Boolean).slice(0, MAX_ENTRIES)
                : [];
            return { exists, entries };
        } catch (error) {
            console.warn('QuickReplyManager: failed to load quick replies', error);
            return { exists: false, entries: [] };
        }
    }

    async function list() {
        const stored = await readRaw();
        if (stored.exists) return stored.entries;

        const defaults = createDefaultEntries();
        try {
            await chrome.storage.local.set({ [STORAGE_KEY]: defaults });
        } catch (error) {
            console.warn('QuickReplyManager: failed to initialize defaults', error);
        }
        return defaults;
    }

    async function save(entries) {
        const cleanEntries = (entries || []).map(hydrateEntry).filter(Boolean).slice(0, MAX_ENTRIES);
        await chrome.storage.local.set({ [STORAGE_KEY]: cleanEntries });
        return cleanEntries;
    }

    function scoreMatch(query, entry) {
        const needle = normalize(query);
        if (!needle) return 0;
        const label = normalize(entry.label);
        const text = normalize(entry.text);
        if (label === needle) return 100;
        if (text === needle) return 90;
        if (label.includes(needle) || needle.includes(label)) return 60;
        if (text.includes(needle) || needle.includes(text)) return 50;
        return 0;
    }

    async function find(query) {
        const entries = await list();
        return entries
            .map(entry => ({ entry, score: scoreMatch(query, entry) }))
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(result => result.entry);
    }

    async function add(label, text) {
        const cleanName = cleanLabel(label);
        const cleanBody = cleanText(text);
        if (!cleanName || !cleanBody) return null;

        const entries = await list();
        const duplicate = entries.find(entry => normalize(entry.label) === normalize(cleanName));
        if (duplicate) {
            return { duplicate: true, entry: duplicate };
        }
        if (entries.length >= MAX_ENTRIES) {
            return { limitReached: true, maxEntries: MAX_ENTRIES };
        }

        const entry = {
            id: createId(),
            label: cleanName,
            text: cleanBody,
            createdAt: Date.now()
        };
        entries.push(entry);
        await save(entries);
        return { duplicate: false, entry };
    }

    async function update(id, changes = {}) {
        const entries = await list();
        const index = entries.findIndex(entry => entry.id === id);
        if (index === -1) return null;

        const label = changes.label === undefined ? entries[index].label : cleanLabel(changes.label);
        const text = changes.text === undefined ? entries[index].text : cleanText(changes.text);
        if (!label || !text) return null;

        const duplicate = entries.find(entry =>
            entry.id !== id && normalize(entry.label) === normalize(label)
        );
        if (duplicate) return { duplicate: true, entry: duplicate };

        entries[index] = {
            ...entries[index],
            label,
            text,
            updatedAt: Date.now()
        };
        await save(entries);
        return { duplicate: false, entry: entries[index] };
    }

    async function updateByQuery(query, changes = {}) {
        const matches = await find(query);
        if (!matches.length) return { updated: false, matches: [] };
        if (scoreMatch(query, matches[0]) < 90 || (matches[1] && scoreMatch(query, matches[1]) === scoreMatch(query, matches[0]))) {
            return { updated: false, ambiguous: true, matches: matches.slice(0, 5) };
        }
        const result = await update(matches[0].id, changes);
        return { updated: Boolean(result?.entry && !result.duplicate), result, matches: [matches[0]] };
    }

    async function removeById(id) {
        const entries = await list();
        const removed = entries.find(entry => entry.id === id);
        if (!removed) return null;
        await save(entries.filter(entry => entry.id !== id));
        return removed;
    }

    async function removeByQuery(query) {
        const matches = await find(query);
        if (!matches.length) return { removed: null, matches: [] };
        if (scoreMatch(query, matches[0]) < 90 || (matches[1] && scoreMatch(query, matches[1]) === scoreMatch(query, matches[0]))) {
            return { removed: null, ambiguous: true, matches: matches.slice(0, 5) };
        }
        const removed = await removeById(matches[0].id);
        return { removed, matches: [matches[0]] };
    }

    async function clear() {
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
        return true;
    }

    return {
        STORAGE_KEY,
        MAX_ENTRIES,
        MAX_LABEL_LENGTH,
        MAX_TEXT_LENGTH,
        list,
        find,
        add,
        update,
        updateByQuery,
        removeById,
        removeByQuery,
        clear
    };
})();
