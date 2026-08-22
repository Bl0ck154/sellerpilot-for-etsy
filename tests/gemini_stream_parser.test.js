const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BaseAIService {}

const sse = [
    'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":"sig"},{"text":"No worries! "}]}}]}\r\n\r\n',
    'data:{"candidates":[{"content":{"parts":[{"thought":true,"text":"internal thought"},{"text":"I can provide your picture "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"in both sizes."}]}}]}'
].join('');

const bytes = new TextEncoder().encode(sse);
const chunks = [
    bytes.slice(0, 17),
    bytes.slice(17, 73),
    bytes.slice(73, 151),
    bytes.slice(151)
];
let readIndex = 0;

const fetch = async () => ({
    ok: true,
    body: {
        getReader() {
            return {
                async read() {
                    if (readIndex >= chunks.length) return { done: true, value: undefined };
                    return { done: false, value: chunks[readIndex++] };
                }
            };
        }
    }
});

const window = {};
const chrome = { runtime: { id: 'test-extension' } };
const context = {
    window,
    chrome,
    BaseAIService,
    fetch,
    AbortController,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    console
};
window.window = window;
window.chrome = chrome;

vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'providers', 'gemini_service.js'), 'utf8'),
    context
);

(async () => {
    const service = new window.GeminiService();
    const chunksSeen = [];
    let completedText = null;

    const result = await service._streamMessageInternal({
        modelId: 'gemini-test',
        apiKey: 'test-key',
        messages: [],
        systemInstruction: 'test',
        thinkingMode: null,
        timeoutMs: 1000,
        onChunk(chunk) {
            chunksSeen.push(chunk);
        },
        onComplete(text) {
            completedText = text;
        }
    });

    const expected = 'No worries! I can provide your picture in both sizes.';
    assert.equal(result, expected, 'all visible text parts are preserved in order');
    assert.equal(completedText, expected, 'completion receives the same full response');
    assert.equal(chunksSeen.join(''), expected, 'chunk callbacks do not lose the answer prefix');
    assert.doesNotMatch(result, /internal thought/, 'thought parts are never exposed as answer text');

    console.log('gemini stream parser tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
