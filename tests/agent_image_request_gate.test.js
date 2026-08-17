const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/content/agent_image_request_gate.js'), 'utf8');
let delegated = [];
let waitCalls = 0;
let contextCalls = 0;
class FakeService {
    async streamMessage(params) {
        delegated.push(params);
        return 'ok';
    }
}
const window = {
    AIServiceFactory: {
        async getCurrentService() { return new FakeService(); }
    },
    ImageIntelligenceManager: {
        async waitForCurrentAnalysis(ms) {
            waitCalls += 1;
            assert.equal(ms, 1000);
        },
        async buildContextSection() {
            contextCalls += 1;
            return '\n\n### CUSTOMER_IMAGE_CONTEXT\nVision coverage: 1/1\n- fresh cached image';
        }
    }
};
const context = { window, console, String, Array, Math };
window.window = window;
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const gate = window.EtsyAgentImageRequestGate;
    assert.equal(gate.isImageSpecificRequest('Напиши клієнту що все готово'), false);
    assert.equal(gate.isImageSpecificRequest('Подивись на фото і скажи чи якість нормальна'), true);
    assert.equal(gate.isImageSpecificRequest('Can this image be used for a face replacement?'), true);

    const replaced = gate.replaceImageContext(
        'BASE\n\n### CUSTOMER_IMAGE_CONTEXT\nold pending data\n\nNow I am on the page:\n- URL: x\n\n[PAGE_SCOPE: messages | convo_id=1]',
        '\n\n### CUSTOMER_IMAGE_CONTEXT\nfresh'
    );
    assert.doesNotMatch(replaced, /old pending data/);
    assert.match(replaced, /fresh/);
    assert.equal((replaced.match(/CUSTOMER_IMAGE_CONTEXT/g) || []).length, 1);

    const service = await window.AIServiceFactory.getCurrentService('gemini');
    await service.streamMessage({
        systemInstruction: 'BASE\n\n[PAGE_SCOPE: messages | convo_id=1]',
        messages: [{ role: 'user', content: 'Just draft a reply' }]
    });
    assert.equal(waitCalls, 0, 'normal chat never waits for Vision');

    await service.streamMessage({
        systemInstruction: 'BASE\n\n### CUSTOMER_IMAGE_CONTEXT\npending\n\n[PAGE_SCOPE: messages | convo_id=1]',
        messages: [{ role: 'user', content: 'Оціни це фото для реставрації' }]
    });
    assert.equal(waitCalls, 1, 'explicit photo question gets one bounded wait');
    assert.equal(contextCalls, 1);
    assert.match(delegated.at(-1).systemInstruction, /fresh cached image/);
    assert.doesNotMatch(delegated.at(-1).systemInstruction, /pending/);

    console.log('agent image request gate tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
