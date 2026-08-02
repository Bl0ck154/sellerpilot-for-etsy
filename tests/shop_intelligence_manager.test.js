const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = {
    gemini_api_key: 'test-key',
    current_context: {
        page_content: {
            title: 'Messages',
            excerpt: 'Customer asks about a custom order.'
        }
    }
};
let responseText = `Here is the JSON summary:
\`\`\`json
{
  "customWorkStance": "unknown",
  "requiredDetails": ["size",],
  "riskTriggers": [],
  "doNotPromise": ["Keep wording like comma, } intact",],
  "tone": "friendly",
  "guidance": ["Confirm details",],
  "evidence": [],
  "unknowns": [],
}
\`\`\``;
let lastRequestBody = null;

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
            async set(values) { Object.assign(storage, structuredClone(values)); }
        }
    }
};

const context = {
    window: {
        ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest']
    },
    location: { href: 'https://www.etsy.com/messages/1250240141' },
    document: { title: 'Messages - Etsy' },
    chrome,
    console,
    Date,
    Math,
    Object,
    Array,
    String,
    JSON,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
        lastRequestBody = JSON.parse(options.body);
        return {
            ok: true,
            async json() {
                return {
                    candidates: [{ content: { parts: [{ text: responseText }] } }]
                };
            }
        };
    }
};
context.window.window = context.window;
context.window.chrome = chrome;
context.window.location = context.location;
context.window.document = context.document;

vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'shop_intelligence_manager.js'), 'utf8'),
    context
);

(async () => {
    const manager = context.window.ShopIntelligenceManager;
    const refreshed = await manager.refresh('regression_test');
    assert.equal(refreshed, true, 'trailing commas and fenced/prefixed JSON are repaired');

    const summary = storage[manager.SUMMARY_KEY];
    assert.equal(summary.summaryJson.customWorkStance, 'unknown');
    assert.equal(summary.summaryJson.requiredDetails[0], 'size');
    assert.equal(summary.summaryJson.doNotPromise[0], 'Keep wording like comma, } intact');
    assert.equal(
        lastRequestBody.generationConfig.responseMimeType,
        'application/json',
        'Gemini is explicitly asked for JSON output'
    );

    delete storage[manager.SUMMARY_KEY];
    delete storage.ETSY_AI_SHOP_INTELLIGENCE_LAST_HASH;
    delete storage.ETSY_AI_SHOP_INTELLIGENCE_LAST_REFRESH;
    storage.current_context.page_content.excerpt = 'Changed context';
    responseText = '{ definitely not valid JSON }';
    assert.equal(await manager.refresh('invalid_json_test'), false, 'irreparable output fails without crashing callers');
    assert.equal(storage[manager.SUMMARY_KEY], undefined, 'invalid output is not cached');
    assert.equal(storage.ETSY_AI_SHOP_INTELLIGENCE_LAST_REFRESH, undefined, 'failed parsing does not start the six-hour success cooldown');

    storage.current_context.page_content.excerpt = 'Changed context again';
    responseText = 'null';
    assert.equal(await manager.refresh('wrong_json_shape_test'), false, 'valid JSON with the wrong shape is rejected');
    assert.equal(storage[manager.SUMMARY_KEY], undefined, 'wrong-shaped JSON is not cached');

    console.log('shop intelligence manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
