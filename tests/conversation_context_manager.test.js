const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = { gemini_api_key: 'test-key' };
let fetchCount = 0;
let lastPrompt = '';
let fetchImplementation = null;
const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                return Object.fromEntries(keys
                    .filter(key => Object.prototype.hasOwnProperty.call(storage, key))
                    .map(key => [key, structuredClone(storage[key])]));
            },
            async set(values) { Object.assign(storage, structuredClone(values)); }
        }
    }
};

const context = {
    window: { ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'] },
    chrome,
    console,
    Date,
    Math,
    Object,
    Array,
    String,
    Map,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
        fetchCount += 1;
        const body = JSON.parse(options.body);
        lastPrompt = body.contents[0].parts[0].text;
        if (fetchImplementation) return fetchImplementation(_url, options);
        return {
            ok: true,
            async json() {
                return {
                    candidates: [{ content: { parts: [{ text: 'Customer clarified the earlier request [source_message=3]. The Owner acknowledged it [source_message=4].' }] } }]
                };
            }
        };
    }
};
context.window.window = context.window;
context.window.chrome = chrome;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'conversation_context_manager.js'), 'utf8'),
    context
);

(async () => {
    const manager = context.window.ConversationContextManager;
    const history = { convo_id: '77', customer_user_id: 'buyer' };
    const omitted = [
        { sourceIndex: 3, message: { sender_user_id: 'buyer', sender_display_name: 'Customer', message_body: 'Earlier detail' } },
        { sourceIndex: 4, message: { sender_user_id: 'owner', sender_display_name: 'Owner', message_body: 'Acknowledged' } }
    ];

    const first = await manager.getOrCreateSummary(history, omitted);
    assert.match(first, /source_message=3/);
    assert.match(lastPrompt, /Do not impose a preset category list/);
    assert.match(lastPrompt, /untrusted conversation content/);
    assert.equal(fetchCount, 1);

    const second = await manager.getOrCreateSummary(history, omitted);
    assert.equal(second, first);
    assert.equal(fetchCount, 1, 'semantic summary is reused from cache');

    const section = manager.buildContextSection(first, omitted.length);
    assert.match(section, /CUSTOMER_CONVERSATION_MIDDLE_SUMMARY/);
    assert.match(section, /original beginning and recent messages/);

    const roleFallbackHistory = { convo_id: 'role-fallback' };
    const roleFallbackMessages = [
        { sourceIndex: 8, message: { sender_type: 'buyer', sender_display_name: 'Client', message_body: 'Buyer detail' } },
        { sourceIndex: 9, message: { role: 'shop_owner', sender_display_name: 'Manager', message_body: 'Owner response' } }
    ];
    await manager.getOrCreateSummary(roleFallbackHistory, roleFallbackMessages);
    assert.match(lastPrompt, /\[source_message=8; CUSTOMER: Client\]/, 'sender_type identifies the customer when IDs are absent');
    assert.match(lastPrompt, /\[source_message=9; OWNER: Manager\]/, 'role identifies the owner when IDs are absent');

    let releaseSlowFetch;
    fetchImplementation = async () => new Promise(resolve => {
        releaseSlowFetch = () => resolve({
            ok: true,
            async json() {
                return {
                    candidates: [{ content: { parts: [{ text: 'Background summary [source_message=12].' }] } }]
                };
            }
        });
    });

    const slowHistory = { convo_id: 'slow-summary', customer_user_id: 'buyer' };
    const slowMessages = [
        { sourceIndex: 12, message: { sender_user_id: 'buyer', message_body: 'A detail that should be cached later' } }
    ];
    const startedAt = Date.now();
    const foreground = await manager.getOrCreateSummary(slowHistory, slowMessages, { maxWaitMs: 5 });
    assert.equal(foreground, '', 'foreground prompt proceeds when semantic compression is not ready');
    assert.ok(Date.now() - startedAt < 250, 'foreground wait is bounded');

    const buildingStatus = await manager.getSummaryStatus(slowHistory, slowMessages);
    assert.equal(buildingStatus.status, 'building');
    assert.equal(await manager.getCachedSummary(slowHistory, slowMessages), '', 'cache-only reads never wait for generation');

    releaseSlowFetch();
    const completed = await manager.precomputeSummary(slowHistory, slowMessages);
    assert.match(completed, /source_message=12/);
    assert.equal(await manager.getCachedSummary(slowHistory, slowMessages), completed, 'background generation populates the cache');
    assert.equal((await manager.getSummaryStatus(slowHistory, slowMessages)).status, 'ready');

    console.log('conversation context manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
