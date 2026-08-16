// listing_editor_tracker.js - Keeps listing-editor RAG context fresh across Etsy SPA navigation.
window.ListingEditorTracker = (function () {
    let initialized = false;
    let currentListingId = null;
    let lastParseTime = 0;
    let parseDebounceTimer = null;
    let initialParseTimer = null;
    let mutationObserver = null;
    let inputListener = null;

    const PARSE_DEBOUNCE_MS = 5000;
    const MIN_PARSE_INTERVAL = 30000;

    function getListingId() {
        return window.location.pathname.match(/\/your\/shops\/me\/listing-editor\/edit\/(\d+)/)?.[1] || null;
    }

    function init() {
        const listingId = getListingId();
        if (!listingId) {
            cleanup();
            return;
        }
        if (initialized && currentListingId === listingId) return;

        cleanup();
        initialized = true;
        currentListingId = listingId;
        setupWatchers();

        // Prime RAG on page entry. Previously the listing was not cached until the Owner
        // changed a field, so the assistant could open an editor with no product context.
        initialParseTimer = setTimeout(() => {
            initialParseTimer = null;
            triggerParse({ force: true });
        }, 300);
    }

    function setupWatchers() {
        const formContainer = document.querySelector('form') || document.body;
        mutationObserver = new MutationObserver((mutations) => {
            const hasRelevantChange = mutations.some(mutation =>
                mutation.type === 'characterData' ||
                (mutation.type === 'childList' &&
                    mutation.target?.matches?.('textarea, [contenteditable="true"]'))
            );
            if (hasRelevantChange) debounceOnChange();
        });

        mutationObserver.observe(formContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });

        inputListener = event => {
            if (event.target?.matches?.('textarea, [contenteditable="true"]')) debounceOnChange();
        };
        document.addEventListener('input', inputListener, true);
    }

    function cleanup() {
        mutationObserver?.disconnect();
        mutationObserver = null;

        if (inputListener) {
            document.removeEventListener('input', inputListener, true);
            inputListener = null;
        }
        if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
        if (initialParseTimer) clearTimeout(initialParseTimer);
        parseDebounceTimer = null;
        initialParseTimer = null;

        initialized = false;
        currentListingId = null;
        // Rate limiting is per listing/page identity. Carrying this timestamp into a
        // different listing could suppress its first context refresh for up to 30 seconds.
        lastParseTime = 0;
    }

    function debounceOnChange() {
        if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
        parseDebounceTimer = setTimeout(() => {
            parseDebounceTimer = null;
            triggerParse();
        }, PARSE_DEBOUNCE_MS);
    }

    async function triggerParse(options = {}) {
        const listingIdAtStart = currentListingId;
        if (!listingIdAtStart || getListingId() !== listingIdAtStart) return false;

        const now = Date.now();
        if (!options.force && now - lastParseTime < MIN_PARSE_INTERVAL) return false;
        lastParseTime = now;

        const listingUrl = `https://www.etsy.com/listing/${listingIdAtStart}`;
        try {
            const response = await fetch(listingUrl, { credentials: 'include' });
            if (!response.ok) {
                console.warn(`ListingEditorTracker: Fetch failed (${response.status})`);
                return false;
            }

            const html = await response.text();
            // Do not let a slow response from the previous SPA route populate the new page.
            if (currentListingId !== listingIdAtStart || getListingId() !== listingIdAtStart) {
                return false;
            }

            const result = await chrome.runtime.sendMessage({
                type: 'PARSE_LISTING_HTML',
                html,
                url: listingUrl
            });
            if (!result?.success) {
                console.warn('ListingEditorTracker: Parse failed', result?.error);
                return false;
            }
            return true;
        } catch (error) {
            console.error('ListingEditorTracker: Error', error);
            return false;
        }
    }

    return {
        init,
        cleanup,
        triggerParse,
        getState: () => ({
            initialized,
            currentListingId,
            lastParseTime: lastParseTime ? new Date(lastParseTime).toISOString() : null
        })
    };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ListingEditorTracker.init());
} else {
    window.ListingEditorTracker.init();
}

let lastUrl = window.location.href;

function onUrlMaybeChanged() {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    window.ListingEditorTracker.init();
}

window.addEventListener('popstate', onUrlMaybeChanged);
window.addEventListener('hashchange', onUrlMaybeChanged);

if (!window.__etsyAiHistoryPatched) {
    window.__etsyAiHistoryPatched = true;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        window.dispatchEvent(new Event('etsy-ai-locationchange'));
        return result;
    };
    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        window.dispatchEvent(new Event('etsy-ai-locationchange'));
        return result;
    };
}

window.addEventListener('etsy-ai-locationchange', onUrlMaybeChanged);
