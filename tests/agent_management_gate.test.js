const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'src/content/agent_management_gate.js'), 'utf8');

let delegatedCalls = 0;
let lastDelegatedInstruction = '';
class FakeService {
    async streamMessage(params) {
        delegatedCalls += 1;
        lastDelegatedInstruction = params.systemInstruction;
        const raw = JSON.stringify({
            domain: 'memory',
            action: 'offer',
            text: 'durable preference',
            confidence: 0.9
        });
        params.onChunk?.(raw, raw);
        params.onComplete?.(raw);
        return raw;
    }
}

const window = {
    AIServiceFactory: {
        async getCurrentService() { return new FakeService(); }
    }
};
const context = { window, console, JSON, String, Array, Object, RegExp };
window.window = window;

vm.createContext(context);
vm.runInContext(source, context);

const prompt = "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";

(async () => {
    assert.equal(window.EtsyAgentManagementGate.looksLikeExplicitManagement('Напиши клієнту що все готово'), false);
    assert.equal(window.EtsyAgentManagementGate.looksLikeExplicitManagement('запамʼятай що я не даю знижки'), true);
    assert.equal(window.EtsyAgentManagementGate.looksLikeExplicitManagement('delete my saved quick reply Thanks'), true);
    assert.equal(window.EtsyAgentManagementGate.looksLikeExplicitManagement('памʼятаєш що клієнт казав?'), false);

    const ordinary = await window.AIServiceFactory.getCurrentService('gemini');
    let ordinaryRaw = '';
    await ordinary.streamMessage({
        systemInstruction: prompt,
        messages: [{ role: 'user', content: 'Напиши клієнту коротку відповідь' }],
        onComplete: value => { ordinaryRaw = value; }
    });
    assert.equal(delegatedCalls, 0, 'ordinary messages skip the remote management classifier');
    assert.equal(JSON.parse(ordinaryRaw).domain, 'none');

    const explicit = await window.AIServiceFactory.getCurrentService('gemini');
    let explicitRaw = '';
    await explicit.streamMessage({
        systemInstruction: prompt,
        messages: [{ role: 'user', content: 'remember this for future: I prefer short replies' }],
        onComplete: value => { explicitRaw = value; }
    });
    assert.equal(delegatedCalls, 1, 'explicit management requests still use semantic classification');
    assert.match(lastDelegatedInstruction, /action=offer is disabled/);
    assert.equal(JSON.parse(explicitRaw).action, 'none', 'unsolicited offer output is hard-normalized to none');

    // The gate must not alter normal main-agent calls.
    const main = await window.AIServiceFactory.getCurrentService('gemini');
    await main.streamMessage({
        systemInstruction: 'MAIN AGENT POLICY',
        messages: [{ role: 'user', content: 'hello' }]
    });
    assert.equal(delegatedCalls, 2);

    console.log('agent management gate tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
