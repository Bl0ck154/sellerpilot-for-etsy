const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const guard = fs.readFileSync(path.join(root, 'src/content/chat_submission_guard.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));

const scripts = manifest.content_scripts?.[0]?.js || [];
const chatUiIndex = scripts.indexOf('content/chat_ui.js');
const guardIndex = scripts.indexOf('content/chat_submission_guard.js');

assert.notEqual(chatUiIndex, -1, 'chat_ui.js must stay registered');
assert.notEqual(guardIndex, -1, 'chat submission guard must be registered');
assert.ok(guardIndex > chatUiIndex, 'guard must load after chat_ui.js');

assert.match(guard, /document\.addEventListener\('keydown',[\s\S]*?, true\);/);
assert.match(guard, /document\.addEventListener\('click',[\s\S]*?, true\);/);
assert.match(guard, /data-etsy-ai-optimistic/);
assert.match(guard, /messageEl\.remove\(\);/);
assert.match(guard, /split\(\/\\n\\s\*\\nTechnical:/);
assert.match(guard, /etsy-ai-status-text/);
assert.match(guard, /OPTIMISTIC_TTL_MS/);

console.log('chat submission guard tests passed');
