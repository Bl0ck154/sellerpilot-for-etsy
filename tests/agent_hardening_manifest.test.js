const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('src/manifest.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];
const index = name => scripts.indexOf(name);

assert.equal(manifest.version, '1.6.26');
assert.match(read('build.bat'), /set VERSION=1\.6\.26/);

for (const required of [
    'content/agent_context_manager.js',
    'content/agent_management_gate.js',
    'content/agent_scope_guard.js',
    'content/agent_vision_metadata_guard.js',
    'content/agent_output_guard.js'
]) {
    assert.notEqual(index(required), -1, `${required} must be loaded by the manifest`);
}

assert.ok(index('content/base_ai_service.js') < index('content/agent_context_manager.js'));
assert.ok(index('content/ai_service_factory.js') < index('content/agent_management_gate.js'));
assert.ok(index('content/content.js') < index('content/agent_scope_guard.js'));
assert.ok(index('content/agent_scope_guard.js') < index('content/agent_vision_metadata_guard.js'));
assert.ok(index('content/agent_output_guard.js') < index('content/chat_ui.js'));

const injector = read('src/content/inject_interceptor.js');
assert.match(injector, /function maybeInject\(/);
assert.match(injector, /Install before any later Etsy SPA transition/);
assert.doesNotMatch(
    injector,
    /if \(!window\.location\.pathname\.startsWith\('\/messages'\)\)\s*\{\s*return;\s*\}/,
    'page interceptor must be installed before a later SPA transition into messages'
);

const pageInterceptor = read('src/content/page_interceptor.js');
assert.match(pageInterceptor, /let requestSequence = 0/);
assert.match(pageInterceptor, /const sequence = isDetailRequest \? \+\+requestSequence : 0/);
assert.match(pageInterceptor, /requestSequence: sequence/);
assert.match(pageInterceptor, /requestStartedAt/);

const interceptor = read('src/content/etsy_context_interceptor.js');
assert.match(interceptor, /setupNavigationListeners\(\)/);
assert.match(interceptor, /Install listeners globally/);
assert.match(interceptor, /CURRENT_LISTING_SCOPE/);
assert.match(interceptor, /CONTENT_SESSION_ID/);
assert.match(interceptor, /sourceSequence/);
assert.match(interceptor, /isResponseCurrent\(convoId, sourceSequence\)/);

const linkDiscovery = read('src/content/link_discovery.js');
assert.match(linkDiscovery, /Install lightweight global watchers/);
assert.match(linkDiscovery, /pendingDiscovery/);
assert.match(linkDiscovery, /ETSY_CURRENT_LISTING_SCOPE/);

const visionGuard = read('src/content/agent_vision_metadata_guard.js');
assert.match(visionGuard, /hasHydratedLiveHistory/);
assert.match(visionGuard, /metadataConversationId/);

const outputGuard = read('src/content/agent_output_guard.js');
assert.match(outputGuard, /\['http:', 'https:', 'mailto:'\]/);
assert.match(outputGuard, /isAiMessageTarget/);
assert.match(outputGuard, /noopener noreferrer/);

const baseInstruction = read('src/config/base_instruction.js');
assert.match(baseInstruction, /ACTIVE SCOPE ORIENTATION/);
assert.match(baseInstruction, /Never transfer customer, order, listing, attachment/);
assert.match(baseInstruction, /A summary is an index to evidence/);

console.log('agent hardening manifest/static checks passed');
