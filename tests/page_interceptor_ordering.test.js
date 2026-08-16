const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/content/page_interceptor.js'), 'utf8');
const pending = [];
const posted = [];

function responseFor(label) {
    return {
        clone() {
            return {
                async json() {
                    return { detail: { conversation_id: '123', label } };
                }
            };
        }
    };
}

const window = {
    location: { pathname: '/messages/123' },
    fetch(url) {
        return new Promise(resolve => pending.push({ url, resolve }));
    },
    postMessage(payload) {
        posted.push(payload);
    }
};
const context = { window, console, Date };
window.window = window;

vm.createContext(context);
vm.runInContext(source, context);

(async () => {
    const oldRequest = window.fetch('https://www.etsy.com/conversations/detail-view-data?request=old');
    const newRequest = window.fetch('https://www.etsy.com/conversations/detail-view-data?request=new');

    assert.equal(pending.length, 2);
    pending[1].resolve(responseFor('new'));
    await newRequest;
    pending[0].resolve(responseFor('old'));
    await oldRequest;

    assert.equal(posted.length, 2);
    assert.equal(posted[0].data.detail.label, 'new');
    assert.equal(posted[0].requestSequence, 2, 'newer-started request keeps the larger sequence even when it finishes first');
    assert.equal(posted[1].data.detail.label, 'old');
    assert.equal(posted[1].requestSequence, 1, 'older slow request keeps its original lower sequence when it finishes later');
    assert.ok(posted[0].requestStartedAt > 0);
    assert.ok(posted[1].requestStartedAt > 0);

    console.log('page interceptor ordering tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
