const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/content/gemini_auxiliary_service.js'), 'utf8');
const requestedModels = [];
const context = {
    window: {
        ETSY_AI_GEMINI_FALLBACK_CHAIN: ['model-primary', 'model-secondary']
    },
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Set,
    fetch: async url => {
        const model = url.match(/models\/([^:]+):/)?.[1];
        requestedModels.push(model);
        if (model === 'model-primary') return { ok: false, status: 503 };
        return {
            ok: true,
            status: 200,
            async json() { return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }; }
        };
    }
};
vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const result = await context.window.GeminiAuxiliaryService.generateContent({
        apiKey: 'test-key',
        body: { contents: [] },
        timeoutMs: 100
    });
    assert.equal(result.model, 'model-secondary');
    assert.deepEqual(requestedModels, ['model-primary', 'model-secondary']);
    assert.equal(result.attempts.length, 2);
    console.log('Gemini auxiliary fallback tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
