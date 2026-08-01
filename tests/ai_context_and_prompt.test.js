const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const storage = {};
const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                const requested = Array.isArray(keys) ? keys : Object.keys(keys || {});
                const result = {};
                for (const key of requested) {
                    if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = storage[key];
                }
                return result;
            },
            async set(values) {
                Object.assign(storage, structuredClone(values));
            },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key];
            }
        }
    }
};

const context = {
    window: {
        ETSY_AI_BASE_INSTRUCTION: 'BASE',
        ETSY_AI_GEMINI_FALLBACK_CHAIN: [
            'gemini-flash-latest',
            'gemini-flash-lite-latest',
            'gemini-3.1-flash-lite',
            'gemini-2.5-flash'
        ],
        location: {
            href: 'https://www.etsy.com/messages/123',
            pathname: '/messages/123'
        }
    },
    location: {
        href: 'https://www.etsy.com/messages/123',
        pathname: '/messages/123'
    },
    document: {
        querySelector() { return null; },
        querySelectorAll() { return []; }
    },
    chrome,
    console,
    Date,
    Math,
    Set,
    String,
    Object,
    Array,
    URL,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    fetch: async () => { throw new Error('Unexpected fetch in unit test'); }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.chrome = chrome;

vm.createContext(context);
vm.runInContext(read('src/content/base_ai_service.js'), context);
vm.runInContext(read('src/content/providers/gemini_service.js'), context);

const service = new context.window.GeminiService();
const instructions = context.window.BaseAIService.INSTRUCTIONS;

(async () => {
    assert.equal(context.window.ETSY_AI_GEMINI_FALLBACK_CHAIN[0], 'gemini-flash-latest');

    assert.equal(
        service._selectThinkingMode([{ role: 'user', content: 'Напиши ТЗ для дизайнера' }], ''),
        'deep',
        'technical briefs must receive deep reasoning'
    );
    assert.equal(
        JSON.stringify(service._getThinkingConfig('deep', 'gemini-flash-latest')),
        JSON.stringify({ thinkingLevel: 'high' }),
        'moving Gemini 3 latest alias uses thinkingLevel'
    );
    assert.equal(
        JSON.stringify(service._getThinkingConfig('balanced', 'gemini-3.6-flash')),
        JSON.stringify({ thinkingLevel: 'medium' })
    );
    assert.equal(
        JSON.stringify(service._getThinkingConfig('balanced', 'gemini-2.5-flash')),
        JSON.stringify({ thinkingBudget: 1024 }),
        'Gemini 2.5 fallback retains its supported numeric budget'
    );

    storage.ETSY_CHAT_HISTORY = {
        convo_id: '123',
        timestamp: Date.now(),
        messages: Array.from({ length: 230 }, (_, index) => ({
            sender_display_name: index % 2 ? 'Owner' : 'Customer',
            message_body: index === 0
                ? 'Use the forest background discussed at the start.'
                : index === 229
                    ? 'Add wings to every person, not only the man.'
                    : `Message ${index}`,
            create_date: 1700000000 + index
        }))
    };

    const chatContext = await instructions.getChatHistoryContext();
    assert.match(chatContext, /forest background/, 'context keeps the full ordinary chat instead of only a fixed tail');
    assert.match(chatContext, /wings to every person/, 'context keeps the newest scoped requirement');

    const longListingDescription = `Standard service. ${'detail '.repeat(700)}FINAL LISTING RULE`;
    storage.ETSY_CURRENT_LISTING_ID = '99999';
    storage.RAG_LISTING_99999 = {
        title: 'Custom portrait edit',
        description: longListingDescription,
        personalization: 'Send the names in order',
        timestamp: Date.now()
    };

    const listingContext = await instructions.getRAGContext();
    assert.match(listingContext, /FINAL LISTING RULE/, 'normal Etsy listing descriptions are passed without the old 2500-char truncation');

    const basePrompt = read('src/config/base_instruction.js');
    assert.match(basePrompt, /Silently make a coverage pass/);
    assert.match(basePrompt, /Never silently narrow "add wings to everyone" to one person/);
    assert.match(basePrompt, /Do not explain the listing, restate the obvious service category/);

    console.log('ai context and prompt tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
