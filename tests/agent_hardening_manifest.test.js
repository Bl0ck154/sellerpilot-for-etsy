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
assert.ok(manifest.permissions.includes('unlimitedStorage'));

for (const required of [
    'content/scoped_conversation_store.js',
    'content/agent_auxiliary_prompt_guard.js',
    'content/agent_context_manager.js',
    'content/agent_scoped_context_bridge.js',
    'content/agent_management_gate.js',
    'content/agent_image_request_gate.js',
    'content/agent_scope_guard.js',
    'content/agent_vision_metadata_guard.js',
    'content/agent_ai_budget_guard.js',
    'content/agent_output_guard.js'
]) {
    assert.notEqual(index(required), -1, `${required} must be loaded`);
}

assert.ok(index('content/page_parser.js') < index('content/scoped_conversation_store.js'));
assert.ok(index('content/scoped_conversation_store.js') < index('content/image_intelligence_manager.js'));
assert.ok(index('content/scoped_conversation_store.js') < index('content/etsy_context_interceptor.js'));
assert.ok(index('content/base_ai_service.js') < index('content/agent_scoped_context_bridge.js'));
assert.ok(index('content/agent_scoped_context_bridge.js') < index('content/agent_context_manager.js'));
assert.ok(index('content/ai_service_factory.js') < index('content/agent_management_gate.js'));
assert.ok(index('content/agent_management_gate.js') < index('content/agent_image_request_gate.js'));
assert.ok(index('content/content.js') < index('content/agent_scope_guard.js'));
assert.ok(index('content/agent_scope_guard.js') < index('content/agent_ai_budget_guard.js'));
assert.ok(index('content/agent_output_guard.js') < index('content/chat_ui.js'));

const scopedStore = read('src/content/scoped_conversation_store.js');
assert.match(scopedStore, /ETSY_AI_CONVO_SCOPE_/);
assert.match(scopedStore, /getHistory/);
assert.match(scopedStore, /setListing/);
assert.match(scopedStore, /setFacts/);
assert.match(scopedStore, /compatibility mirror/i);

const bridge = read('src/content/agent_scoped_context_bridge.js');
assert.match(bridge, /getChatHistoryContext/);
assert.match(bridge, /getRAGContext/);
assert.match(bridge, /ScopedConversationStore/);
assert.match(bridge, /waitForHistory/);

const injector = read('src/content/inject_interceptor.js');
assert.match(injector, /function maybeInject\(/);
assert.match(injector, /Install before any later Etsy SPA transition/);

const pageInterceptor = read('src/content/page_interceptor.js');
assert.match(pageInterceptor, /let requestSequence = 0/);
assert.match(pageInterceptor, /requestSequence: sequence/);
assert.match(pageInterceptor, /requestStartedAt/);

const interceptor = read('src/content/etsy_context_interceptor.js');
assert.match(interceptor, /multi-tab/i);
assert.match(interceptor, /mergeAttachments/);
assert.match(interceptor, /cleanupQueue/);
assert.match(interceptor, /sourceSessionId/);
assert.match(interceptor, /sourceSequence/);
assert.match(interceptor, /scheduleBackgroundAnalysis/);
assert.match(interceptor, /if\(store\)return true/);
assert.match(interceptor, /setHistory/);
assert.match(interceptor, /setListing/);

const vision = read('src/content/image_intelligence_manager.js');
assert.match(vision, /ENTRY_PREFIX='ETSY_AI_IMAGE_INTELLIGENCE_ENTRY_'/);
assert.match(vision, /PROMPT_VERSION='etsy-production-photo-v3-batch'/);
assert.match(vision, /MAX_BATCH_IMAGES=4/);
assert.match(vision, /MAX_BATCH_RAW_BYTES=12\*1024\*1024/);
assert.match(vision, /0xcbf29ce484222325n/);
assert.match(vision, /conversation:\$\{convo\}\|attachment:/);
assert.match(vision, /sessionEntries=new Map/);
assert.match(vision, /DIRECT_GEMINI_MIME/);
assert.match(vision, /rasterize/);
assert.match(vision, /Do not let one image's content leak/);
assert.match(vision, /waitForCompletion=false/);
assert.match(vision, /await analyzeSource\(source,\{waitForCompletion:false\}\)/);
assert.match(vision, /ScopedConversationStore/);
assert.doesNotMatch(vision, /const TTL_MS/);
assert.doesNotMatch(vision, /slice\(0,\s*300\)/);

const contextManager = read('src/content/agent_context_manager.js');
assert.match(contextManager, /ScopedConversationStore/);
assert.match(contextManager, /readFacts/);
assert.match(contextManager, /readListingId/);
assert.match(contextManager, /Vision cache:/);

const summaryManager = read('src/content/conversation_context_manager.js');
assert.match(summaryManager, /0xcbf29ce484222325n/);
assert.match(summaryManager, /const latest=await get\(\[CACHE_KEY\]\)/);
assert.match(summaryManager, /merged\[key\.convoId\]/);

const scopeGuard = read('src/content/agent_scope_guard.js');
assert.match(scopeGuard, /without cross-tab destructive cleanup/i);
assert.match(scopeGuard, /ScopedConversationStore/);
assert.match(scopeGuard, /clearStaleScopedState:async\(\)=>true/);

const managementGuard = read('src/content/agent_management_gate.js');
assert.match(managementGuard, /memoryConfirmationStale/);
assert.match(managementGuard, /MEMORY_DECISION_PROMPT_MARKER/);

const budgetGuard = read('src/content/agent_ai_budget_guard.js');
assert.match(budgetGuard, /maxWaitMs:0/);
assert.match(budgetGuard, /onStatus:undefined/);
assert.match(budgetGuard, /Do not pre-call analyze here/);

const privacy = read('PRIVACY_POLICY.md');
assert.match(privacy, /do not use an automatic time-to-live/i);
assert.match(privacy, /Multiple new images.*one multimodal request/i);
assert.match(privacy, /Raw image bytes are \*\*not\*\* stored/i);

console.log('agent hardening manifest/static checks passed');
