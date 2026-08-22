const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'agent_scoped_context_bridge.js'), 'utf8');
const histories = {
    '100': {
        convo_id: '100', customer_user_id: 'buyerA', customer_display_name: 'A', timestamp: Date.now(),
        messages: [{ sender_user_id: 'buyerA', sender_display_name: 'A', sender_type: 'buyer', message_body: 'CUSTOMER_A_ONLY', attachments: [] }]
    },
    '200': {
        convo_id: '200', customer_user_id: 'buyerB', customer_display_name: 'B', timestamp: Date.now(),
        messages: [{ sender_user_id: 'buyerB', sender_display_name: 'B', sender_type: 'buyer', message_body: 'CUSTOMER_B_ONLY', attachments: [] }]
    }
};
const listings = { '100': { convoId: '100', listingId: '11111' }, '200': { convoId: '200', listingId: '22222' } };
const visibleHistories = {
    '100': { messages: [{ message_body: 'CUSTOMER_A_ONLY' }, { message_body: 'CUSTOMER_A_VISIBLE_NEW' }] },
    '200': { messages: [{ message_body: 'CUSTOMER_B_ONLY' }, { message_body: 'CUSTOMER_B_VISIBLE_NEW' }] }
};
const location = { pathname: '/messages/100' };
const chrome = {
    runtime: { id: 'test' },
    storage: {
        local: {
            async get(keys) {
                const out = {};
                for (const key of keys) {
                    if (key === 'RAG_LISTING_11111') out[key] = { title: 'Listing A', description: 'A desc', timestamp: Date.now() };
                    if (key === 'RAG_LISTING_22222') out[key] = { title: 'Listing B', description: 'B desc', timestamp: Date.now() };
                }
                return out;
            },
            async remove() {}
        }
    }
};
const window = {
    BaseAIService: {
        INSTRUCTIONS: {
            LIMITS: {
                etsyChatMessageChars: 6000,
                etsyChatTotalChars: 160000,
                primaryListingDescriptionChars: 16000,
                secondaryListings: 3,
                secondarySnippetChars: 140
            },
            formatAge() { return '0s'; },
            trimText(text, n) { return String(text || '').slice(0, n); },
            scanCurrentChatForListings() { return []; }
        }
    },
    ScopedConversationStore: {
        async getHistory(convoId) { return histories[String(convoId)] || null; },
        async getListing(convoId) { return listings[String(convoId)] || null; }
    },
    EtsyAdapter: {
        extractDomConversation(convoId) { return visibleHistories[String(convoId)] || null; }
    }
};
window.window = window;
window.chrome = chrome;
window.location = location;
const document = { querySelectorAll() { return []; } };
const context = { window, chrome, location, document, console, Date, Math, String, Object, Array, Set, Promise, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const instructions = window.BaseAIService.INSTRUCTIONS;
    const aChat = await instructions.getChatHistoryContext();
    const aRag = await instructions.getRAGContext();
    assert.match(aChat, /CUSTOMER_A_ONLY/);
    assert.match(aChat, /CUSTOMER_A_VISIBLE_NEW/);
    assert.doesNotMatch(aChat, /CUSTOMER_B_ONLY/);
    assert.doesNotMatch(aChat, /CUSTOMER_B_VISIBLE_NEW/);
    assert.match(aRag, /Listing A/);
    assert.doesNotMatch(aRag, /Listing B/);

    location.pathname = '/messages/200';
    const bChat = await instructions.getChatHistoryContext();
    const bRag = await instructions.getRAGContext();
    assert.match(bChat, /CUSTOMER_B_ONLY/);
    assert.match(bChat, /CUSTOMER_B_VISIBLE_NEW/);
    assert.doesNotMatch(bChat, /CUSTOMER_A_ONLY/);
    assert.doesNotMatch(bChat, /CUSTOMER_A_VISIBLE_NEW/);
    assert.match(bRag, /Listing B/);
    assert.doesNotMatch(bRag, /Listing A/);

    console.log('agent scoped context bridge tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
