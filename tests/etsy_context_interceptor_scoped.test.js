const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'etsy_context_interceptor.js'), 'utf8');
const histories = {};
const listings = {};
const legacy = {};
const listeners = {};
let visionSchedules = 0;

const store = {
    async getHistory(convoId) { return histories[String(convoId)] || null; },
    async setHistory(history) {
        histories[String(history.convo_id)] = structuredClone(history);
        legacy.ETSY_CHAT_HISTORY = structuredClone(history);
        return true;
    },
    async getListing(convoId) { return listings[String(convoId)] || null; },
    async setListing(convoId, listingId, extra = {}) {
        listings[String(convoId)] = { ...structuredClone(extra), convoId: String(convoId), listingId: String(listingId) };
        legacy.ETSY_CURRENT_LISTING_ID = String(listingId);
        legacy.ETSY_CURRENT_LISTING_SCOPE = structuredClone(listings[String(convoId)]);
        return true;
    },
    async clearListing(convoId) { delete listings[String(convoId)]; return true; }
};
const location = { pathname: '/messages/100', href: 'https://www.etsy.com/messages/100' };
const chrome = {
    runtime: { id: 'test' },
    storage: {
        local: {
            async get(keys) {
                const out = {};
                for (const key of keys) if (Object.hasOwn(legacy, key)) out[key] = structuredClone(legacy[key]);
                return out;
            },
            async set(values) { Object.assign(legacy, structuredClone(values)); },
            async remove(keys) { for (const key of keys) delete legacy[key]; }
        }
    }
};
const window = {
    location,
    ScopedConversationStore: store,
    ImageIntelligenceManager: { scheduleBackgroundAnalysis() { visionSchedules += 1; } },
    ShopIntelligenceManager: { maybeBootstrap() {} },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); }
};
window.window = window;
window.chrome = chrome;
const document = { readyState: 'complete', querySelectorAll() { return []; } };
const context = {
    window, document, chrome, location, console, Date, Math, JSON, String, Number, Array, Object,
    Set, Map, Promise, URL, setTimeout, clearTimeout, encodeURIComponent,
    fetch: async () => ({ ok: false, status: 404, url: '', async json() { return {}; } })
};
vm.createContext(context);
vm.runInContext(source, context);

function emitDetail(convoId, sequence, extra = {}) {
    const event = {
        source: window,
        data: {
            source: 'etsy-page-interceptor',
            type: 'ETSY_DETAIL_VIEW_DATA',
            requestSequence: sequence,
            data: {
                detail: {
                    conversation_id: String(convoId),
                    other_user: { user_id: `buyer-${convoId}`, display_name: `Buyer ${convoId}` },
                    messages: [{
                        message_id: `m-${convoId}`,
                        sender_user_id: `buyer-${convoId}`,
                        sender_type: 'buyer',
                        message_body: `message-${convoId}`,
                        attachments: [],
                        images: [{ image_id: `img-${convoId}`, url: `https://img.example/${convoId}.jpg` }]
                    }],
                    listing_id: String(extra.listingId || (convoId === '100' ? '11111' : '22222'))
                }
            }
        }
    };
    for (const fn of listeners.message || []) fn(event);
}

(async () => {
    emitDetail('100', 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(histories['100'].messages[0].attachments.length, 1, 'images are merged when attachments is an empty array');
    assert.equal(listings['100'].listingId, '11111');

    location.pathname = '/messages/200';
    location.href = 'https://www.etsy.com/messages/200';
    for (const fn of listeners['etsy-ai-locationchange'] || []) fn();
    emitDetail('200', 1);
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.equal(histories['100'].messages[0].message_body, 'message-100', 'tab/conversation 100 remains stored');
    assert.equal(histories['200'].messages[0].message_body, 'message-200');
    assert.equal(listings['100'].listingId, '11111');
    assert.equal(listings['200'].listingId, '22222');
    assert.equal(legacy.ETSY_CHAT_HISTORY.convo_id, '200', 'legacy mirror may point to latest hydration');

    // An old response for the previous route cannot write after the route changed.
    emitDetail('100', 99);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(histories['100'].messages[0].message_body, 'message-100');
    assert.ok(visionSchedules >= 2);

    console.log('etsy context interceptor scoped tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
