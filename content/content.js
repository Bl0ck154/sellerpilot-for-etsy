// content.js - Lazy Context Parsing
// Парсимо контекст ТІЛЬКИ коли потрібно (on-demand), не постійно у фоні

// === CACHE MANAGEMENT ===
let contextCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

let chatManagerInitialized = false;

function invalidateContextCache() {
    contextCache = null;
    cacheTimestamp = 0;
}

// === CORE FUNCTION: Get Context with Cache ===
function getContextWithCache() {
    // 1. Check if extension is alive
    if (!chrome.runtime?.id) {
        console.log('⛔ Extension context invalidated. Cannot extract.');
        return null;
    }

    // 2. Check cache
    const now = Date.now();
    if (contextCache && (now - cacheTimestamp) < CACHE_TTL) {
        return contextCache;
    }

    // 3. Extract fresh context
    const pageData = window.PageParser ? window.PageParser.getFullPageData() : null;

    if (!pageData) {
        console.log('⚠️ PageParser not ready or no content found');
        return null;
    }

    const data = {
        page_content: {
            title: pageData.title,
            markdown: pageData.markdown,
            excerpt: pageData.excerpt,
            siteName: pageData.siteName,
            hasContent: pageData.hasContent
        },
        metadata: pageData.metadata,
        page_url: window.location.href
    };

    // 4. Update cache
    contextCache = data;
    cacheTimestamp = now;

    return data;
}

// === NAVIGATION EVENT LISTENERS (Cache Invalidation) ===
window.addEventListener('popstate', () => {
    invalidateContextCache();
});

window.addEventListener('hashchange', () => {
    invalidateContextCache();
});

// === MESSAGE LISTENERS ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // On-demand context request
    if (request.action === "GET_FRESH_CONTEXT") {
        const context = getContextWithCache();
        sendResponse({ context: context });
        return true; // Keep channel open for async
    }

    // Legacy refresh support (now does the same as GET_FRESH_CONTEXT)
    if (request.action === "refresh_context") {
        const context = getContextWithCache();

        // Also send to background for storage (legacy compatibility)
        if (context) {
            chrome.runtime.sendMessage({
                type: "ETSY_DATA_PARSED",
                payload: context
            }, () => {
                if (chrome.runtime.lastError) {
                    // Ignore - background may not be listening
                }
            });
        }

        sendResponse({ status: "Refreshed", context: context });
        return true;
    }

    // Handle Chat Manager toggle from options page
    if (request.type === "CHAT_MANAGER_TOGGLE") {
        toggleChatManager(request.enabled);
        sendResponse({ status: "Chat Manager toggled" });
    }
});

// === CHAT MANAGER INTEGRATION ===
function toggleChatManager(enabled) {
    if (enabled && !chatManagerInitialized) {
        if (window.EtsyChatManager) {
            window.EtsyChatManager.init();
            chatManagerInitialized = true;
        }
    } else if (!enabled && chatManagerInitialized) {
        if (window.EtsyChatManager) {
            window.EtsyChatManager.cleanup();
            chatManagerInitialized = false;
        }
    }
}

// Initialize Chat Manager on load if enabled
chrome.storage.sync.get(['chatManagerEnabled'], (result) => {
    const isEnabled = result.chatManagerEnabled !== undefined ? result.chatManagerEnabled : true;

    if (isEnabled) {
        // Wait for EtsyChatManager to be available
        const checkAndInit = () => {
            if (window.EtsyChatManager) {
                toggleChatManager(true);
            } else {
                setTimeout(checkAndInit, 100);
            }
        };
        checkAndInit();
    }
});

// === EXPORT FOR CHAT_UI ===
// Export function globally so chat_ui.js can call it directly
window.EtsyAI_GetFreshContext = getContextWithCache;

