const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(projectRoot, file), 'utf8');

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function sseResponse(chunks) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
            controller.close();
        }
    }), { headers: { 'content-type': 'text/event-stream' } });
}

function createContext(settings, fetchImpl) {
    const chrome = {
        runtime: { id: 'test-extension' },
        storage: { local: { async get() { return { ...settings }; } } }
    };
    const context = {
        window: { ETSY_AI_BASE_INSTRUCTION: 'BASE' },
        chrome,
        console,
        fetch: fetchImpl,
        Response,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        URL,
        AbortController,
        DOMException,
        setTimeout,
        clearTimeout
    };
    context.window.window = context.window;
    context.window.chrome = chrome;
    vm.createContext(context);
    vm.runInContext(read('src/content/base_ai_service.js'), context);
    vm.runInContext(read('src/content/providers/custom_openai_service.js'), context);
    return context;
}

(async () => {
    const settings = {
        custom_provider_enabled: true,
        custom_base_url: 'https://example.test/v1',
        custom_api_key: 'secret-key',
        custom_model: 'smart-model',
        custom_fallback_provider: 'none'
    };
    let capturedRequest = null;
    const context = createContext(settings, async (url, options) => {
        capturedRequest = { url, options };
        return sseResponse([
            'data: {"choices":[{"delta":{"content":"Hel',
            'lo"}}]}\r\n',
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n'
        ]);
    });
    const service = new context.window.CustomOpenAIService();

    assert.equal(service._chatCompletionsUrl('https://example.test/v1/'), 'https://example.test/v1/chat/completions');
    assert.equal(service._chatCompletionsUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
    assert.throws(() => service._chatCompletionsUrl('http://remote.test/v1'), /HTTPS/);
    assert.throws(() => service._chatCompletionsUrl('https://user:pass@example.test/v1'), /embedded credentials/);
    assert.throws(() => service._chatCompletionsUrl('https://example.test/v1?key=secret'), /query or fragment/);

    let completed = '';
    const streamed = await service.streamMessage({
        modelId: 'smart-model',
        apiKey: null,
        messages: [{ role: 'user', content: 'Hi' }],
        systemInstruction: 'System',
        onComplete: text => { completed = text; }
    });
    assert.equal(streamed, 'Hello world');
    assert.equal(completed, 'Hello world');
    assert.equal(capturedRequest.url, 'https://example.test/v1/chat/completions');
    assert.equal(capturedRequest.options.headers.Authorization, 'Bearer secret-key');
    assert.equal(capturedRequest.options.redirect, 'error');

    const jsonContext = createContext({ ...settings, custom_api_key: '' }, async (_url, options) => {
        assert.equal(options.headers.Authorization, undefined, 'local/keyless endpoints omit Authorization');
        return jsonResponse({ choices: [{ message: { content: 'JSON response' } }] });
    });
    const jsonService = new jsonContext.window.CustomOpenAIService();
    assert.equal(await jsonService.streamMessage({
        modelId: 'smart-model', messages: [], systemInstruction: '', onComplete() { }
    }), 'JSON response');

    let fallbackCalls = 0;
    const fallbackContext = createContext({ ...settings, custom_fallback_provider: 'gemini' }, async () => jsonResponse({ error: { message: 'offline' } }, 503));
    fallbackContext.window.AIServiceFactory = {
        async createService() {
            return {
                async streamMessage(request) {
                    fallbackCalls += 1;
                    request.onChunk?.('Fallback', 'Fallback');
                    await request.onComplete?.('Fallback');
                    return 'Fallback';
                }
            };
        },
        async getModelId() { return 'gemini-flash-latest'; },
        async getApiKey() { return 'gemini-key'; }
    };
    const fallbackService = new fallbackContext.window.CustomOpenAIService();
    assert.equal(await fallbackService.streamMessage({
        modelId: 'smart-model', messages: [], systemInstruction: '', onComplete() { }
    }), 'Fallback');
    assert.equal(fallbackCalls, 1, 'fallback runs when custom fails before producing text');

    let partialFallbackCalls = 0;
    const partialContext = createContext({ ...settings, custom_fallback_provider: 'gemini' }, async () => {
        const encoder = new TextEncoder();
        let step = 0;
        return new Response(new ReadableStream({
            pull(controller) {
                if (step++ === 0) {
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n'));
                } else {
                    controller.error(new Error('stream interrupted'));
                }
            }
        }), { headers: { 'content-type': 'text/event-stream' } });
    });
    partialContext.window.AIServiceFactory = {
        async createService() { partialFallbackCalls += 1; return { streamMessage() { } }; },
        async getModelId() { return 'gemini-flash-latest'; },
        async getApiKey() { return 'gemini-key'; }
    };
    const partialService = new partialContext.window.CustomOpenAIService();
    await assert.rejects(partialService.streamMessage({
        modelId: 'smart-model', messages: [], systemInstruction: '', onChunk() { }, onComplete() { }
    }), /stream interrupted/);
    assert.equal(partialFallbackCalls, 0, 'fallback never mixes a second answer after custom text has streamed');

    const source = read('src/manifest.json');
    assert.match(source, /custom_openai_service\.js/);
    assert.match(source, /optional_host_permissions/);
    assert.doesNotMatch(source, /"http:\/\/\*\/\*"/);
    const optionsHtml = read('src/options/options.html');
    const optionsJs = read('src/options/options.js');
    assert.match(optionsHtml, /id="customProviderEnabled"/);
    assert.match(optionsHtml, /id="customFallbackProvider"/);
    assert.match(optionsHtml, /same request and customer context/);
    assert.match(optionsJs, /chrome\.permissions\.request/);
    assert.match(optionsJs, /custom_provider_enabled/);

    console.log('custom OpenAI service tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
