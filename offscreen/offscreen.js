// offscreen.js - HTML Parser for Listing Pages
// This runs in an offscreen document context to safely parse HTML without affecting visible pages

/**
 * Parse listing HTML and extract product data
 * @param {string} html - Raw HTML string of the listing page
 * @param {string} url - URL of the listing
 * @returns {Object} Parsed listing data
 */
function parseListingHTML(html, url) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract title - try multiple selectors
        let title = '';
        const h1 = doc.querySelector('h1');
        if (h1) {
            title = h1.textContent.trim();
        } else {
            // Fallback to meta tag
            const ogTitle = doc.querySelector('meta[property="og:title"]');
            title = ogTitle?.content || '';
        }

        // Extract description
        // Selector: div[data-id="description-text"] > p[data-product-details-description-text-content]
        let description = '';
        const descContainer = doc.querySelector('div[data-id="description-text"]');
        if (descContainer) {
            // Try to get the specific paragraph first
            const descParagraph = descContainer.querySelector('p[data-product-details-description-text-content]');
            if (descParagraph) {
                description = descParagraph.textContent.trim();
            } else {
                // Fallback: get all text content, excluding "read more" buttons
                const clone = descContainer.cloneNode(true);
                // Remove content-toggle buttons (read more/less)
                clone.querySelectorAll('.content-toggle, button').forEach(el => el.remove());
                description = clone.textContent.trim();
            }
        }

        // Extract personalization instructions
        // Selector: div[data-instructions-container] > p[data-instructions]
        let personalization = null;
        const persContainer = doc.querySelector('div[data-instructions-container]');
        if (persContainer) {
            const persText = persContainer.querySelector('p[data-instructions]');
            if (persText) {
                personalization = persText.textContent.trim();
            } else {
                // Fallback to direct text content
                const directText = persContainer.textContent.trim();
                if (directText) {
                    personalization = directText;
                }
            }
        }

        // Clean up description - remove excessive whitespace
        if (description) {
            description = description.replace(/\s+/g, ' ').trim();
        }

        return {
            url: url,
            title: title,
            description: description,
            personalization: personalization,
            parsedAt: Date.now(),
            success: true
        };

    } catch (error) {
        console.error('🔴 Offscreen: Parse error:', error);
        return {
            url: url,
            title: '',
            description: '',
            personalization: null,
            parsedAt: Date.now(),
            success: false,
            error: error.message
        };
    }
}

// Message listener for parsing requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only handle messages targeted at offscreen
    if (message.target !== 'offscreen') {
        return false;
    }

    if (message.type === 'PARSE_LISTING_HTML') {
        const result = parseListingHTML(message.html, message.url);
        sendResponse(result);
        return true; // Keep channel open for async response
    }

    return false;
});
