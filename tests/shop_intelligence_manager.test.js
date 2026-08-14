const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = {
    gemini_api_key: 'test-key',
    ETSY_GLOBAL_USER_ID: 'owner-1',
    ETSY_CURRENT_LISTING_ID: 'listing-1',
    'RAG_LISTING_listing-1': {
        title: 'Portrait listing',
        description: 'A made-to-order portrait.'
    },
    ETSY_CHAT_HISTORY: {
        convo_id: '1250240141',
        customer_display_name: 'Customer One',
        messages: [
            {
                sender_type: 'customer',
                sender_display_name: 'Customer One',
                message_body: 'Please keep the forest background.'
            },
            {
                sender_user_id: 'owner-1',
                sender_display_name: 'Studio Owner',
                message_body: 'I will review the reference.'
            }
        ]
    },
    current_context: {
        metadata: { url: 'https://www.etsy.com/messages/1250240141' },
        page_content: {
            title: 'Messages',
            excerpt: 'Customer asks about a custom order.'
        }
    }
};

let responseText = `Here is the JSON summary:
\`\`\`json
{
  "observations": [
    {
      "statement": "Keep wording like comma, } intact",
      "scope": "conversation",
      "confidence": "high",
      "evidence": [{"source":"etsy_conversation","quote":"forest background"}],
    },
    {
      "statement": "This listing is for a made-to-order portrait",
      "scope": "listing",
      "confidence": "high",
      "evidence": [{"source":"listing_cache","quote":"made-to-order portrait"}],
    },
    {
      "statement": "The whole shop always accepts forest backgrounds",
      "scope": "shop",
      "confidence": "low",
      "evidence": [{"source":"etsy_conversation","quote":"forest background"}],
    },
  ],
  "uncertainties": ["Size is not known",],
}
\`\`\``;
let lastRequestBody = null;
let fetchCount = 0;

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
    location: { href: 'https://www.etsy.com/messages/1250240141', pathname: '/messages/1250240141' },
    document: { title: 'Messages - Etsy' },
    chrome,
    console,
    Date,
    Math,
    Object,
    Array,
    String,
    JSON,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
        fetchCount += 1;
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

function setCurrentUrl(url) {
    const parsed = new URL(url);
    context.location.href = url;
    context.location.pathname = parsed.pathname;
    storage.current_context.metadata = { ...(storage.current_context.metadata || {}), url };
}

(async () => {
    const manager = context.window.ShopIntelligenceManager;
    const refreshed = await manager.refresh('regression_test');
    assert.equal(refreshed, true, 'trailing commas and fenced/prefixed JSON are repaired');

    const summary = storage[manager.SUMMARY_KEY];
    assert.equal(summary.summaryJson.observations[0].scope, 'conversation');
    assert.equal(summary.summaryJson.observations[0].statement, 'Keep wording like comma, } intact');
    assert.equal(summary.sourceScope.conversationId, '1250240141');
    assert.equal(summary.sourceScope.listingId, 'listing-1');
    assert.match(summary.summaryText, /Conversation- or listing-scoped items are not global shop policy/);
    assert.equal(
        lastRequestBody.generationConfig.responseMimeType,
        'application/json',
        'Gemini is explicitly asked for JSON output'
    );
    const firstPrompt = lastRequestBody.contents[0].parts[0].text;
    assert.match(firstPrompt, /"role": "CUSTOMER"/, 'customer role falls back to sender_type without IDs');
    assert.match(firstPrompt, /"role": "OWNER"/, 'owner role uses the known Owner ID');

    const sameConversationContext = await manager.buildContextSection();
    assert.match(sameConversationContext, /Keep wording like comma/);
    assert.match(sameConversationContext, /This listing is for a made-to-order portrait/);
    assert.match(sameConversationContext, /\[conversation; low\] The whole shop always accepts/, 'unsupported shop inference is demoted to its actual local scope');

    context.location.href = 'https://www.etsy.com/messages/2002';
    context.location.pathname = '/messages/2002';
    storage.ETSY_CHAT_HISTORY = {
        convo_id: '2002',
        customer_user_id: 'buyer-2',
        messages: [{ sender_user_id: 'buyer-2', sender_display_name: 'Customer Two', message_body: 'A separate order.' }]
    };

    const otherConversationContext = await manager.buildContextSection();
    assert.doesNotMatch(otherConversationContext, /Keep wording like comma/);
    assert.doesNotMatch(otherConversationContext, /whole shop always accepts/);
    assert.match(otherConversationContext, /This listing is for a made-to-order portrait/, 'listing evidence may follow the same listing, but customer evidence may not');
    assert.doesNotMatch(otherConversationContext, /Size is not known/, 'source-local uncertainty does not leak to another customer');
    assert.equal(storage.current_context.metadata.url, 'https://www.etsy.com/messages/1250240141', 'test keeps stored metadata stale during the live-navigation guard');
    storage.current_context.metadata.url = context.location.href;

    responseText = JSON.stringify({
        observations: [{
            statement: 'Customer Two requested a separate order',
            scope: 'conversation',
            confidence: 'high',
            evidence: [{ source: 'etsy_conversation', quote: 'A separate order' }]
        }],
        uncertainties: []
    });
    const fetchesBeforeChangedScope = fetchCount;
    assert.equal(await manager.refresh('changed_conversation'), true, 'a changed evidence hash bypasses the cooldown');
    assert.equal(fetchCount, fetchesBeforeChangedScope + 1);
    assert.equal(storage[manager.SUMMARY_KEY].sourceScope.conversationId, '2002');

    storage.ETSY_CURRENT_LISTING_ID = 'listing-2';
    setCurrentUrl('https://www.etsy.com/messages/3003');
    storage.ETSY_CHAT_HISTORY = {
        convo_id: '3003',
        customer_user_id: 'buyer-3',
        messages: [{ sender_user_id: 'buyer-3', message_body: 'Third customer.' }]
    };
    assert.equal(await manager.buildContextSection(), '', 'conversation summary is not injected into a different conversation/listing');

    storage.current_context = {
        metadata: { url: 'https://www.etsy.com/your/shops/me/dashboard' },
        page_content: { title: 'Shop dashboard', excerpt: 'The shop publicly states a seven-day processing window.' }
    };
    setCurrentUrl('https://www.etsy.com/your/shops/me/dashboard');
    responseText = JSON.stringify({
        observations: [{
            statement: 'The shop states a seven-day processing window',
            scope: 'shop',
            confidence: 'high',
            evidence: [{ source: 'page_context', quote: 'seven-day processing window' }]
        }],
        uncertainties: []
    });
    assert.equal(await manager.refresh('shop_dashboard'), true);
    assert.equal(storage[manager.SUMMARY_KEY].sourceScope.pageKind, 'shop-dashboard');
    assert.equal(storage[manager.SUMMARY_KEY].sourceScope.listingId, null, 'stale listing storage is not attached to dashboard evidence');

    setCurrentUrl('https://www.etsy.com/messages/4004');
    storage.ETSY_CHAT_HISTORY = {
        convo_id: '4004',
        customer_user_id: 'buyer-4',
        messages: [{ sender_user_id: 'buyer-4', message_body: 'Fourth customer.' }]
    };
    const globalShopContext = await manager.buildContextSection();
    assert.match(globalShopContext, /seven-day processing window/, 'shop-wide evidence from a shop page remains globally usable');

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
