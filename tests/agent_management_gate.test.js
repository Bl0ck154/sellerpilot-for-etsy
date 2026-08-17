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

const managementPrompt = "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";
const decisionPrompt = "You classify the Owner's reply to a pending memory confirmation.";

(async () => {
    const gate = window.EtsyAgentManagementGate;
    assert.equal(gate.looksLikeExplicitManagement('Напиши клієнту що все готово'), false);
    assert.equal(gate.looksLikeExplicitManagement('запамʼятай що я не даю знижки'), true);
    assert.equal(gate.looksLikeExplicitManagement('Remember I prefer short replies'), true);
    assert.equal(gate.looksLikeExplicitManagement('Could you remember that I ship on Mondays?'), true);
    assert.equal(gate.looksLikeExplicitManagement('Remember what the customer said?'), false);
    assert.equal(gate.looksLikeExplicitManagement('Do you remember what the customer said?'), false);
    assert.equal(gate.looksLikeExplicitManagement('delete my saved quick reply Thanks'), true);
    assert.equal(gate.looksLikeExplicitManagement('памʼятаєш що клієнт казав?'), false);

    const remember = JSON.parse(gate.deterministicManagementIntent('remember this for future: I prefer short replies'));
    assert.equal(remember.domain, 'memory');
    assert.equal(remember.action, 'add');
    assert.equal(remember.text, 'I prefer short replies');
    assert.equal(JSON.parse(gate.deterministicManagementIntent("очисти всю пам'ять")).action, 'clear');
    assert.equal(JSON.parse(gate.deterministicManagementIntent('forget old discount policy')).keyword, 'old discount policy');
    assert.equal(JSON.parse(gate.deterministicManagementIntent('show my quick replies')).action, 'list');

    assert.equal(
        JSON.parse(gate.deterministicMemoryDecision(JSON.stringify({ ownerReply: 'так, видаляй' }))).decision,
        'accept'
    );
    assert.equal(
        JSON.parse(gate.deterministicMemoryDecision(JSON.stringify({ ownerReply: 'не треба' }))).decision,
        'reject'
    );

    const service = await window.AIServiceFactory.getCurrentService('gemini');
    let ordinaryRaw = '';
    await service.streamMessage({
        systemInstruction: managementPrompt,
        messages: [{ role: 'user', content: 'Напиши клієнту коротку відповідь' }],
        onComplete: value => { ordinaryRaw = value; }
    });
    assert.equal(delegatedCalls, 0, 'ordinary messages skip the remote management classifier');
    assert.equal(JSON.parse(ordinaryRaw).domain, 'none');

    let explicitRaw = '';
    await service.streamMessage({
        systemInstruction: managementPrompt,
        messages: [{ role: 'user', content: 'remember this for future: I prefer short replies' }],
        onComplete: value => { explicitRaw = value; }
    });
    assert.equal(delegatedCalls, 0, 'simple explicit memory commands are handled locally');
    assert.equal(JSON.parse(explicitRaw).action, 'add');

    let decisionRaw = '';
    await service.streamMessage({
        systemInstruction: decisionPrompt,
        messages: [{ role: 'user', content: JSON.stringify({ ownerReply: 'yes' }) }],
        onComplete: value => { decisionRaw = value; }
    });
    assert.equal(delegatedCalls, 0, 'memory yes/no confirmation is local-only');
    assert.equal(JSON.parse(decisionRaw).decision, 'accept');

    let complexRaw = '';
    await service.streamMessage({
        systemInstruction: managementPrompt,
        messages: [{ role: 'user', content: 'update my saved reply template called Shipping so it says tomorrow' }],
        onComplete: value => { complexRaw = value; }
    });
    assert.equal(delegatedCalls, 1, 'only complex explicit management wording reaches a model');
    assert.match(lastDelegatedInstruction, /action=offer is disabled/);
    assert.equal(JSON.parse(complexRaw).action, 'none', 'unsolicited offer output is hard-normalized to none');

    await service.streamMessage({
        systemInstruction: 'MAIN AGENT POLICY',
        messages: [{ role: 'user', content: 'hello' }]
    });
    assert.equal(delegatedCalls, 2, 'normal main-agent calls are not altered');

    console.log('agent management gate tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
