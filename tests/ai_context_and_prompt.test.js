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
        'balanced',
        'short requests use semantic reasoning without keyword-triggered mode switches'
    );
    assert.equal(
        service._selectThinkingMode([{ role: 'user', content: 'Analyze this context' }], 'x'.repeat(61000)),
        'deep',
        'large contexts receive deep reasoning based on actual complexity'
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
        customer_user_id: 'buyer-1',
        customer_display_name: 'Customer',
        timestamp: Date.now(),
        messages: Array.from({ length: 230 }, (_, index) => ({
            sender_display_name: index % 2 ? 'Owner' : 'Customer',
            sender_user_id: index % 2 ? 'owner-1' : 'buyer-1',
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
    assert.match(chatContext, /\[CUSTOMER: Customer\]/, 'Etsy messages receive explicit participant roles');

    // Force the safety budget to omit part of an unusually large thread. The generic
    // selection policy must preserve both ends without guessing which words are important.
    let summarizedMessages = [];
    context.window.ConversationContextManager = {
        async getOrCreateSummary(_conversation, omittedMessages) {
            summarizedMessages = omittedMessages;
            return 'The omitted middle contains preserved decisions and corrections.';
        },
        buildContextSection(summary) {
            return `### CUSTOMER_CONVERSATION_MIDDLE_SUMMARY\n${summary}\n`;
        }
    };
    instructions.LIMITS.etsyChatTotalChars = 220;
    const truncatedChatContext = await instructions.getChatHistoryContext();
    assert.match(truncatedChatContext, /forest background/, 'the beginning of a large conversation remains available');
    assert.match(truncatedChatContext, /wings to every person/, 'the newest part of a large conversation remains available');
    assert.match(truncatedChatContext, /middle message\(s\) omitted/, 'only the middle is dropped under the safety budget');
    assert.match(truncatedChatContext, /CUSTOMER_CONVERSATION_MIDDLE_SUMMARY/, 'omitted middle messages are semantically compressed');
    assert.ok(summarizedMessages.length > 0, 'the compressor receives the actual omitted messages');
    instructions.LIMITS.etsyChatTotalChars = 160000;

    storage.current_chat_messages_scope = [{ type: 'user', text: 'Current request' }];
    const assistantHistory = await service.buildConversationHistory('current_chat_messages_scope', 'Current request');
    assert.equal(assistantHistory.length, 1, 'the current Owner turn is not duplicated after it has already been saved');

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

    storage.custom_instructions = 'Use the shop-specific vocabulary saved by the Owner.';
    const instructionWithCustomization = await instructions.buildFullInstruction({
        page_content: { title: 'Test', hasContent: false },
        metadata: { url: 'https://www.etsy.com/messages/123' }
    });
    assert.match(instructionWithCustomization, /^BASE/, 'custom instructions do not replace the stable base policy');
    assert.match(instructionWithCustomization, /OWNER_CUSTOM_INSTRUCTIONS/);
    assert.match(instructionWithCustomization, /shop-specific vocabulary/);
    delete storage.custom_instructions;

    const basePrompt = read('src/config/base_instruction.js');
    assert.match(basePrompt, /Use judgment about relevance/);
    assert.match(basePrompt, /read the whole available conversation and product context/);
    assert.match(basePrompt, /An open Etsy messages page provides context; it does not automatically/);
    assert.match(basePrompt, /revisit the original task using preceding turns/);
    assert.match(basePrompt, /Select the requirements, constraints, decisions, unresolved points/);
    assert.doesNotMatch(basePrompt, /Dates and deadlines are first-class requirements/);
    assert.doesNotMatch(basePrompt, /Ты что\?|навіщо я вказала скріншот|зачем я указала скриншот/);
    assert.doesNotMatch(basePrompt, /### EXAMPLES|\*\*Correct output|\*\*Wrong/);

    const policy = JSON.parse(read('src/config/agent_policy.json'));
    assert.match(policy.systemAddendum, /according to their relevance and reliability/);
    assert.doesNotMatch(policy.systemAddendum, /CONVERSATION_KEY_DETAILS|Include active dates\/deadlines/);

    const chatUiSource = read('src/content/chat_ui.js');
    assert.match(chatUiSource, /Use semantic intent, not keyword matching/);
    assert.match(chatUiSource, /analyzeCurrentCustomerImages/);
    assert.doesNotMatch(chatUiSource, /shouldAnalyzeQuickReplyIntent|IMAGE_ANALYSIS_DECISION_SYSTEM_PROMPT|detectOverpromiseRisk/);

    console.log('ai context and prompt tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
