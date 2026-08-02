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
            async get() { return {}; },
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
    fetch: async () => ({ json: async () => ({ version: 'test' }) })
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

    console.log('background options tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
