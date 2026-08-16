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
            { sender_display_name: 'Anna', body: 'Actually use the second photo', created_at: '2026-08-16T10:00:00Z', attachments: [{ id: 1 }] }
        ]
    },
    ETSY_CURRENT_LISTING_ID: '999',
    ETSY_CURRENT_LISTING_SCOPE: { convoId: '123', listingId: '999' },
    RAG_LISTING_999: { title: 'Custom Family Portrait' },
    current_chat_messages_scope: Array.from({ length: 50 }, (_, index) => ({
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

const listeners = {};
const window = {
    BaseAIService,
    addEventListener(type, handler) { listeners[type] = handler; },
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
    Math
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
    assert.equal(history.length, 41, 'keeps 40 stored assistant turns plus the current Owner turn');
    assert.equal(history[0].content, 'assistant-thread-0');
    assert.equal(history[7].content, 'assistant-thread-7');
    assert.equal(history[8].content, 'assistant-thread-18');
    assert.equal(history.at(-2).content, 'assistant-thread-49');
    assert.equal(history.at(-1).content, 'new turn');

    storage.ETSY_CURRENT_LISTING_SCOPE = { convoId: '999', listingId: '999' };
    const wrongListingSnapshot = await window.AgentContextManager.buildActiveContextSnapshot();
    assert.match(wrongListingSnapshot, /Active listing: unresolved/);
    assert.doesNotMatch(wrongListingSnapshot, /Custom Family Portrait/);

    storage.ETSY_CHAT_HISTORY = {
        convo_id: '999',
        messages: [{ message_body: 'wrong customer' }],
        timestamp: Date.now()
    };
    const staleSnapshot = await window.AgentContextManager.buildActiveContextSnapshot();
    assert.match(staleSnapshot, /not ready or mismatched/);
    assert.doesNotMatch(staleSnapshot, /wrong customer/);

    // Detail facts are recorded without triggering a second conversation-history fetch.
    storage.ETSY_CHAT_HISTORY = {
        convo_id: '123',
        messages: [{ sender_display_name: 'Anna', message_body: 'Hi' }],
        timestamp: Date.now()
    };
    await window.AgentContextManager.recordDetailFacts({
        detail: {
            conversation_id: '123',
            receipt_history: [{
                receipt_id: 77,
                transactions: [{ transaction_id: 88 }]
            }]
        }
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(storage.ETSY_AI_ACTIVE_CONTEXT_FACTS)),
        { convoId: '123', receiptId: '77', transactionIds: ['88'], updatedAt: storage.ETSY_AI_ACTIVE_CONTEXT_FACTS.updatedAt }
    );

    console.log('agent context manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
