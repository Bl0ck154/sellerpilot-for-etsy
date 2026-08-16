// content.js - Lazy page-context parsing with SPA-safe cache invalidation.
let contextCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000;
let chatManagerInitialized = false;

function invalidateContextCache() {
    contextCache = null;
    cacheTimestamp = 0;
}

function contextMatchesCurrentUrl(context) {
    if (!context) return false;
    const url = context.metadata?.url || context.page_url || '';
    if (!url) return false;
    try {
        return new URL(url, location.href).pathname === location.pathname;
    } catch (_) {
        return false;
    }
}

function getContextWithCache() {
    if (!chrome.runtime?.id) {
        console.log('⛔ Extension context invalidated. Cannot extract.');
        return null;
    }

    const now = Date.now();
    if (contextCache &&
        now - cacheTimestamp < CACHE_TTL &&
        contextMatchesCurrentUrl(contextCache)) {
        return contextCache;
    }

    // A URL change invalidates the cache even if Etsy changed it through pushState and
    // the explicit navigation event was delayed/missed.
    if (contextCache && !contextMatchesCurrentUrl(contextCache)) invalidateContextCache();

    const pageData = window.PageParser?.getFullPageData?.() || null;
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

    contextCache = data;
    cacheTimestamp = now;
    return data;
}

function handleLocationChange() {
    invalidateContextCache();

    // Keep the shared page snapshot aligned with the live SPA route. Consumers also
    // perform their own scope checks, so a failed parse simply leaves context unavailable.
    setTimeout(() => {
        const context = getContextWithCache();
        if (context && chrome.runtime?.id) {
            chrome.storage.local.set({ current_context: context }).catch?.(() => {});
        }
    }, 100);
}

window.addEventListener('popstate', handleLocationChange);
window.addEventListener('hashchange', handleLocationChange);
window.addEventListener('etsy-ai-locationchange', handleLocationChange);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_FRESH_CONTEXT') {
        sendResponse({ context: getContextWithCache() });
        return true;
    }

    if (request.action === 'refresh_context') {
        const context = getContextWithCache();
        if (context) {
            chrome.runtime.sendMessage({
                type: 'ETSY_DATA_PARSED',
                payload: context
            }, () => {
                if (chrome.runtime.lastError) {
                    // Background compatibility message is best-effort.
                }
            });
        }
        sendResponse({ status: 'Refreshed', context });
        return true;
    }

    if (request.type === 'CHAT_MANAGER_TOGGLE') {
        toggleChatManager(request.enabled);
        sendResponse({ status: 'Chat Manager toggled' });
    }
});

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

chrome.storage.sync.get(['chatManagerEnabled'], result => {
    const isEnabled = result.chatManagerEnabled !== undefined
        ? result.chatManagerEnabled
        : true;

    if (isEnabled) {
        const checkAndInit = () => {
            if (window.EtsyChatManager) toggleChatManager(true);
            else setTimeout(checkAndInit, 100);
        };
        checkAndInit();
    }
});

window.EtsyAI_GetFreshContext = getContextWithCache;
