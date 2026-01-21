// base_ai_service.js - Base Abstract Class for AI Service Providers
// This class defines the common interface that all AI providers must implement

class BaseAIService {
    constructor() {
        if (this.constructor === BaseAIService) {
            throw new Error("BaseAIService is an abstract class and cannot be instantiated directly");
        }
    }

    /**
     * Static instructions handler - shared across all providers
     */
    static INSTRUCTIONS = {
        baseInstruction: window.ETSY_AI_BASE_INSTRUCTION,

        getPageContext(pageContent, metadata) {
            const firstPart = `\n
Now I am on the page:
- URL: ${metadata?.url || 'Unknown'}
- Title: ${pageContent.title || metadata?.title || 'Unknown'}`;
            if (!pageContent || !pageContent.hasContent) {
                return firstPart;
            }

            return `${firstPart}
${pageContent.excerpt ? `- Summary: ${pageContent.excerpt}` : ''}
${pageContent.markdown ? `\n\nPAGE CONTENT:\n${pageContent.markdown}` : ''}`;
        },

        async buildFullInstruction(context) {
            // Check for custom instructions in storage
            let instruction = this.baseInstruction;

            try {
                const result = await chrome.storage.local.get(['custom_instructions']);
                if (result.custom_instructions && result.custom_instructions.trim()) {
                    instruction = result.custom_instructions;
                }
            } catch (error) {
                console.warn('Failed to load custom instructions, using default:', error);
            }

            const pageContent = context.page_content || {};
            const metadata = context.metadata || {};
            const pageContext = this.getPageContext(pageContent, metadata);

            // Get RAG context from parsed listings (non-blocking read)
            const ragContext = await this.getRAGContext();

            return `${instruction}${pageContext}${ragContext}`;
        },

        /**
         * Load parsed listing context from local storage
         * Scans current chat DOM to determine order, then looks up cached data
         * @returns {Promise<string>} Formatted context string or empty
         */
        async getRAGContext() {
            try {
                // Only on messages pages
                if (!window.location.pathname.startsWith('/messages')) {
                    return '';
                }

                // 1. Scan current chat DOM for listing links (in order)
                const listingUrls = this.scanCurrentChatForListings();

                if (listingUrls.length === 0) {
                    return '';
                }

                // 2. Load all cached listings
                const items = await chrome.storage.local.get(null);
                const TTL_24_HOURS = 24 * 60 * 60 * 1000;
                const now = Date.now();
                const expiredKeys = [];

                // 3. Find first listing from DOM that exists in cache
                for (const url of listingUrls) {
                    const listingId = url.match(/\/listing\/(\d+)/)?.[1];
                    if (!listingId) continue;

                    const storageKey = `RAG_LISTING_${listingId}`;
                    const cached = items[storageKey];

                    if (!cached || !cached.title) continue;

                    // Check TTL
                    const age = now - (cached.timestamp || 0);
                    if (age > TTL_24_HOURS) {
                        expiredKeys.push(storageKey);
                        continue;
                    }

                    // Found first valid cached listing!
                    let context = '\n\n### PRODUCT CONTEXT (from discussed listing):\n';
                    context += `\n**${cached.title}**\n`;
                    context += `URL: ${cached.url}\n`;

                    if (cached.description) {
                        const desc = cached.description.length > 800
                            ? cached.description.substring(0, 800) + '...'
                            : cached.description;
                        context += `Description: ${desc}\n`;
                    }

                    if (cached.personalization) {
                        context += `Customer Personalization/Instructions: ${cached.personalization}\n`;
                    }

                    // Clean up expired entries
                    if (expiredKeys.length > 0) {
                        chrome.storage.local.remove(expiredKeys);
                    }

                    return context;
                }

                // Clean up expired even if no valid listing found
                if (expiredKeys.length > 0) {
                    chrome.storage.local.remove(expiredKeys);
                }

                return '';
            } catch (error) {
                console.warn('⚠️ RAG: Failed to load context:', error);
                return '';
            }
        },

        /**
         * Scan current chat DOM for listing URLs in order
         * @returns {string[]} Array of listing URLs in DOM order
         */
        scanCurrentChatForListings() {
            const urls = [];
            const links = document.querySelectorAll('a[href*="/listing/"]');

            links.forEach(link => {
                const href = link.href || link.getAttribute('href');
                if (!href) return;

                const match = href.match(/\/listing\/(\d+)/);
                if (match) {
                    const url = `https://www.etsy.com/listing/${match[1]}`;
                    // Deduplicate
                    if (!urls.includes(url)) {
                        urls.push(url);
                    }
                }
            });

            return urls;
        }
    };

    /**
     * Builds the conversation history for the API.
     * Provider-agnostic implementation.
     * @param {string|null} userId - User identifier (use 'global_chat' for global storage).
     * @param {string} currentUserMessage - The text of the new message.
     * @returns {Promise<Array>} Array of message objects formatted for the provider.
     */
    async buildConversationHistory(userId, currentUserMessage) {
        const messages = [];

        // Always use global chat storage
        const key = 'current_chat_messages';
        try {
            const result = await chrome.storage.local.get([key]);
            const history = result[key] || [];

            for (const msg of history) {
                messages.push({
                    role: msg.type === 'user' ? 'user' : 'assistant',
                    content: msg.text
                });
            }
        } catch (error) {
            console.warn('Failed to load global chat history:', error);
        }

        messages.push({
            role: 'user',
            content: currentUserMessage
        });

        return messages;
    }

    /**
     * Prepares the system instruction and user prompt based on context.
     * @param {Object} context - The current page context.
     * @param {string} userQuery - The user's input.
     * @returns {Promise<Object>} { systemInstruction, userPrompt }
     */
    async constructPromptData(context, userQuery) {
        return {
            systemInstruction: await BaseAIService.INSTRUCTIONS.buildFullInstruction(context),
            userPrompt: `SHOP OWNER REQUEST:\n${userQuery}`
        };
    }

    /**
     * Abstract method: Stream a message from the AI provider.
     * Must be implemented by each provider.
     * @param {Object} params - Configuration object with apiKey, messages, etc.
     * @returns {Promise<string>} The complete generated text.
     */
    async streamMessage(params) {
        throw new Error("streamMessage() must be implemented by provider subclass");
    }

    /**
     * Abstract method: Generate a short chat title.
     * Must be implemented by each provider.
     * @param {string} userMessage - The user's first message.
     * @param {string} aiResponse - The AI's first response.
     * @param {string} apiKey - Provider API Key.
     * @returns {Promise<string>} Generated chat title.
     */
    async generateChatTitle(userMessage, aiResponse, apiKey) {
        throw new Error("generateChatTitle() must be implemented by provider subclass");
    }

    /**
     * Get provider-specific API endpoint
     * Must be implemented by each provider.
     * @returns {string} API endpoint URL
     */
    getApiEndpoint() {
        throw new Error("getApiEndpoint() must be implemented by provider subclass");
    }

    /**
     * Get provider name
     * Must be implemented by each provider.
     * @returns {string} Provider name
     */
    getProviderName() {
        throw new Error("getProviderName() must be implemented by provider subclass");
    }
}

// Helper function to trim log output
function trimLog(str) {
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
}

// Export as a global class
window.BaseAIService = BaseAIService;


