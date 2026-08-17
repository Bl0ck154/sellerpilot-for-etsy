const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'src/content/agent_scope_guard.js'), 'utf8');

const storage = {
    ETSY_CHAT_HISTORY: { convo_id: '100', messages: [{ message_body: 'old customer' }] },
    ETSY_CURRENT_LISTING_ID: '999',
    ETSY_CURRENT_LISTING_SCOPE: { convoId: '100', listingId: '999' },
    ETSY_AI_ACTIVE_CONTEXT_FACTS: { convoId: '100', receiptId: 'r-old' },
    current_context: {
        metadata: { url: 'https://www.etsy.com/messages/100' },
        page_url: 'https://www.etsy.com/messages/100'
    }
};
const storageListeners = [];
const eventListeners = {};
let summaryConcurrent = 0;
let summaryMaxConcurrent = 0;

const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                const result = {};
                for (const key of keys) {
                    if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = storage[key];
                }
                return result;
            },
            async set(values) {
                const changes = {};
                for (const [key, value] of Object.entries(values)) {
                    changes[key] = { oldValue: storage[key], newValue: structuredClone(value) };
                    storage[key] = structuredClone(value);
                }
                for (const listener of storageListeners) listener(changes, 'local');
            },
            async remove(keys) {
                const list = Array.isArray(keys) ? keys : [keys];
                const changes = {};
                for (const key of list) {
                    if (!Object.prototype.hasOwnProperty.call(storage, key)) continue;
                    changes[key] = { oldValue: storage[key], newValue: undefined };
                    delete storage[key];
                }
                if (Object.keys(changes).length) {
                    for (const listener of storageListeners) listener(changes, 'local');
                }
            }
        },
        onChanged: {
            addListener(listener) { storageListeners.push(listener); }
        }
    }
};

const location = {
    href: 'https://www.etsy.com/messages/200',
    pathname: '/messages/200'
};

const window = {
    location,
    addEventListener(type, handler) {
        eventListeners[type] = eventListeners[type] || [];
        eventListeners[type].push(handler);
    },
    EtsyAI_GetFreshContext() {
        return {
            metadata: { url: 'https://www.etsy.com/messages/100' },
            page_url: 'https://www.etsy.com/messages/100'
        };
    },
    PageParser: {
        getFullPageData() {
            return {
                title: 'Customer 200',
                markdown: 'live page',
                excerpt: '',
                siteName: 'Etsy',
                hasContent: true,
                metadata: { url: location.href }
            };
        }
    },
    ImageIntelligenceManager: {
        async analyzeCurrentCustomerImages() { return { imageIntelCount: 1 }; },
        async buildContextSection() { return 'IMAGE'; },
        getMetadata() { return { imageIntelCount: 1, imageIntelErrors: [] }; }
    },
    ConversationContextManager: {
        DEFAULT_FOREGROUND_WAIT_MS: 100,
        async getCachedSummary() { return ''; },
        async precomputeSummary(chatHistory) {
            summaryConcurrent += 1;
            summaryMaxConcurrent = Math.max(summaryMaxConcurrent, summaryConcurrent);
            await new Promise(resolve => setTimeout(resolve, 15));
            summaryConcurrent -= 1;
            return `summary-${chatHistory.convo_id}`;
        }
    }
};

let fetchCalls = 0;
const context = {
    window,
    chrome,
    location,
    console,
    URL,
    Date,
    Math,
    String,
    Array,
    Object,
    Number,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    fetch: async () => {
        fetchCalls += 1;
        return { url: 'https://www.etsy.com/listing/88888/test' };
    }
};
window.window = window;
window.chrome = chrome;

vm.createContext(context);
vm.runInContext(source, context);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    await delay(5);

    // Multi-tab safety: data belonging to another Etsy conversation must not be
    // destructively removed merely because this tab is currently on conversation 200.
    assert.equal(storage.ETSY_CHAT_HISTORY.convo_id, '100', 'previous conversation is preserved for another tab');
    assert.equal(storage.ETSY_CURRENT_LISTING_ID, '999', 'previous listing is preserved for another tab');
    assert.equal(storage.ETSY_CURRENT_LISTING_SCOPE.convoId, '100', 'previous listing scope is preserved for another tab');
    assert.equal(storage.ETSY_AI_ACTIVE_CONTEXT_FACTS.convoId, '100', 'previous active facts are preserved for another tab');
    assert.equal(await window.EtsyAgentScopeGuard.clearStaleScopedState(), true, 'legacy cleanup hook is intentionally non-destructive');

    const fresh = window.EtsyAI_GetFreshContext();
    assert.equal(fresh.metadata.url, 'https://www.etsy.com/messages/200', 'fresh context guard bypasses old SPA cache');

    storage.ETSY_CHAT_HISTORY = { convo_id: '200', messages: [{ message_body: 'live customer' }] };
    assert.equal(await window.ImageIntelligenceManager.buildContextSection(), 'IMAGE');

    storage.ETSY_CHAT_HISTORY = { convo_id: '201', messages: [{ message_body: 'wrong customer' }] };
    assert.equal(await window.ImageIntelligenceManager.buildContextSection(), '', 'vision context is blocked when conversation mismatches');

    storage.ETSY_CHAT_HISTORY = { convo_id: '200', messages: [{ message_body: 'live customer' }] };

    await window.EtsyAgentScopeGuard.bindListingScopeFromDetail({
        detail: { conversation_id: '200', listing_id: '77777' }
    });
    assert.equal(storage.ETSY_CURRENT_LISTING_ID, '77777');
    assert.deepEqual(
        JSON.parse(JSON.stringify(storage.ETSY_CURRENT_LISTING_SCOPE)),
        { convoId: '200', listingId: '77777', updatedAt: storage.ETSY_CURRENT_LISTING_SCOPE.updatedAt }
    );
    assert.equal(await window.EtsyAgentScopeGuard.getScopedListingId(), '77777');

    delete storage.ETSY_CURRENT_LISTING_ID;
    delete storage.ETSY_CURRENT_LISTING_SCOPE;
    await window.EtsyAgentScopeGuard.resolveListingFromTransaction('tx-1', '200');
    assert.equal(fetchCalls, 1);
    assert.equal(storage.ETSY_CURRENT_LISTING_ID, '88888');
    assert.equal(storage.ETSY_CURRENT_LISTING_SCOPE.convoId, '200');

    const omitted = [{ sourceIndex: 1, message: { message_body: 'middle', create_date: 1 } }];
    await Promise.all([
        window.ConversationContextManager.precomputeSummary({ convo_id: '200' }, omitted),
        window.ConversationContextManager.precomputeSummary({ convo_id: '201' }, omitted)
    ]);
    assert.equal(summaryMaxConcurrent, 1, 'semantic summary writes are serialized to avoid lost cache updates');

    console.log('agent scope guard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
