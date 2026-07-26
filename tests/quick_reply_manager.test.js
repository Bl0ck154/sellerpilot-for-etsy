const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = {};
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
            },
            async set(values) {
                Object.assign(storage, structuredClone(values));
            }
        }
    }
};

const context = {
    window: {},
    chrome,
    console,
    Date,
    Math,
    Set,
    String,
    Object,
    Array
};
vm.createContext(context);
const managerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content', 'quick_reply_manager.js'),
    'utf8'
);
vm.runInContext(managerSource, context);

const manager = context.window.QuickReplyManager;

(async () => {
    const defaults = await manager.list();
    assert.equal(defaults.length, 3, 'initializes starter replies once');
    assert.equal(defaults[0].label, 'Thanks');

    const added = await manager.add('Shipping', 'Your order is on its way.');
    assert.equal(added.entry.label, 'Shipping');
    assert.equal((await manager.list()).length, 4);

    const duplicate = await manager.add(' shipping ', 'Different text');
    assert.equal(duplicate.duplicate, true, 'labels are deduplicated case-insensitively');

    const updated = await manager.updateByQuery('Shipping', {
        label: 'Dispatch update',
        text: 'Your order has been dispatched.'
    });
    assert.equal(updated.updated, true);
    assert.equal(updated.result.entry.label, 'Dispatch update');

    const matches = await manager.find('dispatch');
    assert.equal(matches[0].id, updated.result.entry.id);

    const removed = await manager.removeByQuery('Dispatch update');
    assert.equal(removed.removed.id, updated.result.entry.id);

    await manager.clear();
    assert.deepEqual(await manager.list(), [], 'clear remains empty and does not reseed defaults');

    console.log('quick_reply_manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
