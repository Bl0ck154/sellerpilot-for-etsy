const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'src/content/agent_context_manager.js'), 'utf8');
const storage = {
    ETSY_CHAT_HISTORY: {
        convo_id: '123',
        customer_user_id: 'buyer-1',
        customer_display_name: 'Anna',
        timestamp: Date.now(),
        messages: [
            { sender_user_id: 'buyer-1', sender_display_name: 'Anna', message_body: 'First request', create_date: 1700000000 },
            { sender_user_id: 'owner-1', sender_display_name: 'Owner', message_body: 'Sure', create_date: 1700000100 },
            { sender_user_id: 'buyer-1', sender_display_name: 'Anna', body: 'Actually use the second photo', create_date: 1700000200, attachments: [{ id: 1 }] }
        ]
    },
    ETSY_CURRENT_LISTING_ID: '999',
    RAG_LISTING_999: { title: 'Custom Family Portrait' },
    current_chat_messages_scope: Array.from({ length: 40 }, (_, index) => ({
        type: index % 2 ? 'ai' : 'user',
        text: `assistant-thread-${index}`
    }))
};

class BaseAIService {
    static INSTRUCTIONS = {
        formatAge() { return '1m'; },
        async buildFullInstruction() {
            return 'BASE\n\nRAW_CONTEXT\n\n[PAGE_SCOPE: messages | convo_id=123]';
        }
    };
    trimMessageText(text, maxChars) {
        return String(text || '').slice(0, maxChars);
    }
}

const window = {
    BaseAIService,
    addEventListener() {},
    ImageIntelligenceManager: {
        getMetadata: () => ({ imageIntelCount: 2, imageIntelErrors: [] })
    }
};
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
                Object.assign(storage, structuredClone(values));
            }
        }
    }
};
const context = {
    window,
    BaseAIService,
    chrome,
    location: { pathname: '/messages/123' },
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Math,
    encodeURIComponent,
    fetch: async () => { throw new Error('Unexpected fetch in unit test'); }
};
window.window = window;
window.chrome = chrome;
window.location = context.location;
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const fullInstruction = await BaseAIService.INSTRUCTIONS.buildFullInstruction({});
    assert.match(fullInstruction, /ACTIVE_CONTEXT_SNAPSHOT/);
    assert.match(fullInstruction, /Customer: Anna/);
    assert.match(fullInstruction, /Actually use the second photo/);
    assert.match(fullInstruction, /Latest OWNER Etsy message.*Sure/);
    assert.match(fullInstruction, /Active listing: listing_id=999 — Custom Family Portrait/);
    assert.ok(
        fullInstruction.indexOf('ACTIVE_CONTEXT_SNAPSHOT') < fullInstruction.indexOf('[PAGE_SCOPE:'),
        'active snapshot should sit immediately before PAGE_SCOPE'
    );

    const service = new BaseAIService();
    const history = await service.buildConversationHistory('current_chat_messages_scope', 'new turn');
    assert.equal(history.length, 33, 'keeps 32 stored assistant turns plus the current Owner turn');
    assert.equal(history[0].content, 'assistant-thread-0');
    assert.equal(history[5].content, 'assistant-thread-5');
    assert.equal(history[6].content, 'assistant-thread-14');
    assert.equal(history.at(-2).content, 'assistant-thread-39');
    assert.equal(history.at(-1).content, 'new turn');

    storage.ETSY_CHAT_HISTORY = {
        convo_id: '999',
        messages: [{ message_body: 'wrong customer' }],
        timestamp: Date.now()
    };
    const staleSnapshot = await window.AgentContextManager.buildActiveContextSnapshot();
    assert.match(staleSnapshot, /not ready or mismatched/);
    assert.doesNotMatch(staleSnapshot, /wrong customer/);

    console.log('agent context manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
