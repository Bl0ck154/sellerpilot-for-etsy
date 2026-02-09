// Browser detection utility
// Firefox supports both 'browser' and 'chrome' namespaces
// Chrome only supports 'chrome' namespace

var isFirefox = typeof browser !== 'undefined' && typeof InstallTrigger !== 'undefined';
var isChrome = typeof chrome !== 'undefined' && !isFirefox;

// For Firefox, prefer 'browser' API, but fallback to 'chrome' if needed
var browserAPI = isFirefox && typeof browser !== 'undefined' ? browser : chrome;

// Check if offscreen API is available (Chrome-only feature)
var hasOffscreenAPI = typeof chrome !== 'undefined' && typeof chrome.offscreen !== 'undefined';

console.log('Browser detected: ' + (isFirefox ? 'Firefox' : isChrome ? 'Chrome' : 'Unknown'));
if (!hasOffscreenAPI) {
    console.log('Offscreen API not available - RAG parsing will use fallback method');
}
