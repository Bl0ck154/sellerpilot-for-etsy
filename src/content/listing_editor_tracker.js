// listing_editor_tracker.js - Auto-parse listing description when user edits on Etsy
// Works on: /your/shops/me/listing-editor/edit/{listing_id}

/**
 * ListingEditorTracker Module
 * Monitors when user edits a listing and auto-parses the description
 */
window.ListingEditorTracker = (function () {
    let initialized = false;
    let currentListingId = null;
    let lastParseTime = 0;
    let parseDebounceTimer = null;
    let mutationObserver = null;
    let inputListener = null;

    const PARSE_DEBOUNCE_MS = 5000; // Wait 5 seconds after last change before parsing
    const MIN_PARSE_INTERVAL = 30000; // Don't parse more often than once per 30 seconds

    // === INITIALIZATION ===
    function init() {
        // Only run on listing editor pages
        const editorPattern = /\/your\/shops\/me\/listing-editor\/edit\/(\d+)/;
        const match = window.location.pathname.match(editorPattern);

        if (!match) {
            cleanup(); // Clean up if navigated away
            return;
        }

        if (initialized) return;
        initialized = true;

        currentListingId = match[1];
        setupWatchers();
    }

    // === WATCHERS ===
    function setupWatchers() {
        // Optimize: Only watch form container, not entire body
        const formContainer = document.querySelector('form') || document.body;

        // Create observer with optimized settings
        mutationObserver = new MutationObserver((mutations) => {
            // Filter to only care about actual content changes
            const hasRelevantChange = mutations.some(m =>
                m.type === 'characterData' ||
                (m.type === 'childList' && m.target.matches('textarea, [contenteditable="true"]'))
            );

            if (hasRelevantChange) {
                debounceOnChange();
            }
        });

        mutationObserver.observe(formContainer, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: false // Don't need old values
        });

        // Input listener with proper reference for cleanup
        inputListener = (e) => {
            const target = e.target;
            if (target.matches('textarea, [contenteditable="true"]')) {
                debounceOnChange();
            }
        };

        document.addEventListener('input', inputListener, true);
    }

    // === CLEANUP ===
    function cleanup() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        if (inputListener) {
            document.removeEventListener('input', inputListener, true);
            inputListener = null;
        }

        if (parseDebounceTimer) {
            clearTimeout(parseDebounceTimer);
            parseDebounceTimer = null;
        }

        initialized = false;
        currentListingId = null;
    }

    // === DEBOUNCE LOGIC ===
    function debounceOnChange() {
        if (parseDebounceTimer) {
            clearTimeout(parseDebounceTimer);
        }

        parseDebounceTimer = setTimeout(() => {
            triggerParse();
        }, PARSE_DEBOUNCE_MS);
    }

    // === PARSE TRIGGER ===
    async function triggerParse() {
        const now = Date.now();
        const timeSinceLastParse = now - lastParseTime;

        // Rate limiting
        if (timeSinceLastParse < MIN_PARSE_INTERVAL) {
            return;
        }

        lastParseTime = now;
        const listingUrl = `https://www.etsy.com/listing/${currentListingId}`;

        try {
            const response = await fetch(listingUrl, {
                credentials: 'include'
            });

            if (!response.ok) {
                console.warn(`ListingEditorTracker: Fetch failed (${response.status})`);
                return;
            }

            const html = await response.text();

            const result = await chrome.runtime.sendMessage({
                type: 'PARSE_LISTING_HTML',
                html: html,
                url: listingUrl
            });

            if (!result || !result.success) {
                console.warn('ListingEditorTracker: Parse failed', result?.error);
            }

        } catch (error) {
            console.error('ListingEditorTracker: Error', error);
        }
    }

    // === PUBLIC API ===
    return {
        init: init,
        cleanup: cleanup,
        triggerParse: triggerParse,

        getState: () => ({
            initialized,
            currentListingId,
            lastParseTime: lastParseTime ? new Date(lastParseTime).toISOString() : null
        })
    };
})();

// Auto-initialize and setup navigation watcher
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ListingEditorTracker.init());
} else {
    window.ListingEditorTracker.init();
}

// Watch for SPA navigation (Etsy uses client-side routing)
let lastUrl = window.location.href;

window.addEventListener('popstate', () => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        window.ListingEditorTracker.init();
    }
});

window.addEventListener('hashchange', () => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        window.ListingEditorTracker.init();
    }
});

