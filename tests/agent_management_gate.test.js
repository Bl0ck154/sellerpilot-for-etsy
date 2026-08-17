const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/content/agent_management_gate.js'), 'utf8');
let delegated = 0;
let lastSystem = '';
class Service {
    async streamMessage(params) {
        delegated += 1;
        lastSystem = params.systemInstruction;
        const raw = JSON.stringify({ domain: 'memory', action: 'offer', text: 'durable preference', confidence: 0.9 });
        params.onChunk?.(raw, raw);
        params.onComplete?.(raw);
        return raw;
    }
}
const window = { AIServiceFactory: { async getCurrentService() { return new Service(); } } };
window.window = window;
const context = { window, console, JSON, String, Array, Object, RegExp };
vm.createContext(context);
vm.runInContext(source, context);

const management = "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";
const decision = "You classify the Owner's reply to a pending memory confirmation.";
async function invoke(service, systemInstruction, content) {
    let raw = '';
    await service.streamMessage({ systemInstruction, messages: [{ role: 'user', content }], onComplete: value => { raw = value; } });
    return JSON.parse(raw);
}

(async () => {
    const gate = window.EtsyAgentManagementGate;
    const service = await window.AIServiceFactory.getCurrentService('gemini');

    assert.equal((await invoke(service, management, 'Напиши клієнту коротко')).domain, 'none');
    assert.equal(delegated, 0);

    const remember = await invoke(service, management, 'remember this for future: I prefer short replies');
    assert.equal(remember.action, 'add');
    assert.equal(remember.text, 'I prefer short replies');
    assert.equal(delegated, 0, 'simple memory actions stay local');

    assert.equal((await invoke(service, management, 'clear my memory')).action, 'clear');
    assert.equal(gate.isMemoryConfirmationStale(), false);
    assert.equal((await invoke(service, decision, JSON.stringify({ ownerReply: 'yes' }))).decision, 'accept');

    await invoke(service, management, 'clear my memory');
    assert.equal((await invoke(service, decision, JSON.stringify({ ownerReply: 'write the customer a shorter answer' }))).decision, 'unclear');
    assert.equal(gate.isMemoryConfirmationStale(), true);
    assert.equal((await invoke(service, decision, JSON.stringify({ ownerReply: 'yes' }))).decision, 'unclear', 'late yes cannot approve an ignored destructive action');

    await invoke(service, management, 'clear my memory');
    assert.equal(gate.isMemoryConfirmationStale(), false, 'new destructive action rearms confirmation');
    assert.equal((await invoke(service, decision, JSON.stringify({ ownerReply: 'так, видаляй' }))).decision, 'accept');

    const complex = await invoke(service, management, 'update my saved reply template Shipping so it says tomorrow');
    assert.equal(delegated, 1, 'only complex explicit management falls back to a model');
    assert.match(lastSystem, /action=offer is disabled/);
    assert.equal(complex.action, 'none', 'unsolicited offer is hard-disabled');

    await service.streamMessage({ systemInstruction: 'MAIN AGENT POLICY', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(delegated, 2, 'main AI calls are untouched');

    console.log('agent management gate tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
