const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'conversation_context_manager.js'), 'utf8');
const storage = { gemini_api_key: 'key' };
let fetchCount = 0;
let delayedRelease = null;
let delayNext = false;
const chrome = {
    runtime: { id: 'test' },
    storage: {
        local: {
            async get(keys) {
                const out = {};
                for (const key of keys) if (Object.hasOwn(storage, key)) out[key] = structuredClone(storage[key]);
                return out;
            },
            async set(values) { Object.assign(storage, structuredClone(values)); }
        }
    }
};
const window = { ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'] };
window.window = window;
window.chrome = chrome;
const context = {
    window, chrome, console, Date, Math, Object, Array, String, Map, Promise, BigInt,
    AbortController, setTimeout, clearTimeout,
    fetch: async (_url, options) => {
        fetchCount += 1;
        const body = JSON.parse(options.body);
        const prompt = body.contents[0].parts[0].text;
        const marker = prompt.match(/source_message=(\d+)/)?.[1] || String(fetchCount);
        if (delayNext) {
            delayNext = false;
            await new Promise(resolve => { delayedRelease = resolve; });
        }
        return {
            ok: true,
            async json() {
                return { candidates: [{ content: { parts: [{ text: `Summary [source_message=${marker}]` }] } }] };
            }
        };
    }
};
vm.createContext(context);
vm.runInContext(source, context);

function omitted(index, text) {
    return [{ sourceIndex: index, message: { sender_user_id: 'buyer', sender_type: 'buyer', message_body: text } }];
}

(async () => {
    const manager = window.ConversationContextManager;
    const a = { convo_id: '100', customer_user_id: 'buyer' };
    const b = { convo_id: '200', customer_user_id: 'buyer' };

    const first = await manager.getOrCreateSummary(a, omitted(3, 'A detail'));
    assert.match(first, /source_message=3/);
    assert.equal(await manager.getCachedSummary(a, omitted(3, 'A detail')), first);

    // Simulate tab A running a slow model call while tab B writes another summary.
    const slowA = { convo_id: '300', customer_user_id: 'buyer' };
    const fastB = { convo_id: '400', customer_user_id: 'buyer' };
    delayNext = true;
    const promiseA = manager.precomputeSummary(slowA, omitted(30, 'slow A'));
    while (!delayedRelease) await new Promise(resolve => setTimeout(resolve, 1));
    const summaryB = await manager.precomputeSummary(fastB, omitted(40, 'fast B'));
    delayedRelease();
    const summaryA = await promiseA;

    assert.match(summaryA, /source_message=30/);
    assert.match(summaryB, /source_message=40/);
    assert.equal(await manager.getCachedSummary(slowA, omitted(30, 'slow A')), summaryA);
    assert.equal(await manager.getCachedSummary(fastB, omitted(40, 'fast B')), summaryB, 'slow tab commit merges instead of erasing another tab cache entry');

    const status = await manager.getSummaryStatus({ convo_id: '500' }, omitted(50, 'new'));
    assert.equal(status.status, 'missing');

    console.log('conversation context manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
