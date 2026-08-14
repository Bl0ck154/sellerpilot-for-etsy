const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const storage = {};
const chrome = {
    runtime: { id: 'test-extension' },
    storage: {
        local: {
            async get(keys) {
                const result = {};
                for (const key of keys) if (Object.hasOwn(storage, key)) result[key] = storage[key];
                return result;
            },
            async set(values) {
                Object.assign(storage, structuredClone(values));
            }
        }
    }
};

const context = { window: {}, chrome, console, Date, Math, Set, String, Object, Array };
context.window.chrome = chrome;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'src/content/memory_manager.js'), 'utf8'), context);

(async () => {
    const manager = context.window.MemoryManager;
    const first = await manager.addSmart('The shop usually answers within two business days.');
    const second = await manager.addSmart('The shop does not guarantee replies within two business days.');

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, false);
    assert.equal(second.replaced.length, 0, 'storage never deletes a fact based on token overlap or negation');
    assert.equal((await manager.list()).length, 2);
    assert.equal(manager.findPotentialConflicts, undefined, 'the old lexical conflict heuristic is not exposed');

    const unsafeFuzzyRemoval = await manager.removeByKeyword('business guarantee');
    assert.equal(unsafeFuzzyRemoval.removed, 0, 'unrelated overlapping words cannot silently delete memory');

    const exactRemoval = await manager.removeByKeyword('does not guarantee replies within two business days');
    assert.equal(exactRemoval.removed, 1, 'a clear contained reference can remove the intended entry');
    assert.equal((await manager.list()).length, 1);

    console.log('memory manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
