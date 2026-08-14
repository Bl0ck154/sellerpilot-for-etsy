const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let messageListener = null;
let optionsOpenCount = 0;
let createdTab = null;
let updatedTab = null;
let focusedWindow = null;
let availableTabs = [];
let queryError = null;
let connectListener = null;
let customSettings = {};
let fetchImpl = async () => ({ json: async () => ({ version: 'test' }) });

const chrome = {
    alarms: {
        create() { },
        onAlarm: { addListener() { } }
    },
    runtime: {
        getManifest: () => ({ version: 'test' }),
        getURL: value => `chrome-extension://test/${value}`,
        reload() { },
        openOptionsPage: async () => { optionsOpenCount += 1; },
        onMessage: {
            addListener(listener) { messageListener = listener; }
        },
        onConnect: {
            addListener(listener) { connectListener = listener; }
        },
        sendMessage: async () => ({ success: true }),
        getContexts: async () => []
    },
    tabs: {
        query: async () => {
            if (queryError) throw queryError;
            return availableTabs;
        },
        sendMessage: async () => ({}),
        create: async options => { createdTab = options; },
        update: async (tabId, options) => { updatedTab = { tabId, options }; }
    },
    windows: {
        update: async (windowId, options) => { focusedWindow = { windowId, options }; }
    },
    storage: {
        local: {
            async get() { return { ...customSettings }; },
            async set() { },
            async remove() { }
        }
    },
    downloads: { download() { } },
    offscreen: { createDocument: async () => { } }
};

const context = {
    chrome,
    console,
    Date,
    Object,
    Promise,
    setTimeout,
    clearTimeout,
    btoa: value => Buffer.from(value).toString('base64'),
    fetch: (...args) => fetchImpl(...args),
    URL,
    Response,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    AbortController,
    DOMException
};
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'background', 'service_worker.js'), 'utf8'),
    context
);

(async () => {
    assert.equal(typeof messageListener, 'function', 'background message listener is registered');

    async function openOptions() {
        let response = null;
        const keepChannelOpen = messageListener(
            { type: 'OPEN_OPTIONS_PAGE' },
            {},
            value => { response = value; }
        );
        assert.equal(keepChannelOpen, true, 'async response channel stays open');
        await new Promise(resolve => setTimeout(resolve, 0));
        return response;
    }

    let response = await openOptions();
    assert.equal(optionsOpenCount, 0, 'default options fallback is not used');
    assert.match(createdTab?.url || '', /options\/options\.html#quick-replies$/);
    assert.equal(createdTab?.active, true);
    assert.equal(response?.success, true);

    createdTab = null;
    availableTabs = [{
        id: 42,
        windowId: 7,
        url: 'chrome-extension://test/options/options.html'
    }];
    response = await openOptions();
    assert.equal(createdTab, null, 'an existing settings tab is reused');
    assert.equal(updatedTab?.tabId, 42);
    assert.match(updatedTab?.options?.url || '', /options\/options\.html#quick-replies$/);
    assert.equal(updatedTab?.options?.active, true);
    assert.equal(focusedWindow?.windowId, 7, 'the existing settings window is focused');
    assert.equal(focusedWindow?.options?.focused, true);
    assert.equal(response?.success, true);

    queryError = new Error('tabs unavailable');
    response = await openOptions();
    assert.equal(optionsOpenCount, 1, 'default options page is used when tab APIs fail');
    assert.equal(response?.success, true);

    assert.equal(typeof connectListener, 'function', 'custom provider stream listener is registered');
    customSettings = {
        custom_provider_enabled: true,
        custom_base_url: 'https://provider.test/v1',
        custom_api_key: 'background-secret',
        custom_model: 'custom-model'
    };
    let capturedFetch = null;
    fetchImpl = async (url, options) => {
        capturedFetch = { url, options };
        return new Response('data: {"choices":[{"delta":{"content":"Background stream"}}]}\n\ndata: [DONE]\n', {
            headers: { 'content-type': 'text/event-stream' }
        });
    };

    const inboundListeners = [];
    const disconnectListeners = [];
    const outbound = [];
    const port = {
        name: 'custom-ai-stream',
        sender: { tab: { url: 'https://www.etsy.com/messages/123' } },
        onMessage: { addListener(listener) { inboundListeners.push(listener); } },
        onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
        postMessage(message) { outbound.push(message); },
        disconnect() { disconnectListeners.forEach(listener => listener()); }
    };
    connectListener(port);
    inboundListeners[0]({ type: 'start', modelId: 'custom-model', messages: [{ role: 'user', content: 'Hi' }], systemInstruction: 'System' });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(capturedFetch.url, 'https://provider.test/v1/chat/completions');
    assert.equal(capturedFetch.options.headers.Authorization, 'Bearer background-secret');
    assert.equal(capturedFetch.options.redirect, 'error');
    assert.equal(outbound.find(message => message.type === 'complete')?.fullText, 'Background stream');

    console.log('background options tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
