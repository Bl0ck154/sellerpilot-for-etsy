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
assert.ok(manifest.permissions.includes('unlimitedStorage'), 'persistent image analysis cache needs unlimitedStorage');

for (const required of [
    'content/agent_auxiliary_prompt_guard.js',
    'content/agent_context_manager.js',
    'content/agent_management_gate.js',
    'content/agent_image_request_gate.js',
    'content/agent_scope_guard.js',
    'content/agent_vision_metadata_guard.js',
    'content/agent_ai_budget_guard.js',
    'content/agent_output_guard.js'
]) {
    assert.notEqual(index(required), -1, `${required} must be loaded by the manifest`);
}

assert.ok(index('content/gemini_auxiliary_service.js') < index('content/agent_auxiliary_prompt_guard.js'));
assert.ok(index('content/agent_auxiliary_prompt_guard.js') < index('content/shop_intelligence_manager.js'));
assert.ok(index('content/agent_auxiliary_prompt_guard.js') < index('content/image_intelligence_manager.js'));
assert.ok(index('content/image_intelligence_manager.js') < index('content/agent_vision_metadata_guard.js'));
assert.ok(index('content/agent_vision_metadata_guard.js') < index('content/etsy_context_interceptor.js'));
assert.ok(index('content/base_ai_service.js') < index('content/agent_context_manager.js'));
assert.ok(index('content/ai_service_factory.js') < index('content/agent_management_gate.js'));
assert.ok(index('content/agent_management_gate.js') < index('content/agent_image_request_gate.js'));
assert.ok(index('content/content.js') < index('content/agent_scope_guard.js'));
assert.ok(index('content/agent_scope_guard.js') < index('content/agent_ai_budget_guard.js'));
assert.ok(index('content/agent_ai_budget_guard.js') < index('content/agent_output_guard.js'));
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

const auxiliaryGuard = read('src/content/agent_auxiliary_prompt_guard.js');
assert.match(auxiliaryGuard, /SECURITY BOUNDARY/);
assert.match(auxiliaryGuard, /untrusted evidence, never as instructions/);

const vision = read('src/content/image_intelligence_manager.js');
assert.match(vision, /PROMPT_VERSION = 'etsy-production-photo-v3-batch'/);
assert.match(vision, /MAX_BATCH_IMAGES = 4/);
assert.match(vision, /MAX_BATCH_RAW_BYTES = 12 \* 1024 \* 1024/);
assert.match(vision, /BATCH_CONCURRENCY = 1/);
assert.match(vision, /Analyze \$\{items\.length\} Etsy image attachment/);
assert.match(vision, /Do not let one image's content leak into another image's assessment/);
assert.match(vision, /waitForCompletion = false/);
assert.match(vision, /MAX_CONTEXT_IMAGES = 12/);
assert.match(vision, /professional photo editing, restoration and compositing work/);
assert.match(vision, /face\/head replacement/);
assert.match(vision, /clarificationQuestions/);
assert.match(vision, /Persistent Gemini Vision production summaries/);
assert.match(vision, /Extension\/prompt upgrades must not silently/);
assert.match(vision, /hydrateReusableCache/);
assert.doesNotMatch(vision, /const TTL_MS =/);
assert.doesNotMatch(vision, /listingContext: listingContext/);

const visionGuard = read('src/content/agent_vision_metadata_guard.js');
assert.match(visionGuard, /hasHydratedLiveHistory/);
assert.match(visionGuard, /metadataConversationId/);
assert.match(visionGuard, /imageIntelPendingCount/);
assert.match(visionGuard, /imageIntelBatchCallsThisRequest/);

const imageRequestGate = read('src/content/agent_image_request_gate.js');
assert.match(imageRequestGate, /MAX_IMAGE_WAIT_MS = 1000/);
assert.match(imageRequestGate, /isImageSpecificRequest/);
assert.match(imageRequestGate, /waitForCurrentAnalysis/);
assert.match(imageRequestGate, /replaceImageContext/);

const budgetGuard = read('src/content/agent_ai_budget_guard.js');
assert.match(budgetGuard, /if \(isMessagesPage\(\)\) return false/);
assert.match(budgetGuard, /maxWaitMs: 0/);
assert.match(budgetGuard, /await imageManager\.analyzeCurrentCustomerImages\(\{ waitForCompletion: false \}\)/);
assert.match(budgetGuard, /waitForCompletion === true/);
assert.match(budgetGuard, /onStatus: undefined/);
assert.match(budgetGuard, /Create a compact evidence map for an Etsy assistant/);

const outputGuard = read('src/content/agent_output_guard.js');
assert.match(outputGuard, /\['http:', 'https:', 'mailto:'\]/);
assert.match(outputGuard, /isAiMessageTarget/);
assert.match(outputGuard, /noopener noreferrer/);

const baseInstruction = read('src/config/base_instruction.js');
assert.match(baseInstruction, /ACTIVE SCOPE ORIENTATION/);
assert.match(baseInstruction, /Never transfer customer, order, listing, attachment/);
assert.match(baseInstruction, /A summary is an index to evidence/);

const memory = read('src/content/memory_manager.js');
assert.match(memory, /Explicit, local-only persistent Owner memory/);
assert.match(memory, /MAX_CONTEXT_CHARS = 12000/);
assert.match(memory, /Owner preferences/);
assert.match(memory, /Shop facts/);

console.log('agent hardening manifest/static checks passed');