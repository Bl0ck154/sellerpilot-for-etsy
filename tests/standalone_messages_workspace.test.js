const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const userscript = read('userscripts/etsy-messages-workspace.user.js');
const readme = read('README.md');
const userscriptReadme = read('userscripts/README.md');

assert.match(userscript, /==UserScript==/);
assert.match(userscript, /@match\s+https:\/\/www\.etsy\.com\/messages/);
assert.match(userscript, /@grant\s+none/);
assert.match(userscript, /sp-workspace/);
assert.match(userscript, /createResizer/);
assert.match(userscript, /DRAFT_PREFIX/);
assert.match(userscript, /Attached files/);
assert.match(userscript, /conversations\/detail-view-data/);
assert.match(userscript, /mission-control\/orders\/convos/);
assert.match(userscript, /if \(!composer \|\| !grid \|\| !center\)/, 'unknown layouts must degrade without applying the workspace');
assert.doesNotMatch(userscript, /chrome\.runtime|chrome\.storage/, 'standalone userscript must not require extension APIs');
assert.doesNotMatch(userscript, /Gemini|OpenRouter|DeepSeek|Grok/, 'standalone userscript must not include AI-provider integration');

assert.match(readme, /Better Etsy Messages workspace/);
assert.match(readme, /userscripts\/etsy-messages-workspace\.user\.js/);
assert.match(userscriptReadme, /layout and workflow improvements without the AI assistant/i);
assert.match(userscriptReadme, /localStorage/);

console.log('standalone Messages workspace checks passed');
