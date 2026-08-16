const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/content/agent_vision_metadata_guard.js'), 'utf8');
const storage = {};
let rawAnalyzeCalls = 0;
const listeners = {};

const location = { pathname: '/messages/200' };
const window = {
    ImageIntelligenceManager: {
        async analyzeCurrentCustomerImages() {
            rawAnalyzeCalls += 1;
            return { imageIntelCount: 3, imageIntelErrors: [] };
        },
        getMetadata() {
            return { imageIntelCount: 3, imageIntelErrors: [] };
        }
    },
    EtsyAgentScopeGuard: {
        historyMatchesLive(history) {
            return String(history?.convo_id || '') === String(location.pathname.match(/\/messages\/(\d+)/)?.[1] || '');
        }
    },
    addEventListener(type, handler) {
        listeners[type] = handler;
    }
};
const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                const result = {};
                for (const key of keys) {
                    if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = storage[key];
                }
                return result;
            }
        }
    }
};
const context = { window, chrome, location, console, String, Object, Array };
window.window = window;
window.chrome = chrome;
window.location = location;

vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    let result = await window.ImageIntelligenceManager.analyzeCurrentCustomerImages();
    assert.equal(result.imageIntelCount, 0, 'vision must not run before live chat history is hydrated');
    assert.equal(rawAnalyzeCalls, 0);
    assert.equal(window.ImageIntelligenceManager.getMetadata().imageIntelCount, 0);

    storage.ETSY_CHAT_HISTORY = { convo_id: '200', messages: [] };
    result = await window.ImageIntelligenceManager.analyzeCurrentCustomerImages();
    assert.equal(result.imageIntelCount, 3);
    assert.equal(rawAnalyzeCalls, 1);
    assert.equal(window.ImageIntelligenceManager.getMetadata().imageIntelCount, 3);

    location.pathname = '/messages/201';
    listeners['etsy-ai-locationchange']?.();
    assert.equal(window.ImageIntelligenceManager.getMetadata().imageIntelCount, 0, 'metadata is invalidated immediately on SPA conversation change');

    result = await window.ImageIntelligenceManager.analyzeCurrentCustomerImages();
    assert.equal(result.imageIntelCount, 0, 'old history must not authorize vision for the new conversation');
    assert.equal(rawAnalyzeCalls, 1);

    console.log('agent vision metadata guard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
