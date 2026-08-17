const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('src/manifest.json'));
const config = JSON.parse(read('src/config/etsy_compatibility.json'));
const source = read('src/content/etsy_compatibility.js');
const scripts = manifest.content_scripts?.[0]?.js || [];
const index = file => scripts.indexOf(file);

assert.notEqual(index('content/etsy_compatibility.js'), -1, 'compatibility layer must load');
assert.ok(index('content/inject_interceptor.js') < index('content/etsy_compatibility.js'));
assert.ok(index('content/etsy_compatibility.js') < index('content/quick_reply_ui.js'));
assert.ok(index('content/etsy_compatibility.js') < index('content/chat_manager.js'));

const resources = manifest.web_accessible_resources?.flatMap(entry => entry.resources || []) || [];
assert.ok(resources.includes('config/etsy_compatibility.json'));

assert.equal(config.schemaVersion, 1);
assert.ok(config.selectors.composer.length >= 4, 'composer must have multiple fallback strategies');
assert.ok(config.selectors.messageList.length >= 3, 'message list must have multiple fallback strategies');
assert.ok(config.knownLayouts.some(layout => layout.pageKind === 'conversation'));

assert.match(source, /const REMOTE_CONFIG_URL = 'https:\/\/raw\.githubusercontent\.com\//);
assert.match(source, /function validateConfig\(/);
assert.match(source, /function normalizeDom\(/);
assert.match(source, /etsy-ai-compat-composer/);
assert.match(source, /extractEmbeddedConversation/);
assert.match(source, /extractDomConversation/);
assert.match(source, /const fallback = embedded \|\| extractDomConversation/);
assert.match(source, /function runSelfTest\(/);
assert.match(source, /ETSY_COMPATIBILITY_DIAGNOSTICS/);
assert.match(source, /function getLayoutFingerprint\(/);
assert.match(source, /unknown-layout/);
assert.match(source, /window\.EtsyAdapter = EtsyAdapter/);
assert.match(source, /window\.EtsyCompatibility = EtsyCompatibility/);

console.log('etsy compatibility layer checks passed');
