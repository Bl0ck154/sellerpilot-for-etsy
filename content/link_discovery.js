// link_discovery.js - Background RAG Context Parsing for Etsy Messages
// Detects listing links in chat, fetches & parses them for LLM context

/**
 * LinkDiscovery Module
 * Works ONLY on /messages/* pages
 * Triggers on user focus/input in message textarea
 */
window.LinkDiscovery = (function () {
    // === STATE ===
    const fetchingUrls = new Set(); // In-flight requests (Deduplication Level 2)
    let initialized = false;
    let discoveryTriggered = false;
    let lastUrl = window.location.href; // Track URL for SPA navigation

    // === URL PATTERNS ===
    const LISTING_PATTERN = /\/listing\/(\d+)/;
    const ORDER_PATTERN = /\/your\/orders\/(\d+)/;
    const TRANSACTION_PATTERN = /\/transaction\/(\d+)/;

    // === INITIALIZATION ===
    function init() {
        // Only run on specific message conversation pages: /messages/{conversation_id}
        // NOT on the general /messages page without an ID
        if (!/^\/messages\/\d+/.test(window.location.pathname)) {
            return;
        }

        if (initialized) return;
        initialized = true;

        // Initialized
        setupTriggers();
        setupNavigationListener();
    }

    // === TRIGGER SETUP ===
    function setupTriggers() {
        // Trigger 1: Focus on AI assistant input field
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            // Check if it's OUR AI assistant input field
            if (isAIAssistantInput(target)) {

                triggerDiscovery();
            }
        });

        // Trigger 2: Typing in AI assistant input (backup trigger)
        document.addEventListener('input', (e) => {
            const target = e.target;
            if (isAIAssistantInput(target) && !discoveryTriggered) {

                triggerDiscovery();
            }
        });
    }

    /**
     * Setup listener for SPA navigation to reset discovery state
     */
    function setupNavigationListener() {
        // Check for URL changes periodically (SPA navigation detection)
        setInterval(() => {
            if (window.location.href !== lastUrl) {

                lastUrl = window.location.href;
                discoveryTriggered = false; // Reset so new chat can trigger discovery
            }
        }, 1000);
    }

    /**
     * Check if element is our AI assistant input field
     */
    function isAIAssistantInput(element) {
        if (!element) return false;

        // Check for our specific AI assistant input
        // ID: user-input (contenteditable div)
        return element.id === 'user-input' ||
            element.closest('#user-input') !== null ||
            element.closest('#etsy-ai-chat-container [contenteditable]') !== null;
    }

    // === MAIN DISCOVERY FLOW ===
    async function triggerDiscovery() {
        if (discoveryTriggered) {

            return;
        }
        discoveryTriggered = true;

        try {
            // Scan for direct listing links
            const listingUrls = await scanForListingLinks();


            // Scan for order links (will resolve to listings)
            const orderUrls = await scanForOrderLinks();


            // Scan for transaction links (will resolve via redirect to listings)
            const transactionUrls = await scanForTransactionLinks();


            // Process listing links
            for (const url of listingUrls) {
                await processListingUrl(url);
            }

            // Process order links (chain resolution)
            for (const url of orderUrls) {
                await processOrderUrl(url);
            }

            // Process transaction links (redirect resolution)
            for (const url of transactionUrls) {
                await processTransactionUrl(url);
            }

        } catch (error) {
            console.error('🔴 LinkDiscovery: Error during discovery:', error);
        }
    }

    /**
     * Scan chat DOM for listing links WITH PRIORITY
     * Priority order:
     * 1. Chat window messages (highest - usually appears first in DOM)
     * 2. "Most recent order" section (.latest-order-module)
     * 3. "Order history" section
     * 4. "Favorited items" section (lowest)
     * 
     * @returns {string[]} Array with single highest-priority listing URL, or empty
     */
    async function scanForListingLinks() {
        // Priority 1: Chat window messages
        // Chat messages are typically in the main conversation area
        // Look for links that are NOT part of order/favorite sections
        const chatContainer = document.querySelector('[data-appears-component-name*="message"]')
            || document.querySelector('.wt-conversation-message')
            || document.querySelector('.message-container');

        if (chatContainer) {
            const chatLinks = chatContainer.querySelectorAll('a[href*="/listing/"]');
            for (const link of chatLinks) {
                const href = link.href || link.getAttribute('href');
                if (href && LISTING_PATTERN.test(href)) {
                    const url = normalizeListingUrl(href);
                    if (url) {
                        return [url]; // Return first listing from chat
                    }
                }
            }
        }

        // Priority 2: "Most recent order" section
        const recentOrderSection = document.querySelector('.latest-order-module');
        if (recentOrderSection) {
            const orderLinks = recentOrderSection.querySelectorAll('a[href*="/listing/"]');
            for (const link of orderLinks) {
                const href = link.href || link.getAttribute('href');
                if (href && LISTING_PATTERN.test(href)) {
                    const url = normalizeListingUrl(href);
                    if (url) {
                        return [url]; // Return listing from most recent order
                    }
                }
            }
        }

        // Priority 3: "Order history" section
        // Usually has heading "Order history" or similar
        const orderHistorySection = document.querySelector('[class*="order-history"]')
            || Array.from(document.querySelectorAll('h3')).find(h =>
                h.textContent.includes('Order history') || h.textContent.includes('order history')
            )?.closest('section, div[class*="module"]');

        if (orderHistorySection) {
            const historyLinks = orderHistorySection.querySelectorAll('a[href*="/listing/"]');
            for (const link of historyLinks) {
                const href = link.href || link.getAttribute('href');
                if (href && LISTING_PATTERN.test(href)) {
                    const url = normalizeListingUrl(href);
                    if (url) {
                        return [url]; // Return first listing from order history
                    }
                }
            }
        }

        // Priority 4: "Favorited items" section (lowest priority)
        const favoritedSection = document.querySelector('[class*="favorited"]')
            || Array.from(document.querySelectorAll('h3')).find(h =>
                h.textContent.includes('Favorited') || h.textContent.includes('favorited')
            )?.closest('section, div[class*="module"]');

        if (favoritedSection) {
            const favoriteLinks = favoritedSection.querySelectorAll('a[href*="/listing/"]');
            for (const link of favoriteLinks) {
                const href = link.href || link.getAttribute('href');
                if (href && LISTING_PATTERN.test(href)) {
                    const url = normalizeListingUrl(href);
                    if (url) {
                        return [url]; // Return first listing from favorited items
                    }
                }
            }
        }

        // Fallback: If no priority sections found, scan ALL listing links on page
        // This ensures we still find listings even on pages with different structure
        const allLinks = document.querySelectorAll('a[href*="/listing/"]');
        for (const link of allLinks) {
            const href = link.href || link.getAttribute('href');
            if (href && LISTING_PATTERN.test(href)) {
                const url = normalizeListingUrl(href);
                if (url) {
                    return [url]; // Return first listing found anywhere
                }
            }
        }

        return []; // No listings found at all
    }

    /**
     * Scan chat DOM for order links
     * @returns {string[]} Array of order URLs
     */
    async function scanForOrderLinks() {
        const urls = new Set();

        const links = document.querySelectorAll('a[href*="/your/orders/"]');

        for (const link of links) {
            const href = link.href || link.getAttribute('href');
            if (href && ORDER_PATTERN.test(href)) {
                urls.add(href);
            }
        }

        return Array.from(urls);
    }

    /**
     * Scan chat DOM for transaction links
     * @returns {string[]} Array of transaction URLs
     */
    async function scanForTransactionLinks() {
        const urls = new Set();

        const links = document.querySelectorAll('a[href*="/transaction/"]');

        for (const link of links) {
            const href = link.href || link.getAttribute('href');
            if (href && TRANSACTION_PATTERN.test(href)) {
                // Normalize to full URL
                const fullUrl = href.startsWith('http') ? href : `https://www.etsy.com${href}`;
                urls.add(fullUrl);
            }
        }

        return Array.from(urls);
    }

    /**
     * Normalize listing URL to canonical form
     */
    function normalizeListingUrl(url) {
        const match = url.match(LISTING_PATTERN);
        if (match) {
            return `https://www.etsy.com/listing/${match[1]}`;
        }
        return null;
    }

    // === URL PROCESSING ===

    /**
     * Process a listing URL - check cache, fetch if needed
     */
    async function processListingUrl(url) {
        // Level 1: Check storage cache
        const cached = await checkCache(url);
        if (cached) {

            return;
        }

        // Level 2: Check in-flight
        if (fetchingUrls.has(url)) {

            return;
        }

        // Fetch and parse
        await fetchAndParseListing(url);
    }

    /**
     * Process an order URL - resolve to listing, then process
     */
    async function processOrderUrl(orderUrl) {
        // Level 2: Check in-flight
        if (fetchingUrls.has(orderUrl)) {

            return;
        }

        try {
            fetchingUrls.add(orderUrl);


            // Fetch order page
            const response = await fetch(orderUrl, {
                credentials: 'include' // Include cookies for auth
            });

            if (!response.ok) {
                console.warn(`⚠️ LinkDiscovery: Order fetch failed: ${response.status}`);
                return;
            }

            const html = await response.text();

            // Look for listing/transaction links in the order page
            const result = extractListingFromOrderHtml(html);

            if (result) {
                if (result.type === 'listing') {

                    await processListingUrl(result.url);
                } else if (result.type === 'transaction') {

                    await processTransactionUrl(result.url);
                }
            } else {

            }

        } catch (error) {
            console.error(`🔴 LinkDiscovery: Order processing error:`, error);
        } finally {
            fetchingUrls.delete(orderUrl);
        }
    }

    /**
     * Extract listing ID from order page HTML
     * Since Etsy is a React SPA, the order page returns JS that hydrates the DOM.
     * We need to look for listing_id in the embedded JSON data within <script> tags.
     * @param {string} html - Raw HTML response from order page
     * @returns {Object} { type: 'listing', url: string, listingId: string } or null
     */
    function extractListingFromOrderHtml(html) {
        // Strategy 1: Look for listing_id in JSON data embedded in script tags
        // Common patterns in React apps:
        // - "listing_id":12345
        // - "listing_id": 12345
        // - listing_id: 12345
        // - "listingId":12345

        const listingIdPatterns = [
            /"listing_id"\s*:\s*(\d+)/g,
            /"listingId"\s*:\s*(\d+)/g,
            /listing_id['"]*\s*:\s*(\d+)/g,
            /\/listing\/(\d+)/g  // Fallback: any listing URL in the response
        ];

        const foundIds = new Set();

        for (const pattern of listingIdPatterns) {
            let match;
            // Reset regex lastIndex for global patterns
            pattern.lastIndex = 0;
            while ((match = pattern.exec(html)) !== null) {
                const listingId = match[1];
                if (listingId && listingId.length > 5) { // Etsy listing IDs are usually 9-10 digits
                    foundIds.add(listingId);
                }
            }

            // If we found IDs with this pattern, prefer the first one
            if (foundIds.size > 0) {
                break;
            }
        }

        if (foundIds.size > 0) {
            // Take the first listing ID found
            const listingId = Array.from(foundIds)[0];
            const url = `https://www.etsy.com/listing/${listingId}`;

            return { type: 'listing', url: url, listingId: listingId };
        }

        // Strategy 2: Fallback to DOM parsing (in case page does have links)
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Try to find listing link in DOM
        const listingLink = doc.querySelector('a[href*="/listing/"]');
        if (listingLink) {
            const href = listingLink.getAttribute('href');
            const normalizedUrl = normalizeListingUrl(href);
            if (normalizedUrl) {
                const match = normalizedUrl.match(/\/listing\/(\d+)/);
                return {
                    type: 'listing',
                    url: normalizedUrl,
                    listingId: match ? match[1] : null
                };
            }
        }

        // Try transaction links
        const transactionLink = doc.querySelector('a[href*="/transaction/"]');
        if (transactionLink) {
            const href = transactionLink.getAttribute('href');
            const fullUrl = href.startsWith('http') ? href : `https://www.etsy.com${href}`;
            return { type: 'transaction', url: fullUrl };
        }

        console.log(`⚠️ LinkDiscovery: No listing_id found in order page. HTML length: ${html.length}`);
        return null;
    }

    /**
     * Process a transaction URL - follow redirect to get listing URL
     */
    async function processTransactionUrl(transactionUrl) {
        // Level 2: Check in-flight
        if (fetchingUrls.has(transactionUrl)) {

            return;
        }

        try {
            fetchingUrls.add(transactionUrl);


            // Fetch transaction page - it will redirect to listing
            const response = await fetch(transactionUrl, {
                credentials: 'include',
                redirect: 'follow' // Follow the redirect to listing page
            });

            if (!response.ok) {
                console.warn(`⚠️ LinkDiscovery: Transaction fetch failed: ${response.status}`);
                return;
            }

            // The final URL after redirect should be the listing
            const finalUrl = response.url;

            if (LISTING_PATTERN.test(finalUrl)) {
                const normalizedUrl = normalizeListingUrl(finalUrl);


                // Now we have the HTML of the listing page already, parse it directly
                const html = await response.text();

                // Check cache first
                const cached = await checkCache(normalizedUrl);
                if (cached) {

                    return;
                }

                // Send to background for parsing
                const result = await chrome.runtime.sendMessage({
                    type: 'PARSE_LISTING_HTML',
                    html: html,
                    url: normalizedUrl
                });

                if (result && result.success) {

                } else {
                    console.warn(`⚠️ LinkDiscovery: Parse failed:`, result?.error);
                }
            } else {
                console.warn(`⚠️ LinkDiscovery: Transaction did not redirect to listing: ${finalUrl}`);
            }

        } catch (error) {
            console.error(`🔴 LinkDiscovery: Transaction processing error:`, error);
        } finally {
            fetchingUrls.delete(transactionUrl);
        }
    }

    // === FETCH & PARSE ===

    /**
     * Fetch listing page and send to background for parsing
     */
    async function fetchAndParseListing(url) {
        try {
            fetchingUrls.add(url);


            // Fetch the listing page (with auth cookies)
            const response = await fetch(url, {
                credentials: 'include'
            });

            if (!response.ok) {
                console.warn(`⚠️ LinkDiscovery: Fetch failed for ${url}: ${response.status}`);
                return;
            }

            const html = await response.text();


            // Send to background for parsing via offscreen
            const result = await chrome.runtime.sendMessage({
                type: 'PARSE_LISTING_HTML',
                html: html,
                url: url
            });

            if (result && result.success) {

            } else {
                console.warn(`⚠️ LinkDiscovery: Parse failed:`, result?.error);
            }

        } catch (error) {
            console.error(`🔴 LinkDiscovery: Fetch error for ${url}:`, error);
        } finally {
            fetchingUrls.delete(url);
        }
    }

    // === CACHE HELPERS ===

    // Storage key prefix for RAG data (to separate from other extension data)
    const RAG_STORAGE_PREFIX = 'RAG_LISTING_';

    /**
     * Get storage key for a listing URL
     */
    function getStorageKey(url) {
        // Extract listing ID for shorter key
        const match = url.match(/\/listing\/(\d+)/);
        return match ? `${RAG_STORAGE_PREFIX}${match[1]}` : `${RAG_STORAGE_PREFIX}${btoa(url).substring(0, 20)}`;
    }

    /**
     * Check if URL is already in cache
     */
    async function checkCache(url) {
        try {
            const key = getStorageKey(url);
            const result = await chrome.storage.local.get([key]);
            return result && result[key];
        } catch (error) {
            console.warn('⚠️ LinkDiscovery: Cache check failed:', error);
            return null;
        }
    }

    // === PUBLIC API ===
    return {
        init: init,
        triggerDiscovery: triggerDiscovery, // For manual testing

        // Expose for debugging
        getState: () => ({
            initialized,
            discoveryTriggered,
            fetchingUrls: Array.from(fetchingUrls)
        })
    };
})();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LinkDiscovery.init());
} else {
    window.LinkDiscovery.init();
}
