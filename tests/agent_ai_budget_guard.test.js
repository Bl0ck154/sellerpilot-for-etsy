const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/content/agent_ai_budget_guard.js'), 'utf8');
let bootstrapCalls = 0;
let refreshCalls = 0;
let auxiliaryCalls = 0;
const imageCalls = [];
const summaryCalls = [];

const window = {
    ShopIntelligenceManager: {
        maybeBootstrap() { bootstrapCalls += 1; return true; },
        async refresh() { refreshCalls += 1; return true; }
    },
    ConversationContextManager: {
        async getOrCreateSummary(history, omitted, options = {}) {
            summaryCalls.push({ history, omitted, options });
            return options.maxWaitMs === 0 ? '' : 'ready';
        }
    },
    GeminiAuxiliaryService: {
        async generateContent() { auxiliaryCalls += 1; return { data: {} }; }
    },
    ImageIntelligenceManager: {
        async analyzeCurrentCustomerImages(options) {
            imageCalls.push(options);
            return options;
        },
        async waitForCurrentAnalysis(maxWaitMs) {
            return { maxWaitMs };
        }
    }
};
const context = { window, location: { pathname: '/messages/123' }, console };
window.window = window;
window.location = context.location;
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    assert.equal(window.ShopIntelligenceManager.maybeBootstrap('conversation_loaded'), false);
    assert.equal(await window.ShopIntelligenceManager.refresh('conversation_loaded'), false);

    assert.equal(await window.ConversationContextManager.getOrCreateSummary(
        { convo_id: '123' }, [{ sourceIndex: 1, message: { message_body: 'middle' } }]
    ), '');
    assert.equal(summaryCalls[0].options.maxWaitMs, 0, 'long-thread summary is background-first in Messages');

    const skipped = await window.GeminiAuxiliaryService.generateContent({
        body: { contents: [{ parts: [{ text: 'SECURITY BOUNDARY\nCreate a compact evidence map for an Etsy assistant.' }] }] }
    });
    assert.equal(skipped.skippedByBudgetGuard, true);
    assert.equal(auxiliaryCalls, 0, 'shop-intelligence duplicate call is skipped in Messages');

    const status = () => {};
    await window.ImageIntelligenceManager.analyzeCurrentCustomerImages({ onStatus: status });
    assert.equal(imageCalls[0].onStatus, undefined);
    assert.equal(imageCalls[0].waitForCompletion, false);

    await window.ImageIntelligenceManager.analyzeCurrentCustomerImages({ onStatus: status, waitForCompletion: true });
    assert.equal(imageCalls[1].onStatus, status);
    assert.equal(imageCalls[1].waitForCompletion, true);

    const before = imageCalls.length;
    const waited = await window.ImageIntelligenceManager.waitForCurrentAnalysis(1000);
    assert.equal(waited.maxWaitMs, 1000);
    assert.equal(imageCalls.length, before, 'bounded wait does not trigger a second pre-analysis pass');

    context.location.pathname = '/listing/9';
    window.ShopIntelligenceManager.maybeBootstrap('listing');
    await window.ShopIntelligenceManager.refresh('listing');
    await window.GeminiAuxiliaryService.generateContent({ body: { contents: [{ parts: [{ text: 'listing intelligence' }] }] } });
    assert.equal(bootstrapCalls, 1);
    assert.equal(refreshCalls, 1);
    assert.equal(auxiliaryCalls, 1, 'non-message shop intelligence remains available');

    console.log('agent AI budget guard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
