const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'scoped_conversation_store.js'), 'utf8');
const storage = {};
const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                const out = {};
                for (const key of (Array.isArray(keys) ? keys : [keys])) {
                    if (Object.hasOwn(storage, key)) out[key] = structuredClone(storage[key]);
                }
                return out;
            },
            async set(values) { Object.assign(storage, structuredClone(values)); },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key];
            }
        }
    }
};
const location = { pathname: '/messages/100' };
const window = { location };
window.window = window;
window.chrome = chrome;
const context = { window, chrome, location, console, String, Object, Array, Date };
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const store = window.ScopedConversationStore;

    await store.setHistory({ convo_id: '100', messages: [{ message_body: 'A' }] });
    await store.setListing('100', '11111');
    await store.setFacts({ convoId: '100', receiptId: 'rA' });

    location.pathname = '/messages/200';
    await store.setHistory({ convo_id: '200', messages: [{ message_body: 'B' }] });
    await store.setListing('200', '22222');
    await store.setFacts({ convoId: '200', receiptId: 'rB' });

    assert.equal((await store.getHistory('100')).messages[0].message_body, 'A');
    assert.equal((await store.getHistory('200')).messages[0].message_body, 'B');
    assert.equal((await store.getListing('100')).listingId, '11111');
    assert.equal((await store.getListing('200')).listingId, '22222');
    assert.equal((await store.getFacts('100')).receiptId, 'rA');
    assert.equal((await store.getFacts('200')).receiptId, 'rB');

    // The compatibility mirror points to the latest tab, but scoped reads remain independent.
    assert.equal(storage.ETSY_CHAT_HISTORY.convo_id, '200');
    assert.equal(storage.ETSY_CURRENT_LISTING_ID, '22222');
    assert.equal(storage.ETSY_AI_ACTIVE_CONTEXT_FACTS.convoId, '200');
    assert.equal((await store.getHistory('100')).convo_id, '100');

    await store.clearListing('100');
    assert.equal(await store.getListing('100'), null);
    assert.equal((await store.getListing('200')).listingId, '22222', 'clearing tab A cannot clear tab B listing');

    await store.clearFacts('100');
    assert.equal(await store.getFacts('100'), null);
    assert.equal((await store.getFacts('200')).receiptId, 'rB', 'clearing tab A cannot clear tab B facts');

    console.log('scoped conversation store tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
