const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/content/agent_ai_budget_guard.js'), 'utf8');
let bootstrapCalls = 0;
let refreshCalls = 0;
let auxiliaryCalls = 0;
const imageCalls = [];

const window = {
    ShopIntelligenceManager: {
        maybeBootstrap() { bootstrapCalls += 1; return true; },
        async refresh() { refreshCalls += 1; return true; }
    },
    GeminiAuxiliaryService: {
        async generateContent() { auxiliaryCalls += 1; return { data: {} }; }
    },
    ImageIntelligenceManager: {
        async analyzeCurrentCustomerImages(options) {
            imageCalls.push(options);
            return options;
        }
    }
};
const context = {
    window,
    location: { pathname: '/messages/123' },
    console
};
window.window = window;
window.location = context.location;
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    assert.equal(window.ShopIntelligenceManager.maybeBootstrap('conversation_loaded'), false);
    assert.equal(await window.ShopIntelligenceManager.refresh('conversation_loaded'), false);

    const skipped = await window.GeminiAuxiliaryService.generateContent({
        body: {
            contents: [{
                parts: [{ text: 'SECURITY BOUNDARY\nCreate a compact evidence map for an Etsy assistant.' }]
            }]
        }
    });
    assert.equal(skipped.skippedByBudgetGuard, true);
    assert.equal(auxiliaryCalls, 0, 'shop-intelligence generation is local-skipped on message pages');

    const onStatus = () => {};
    await window.ImageIntelligenceManager.analyzeCurrentCustomerImages({ onStatus });
    assert.equal(imageCalls[0].onStatus, undefined, 'background image analysis never updates text-request status UI');
    assert.equal(imageCalls[0].waitForCompletion, false);

    await window.ImageIntelligenceManager.analyzeCurrentCustomerImages({
        onStatus,
        waitForCompletion: true
    });
    assert.equal(imageCalls[1].onStatus, onStatus, 'explicit foreground diagnostics can opt in to progress');
    assert.equal(imageCalls[1].waitForCompletion, true);

    context.location.pathname = '/listing/9';
    window.ShopIntelligenceManager.maybeBootstrap('listing');
    await window.ShopIntelligenceManager.refresh('listing');
    await window.GeminiAuxiliaryService.generateContent({
        body: {
            contents: [{ parts: [{ text: 'Create a compact evidence map for an Etsy assistant.' }] }]
        }
    });
    assert.equal(bootstrapCalls, 1);
    assert.equal(refreshCalls, 1);
    assert.equal(auxiliaryCalls, 1, 'useful non-message shop intelligence is preserved');

    console.log('agent AI budget guard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
