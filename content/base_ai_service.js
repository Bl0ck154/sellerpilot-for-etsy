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

            // Get chat history context from Etsy conversation
            const chatHistoryContext = await this.getChatHistoryContext();

            return `${instruction}${pageContext}${ragContext}${chatHistoryContext}`;
        },

        /**
         * Get RAG context from cached listings
         * @returns {Promise<string>} Formatted context string or empty
         */
        async getRAGContext() {
            try {
                // Only on specific message conversation pages: /messages/{conversation_id}
                if (!/^\/messages\/\d+/.test(window.location.pathname)) {
                    return '';
                }

                // 1. Try to get current listing ID from storage (set by etsy_context_interceptor)
                let listingId = null;

                if (chrome.runtime?.id) {
                    try {
                        const result = await chrome.storage.local.get(['ETSY_CURRENT_LISTING_ID']);
                        listingId = result.ETSY_CURRENT_LISTING_ID;
                    } catch (e) {
                        // Ignore error, fallback to DOM scanning
                    }
                }

                // 2. Fallback: Scan DOM for listing links if no listing_id in storage
                let listingIds = [];

                if (listingId) {
                    listingIds.push(listingId);
                } else {
                    const listingUrls = this.scanCurrentChatForListings();
                    for (const url of listingUrls) {
                        const id = url.match(/\/listing\/(\d+)/)?.[1];
                        if (id) listingIds.push(id);
                    }
                }

                if (listingIds.length === 0) {
                    return '';
                }

                // 3. Load all cached listings
                const items = await chrome.storage.local.get(null);
                const TTL_24_HOURS = 24 * 60 * 60 * 1000;
                const now = Date.now();
                const expiredKeys = [];

                // 4. Find first listing that exists in cache
                for (const id of listingIds) {
                    const storageKey = `RAG_LISTING_${id}`;
                    const cached = items[storageKey];

                    if (!cached || !cached.title) continue;

                    // Check TTL
                    const age = now - (cached.timestamp || 0);
                    if (age > TTL_24_HOURS) {
                        expiredKeys.push(storageKey);
                        continue;
                    }

                    // Found first valid cached listing!
                    let context = '\n\n### PRODUCT CONTEXT (Etsy listing description):\n';
                    context += `\n**${cached.title}**\n`;

                    if (cached.personalization) {
                        context += `Personalization field (for buyer): ${cached.personalization}\n`;
                    }

                    if (cached.description) {
                        const desc = cached.description.length > 4000
                            ? cached.description.substring(0, 4000) + '...'
                            : cached.description;
                        context += `Description: ${desc}\n`;
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
         * Scan current chat DOM for listing URLs WITH PRIORITY
         * Priority order:
         * 1. Chat window messages (highest)
         * 2. "Most recent order" section (.latest-order-module)
         * 3. "Order history" section
         * 4. "Favorited items" section (lowest)
         * 
         * @returns {string[]} Array with single highest-priority listing URL, or empty
         */
        scanCurrentChatForListings() {
            // Priority 1: Chat window messages
            const chatContainer = document.querySelector('[data-appears-component-name*="message"]')
                || document.querySelector('.wt-conversation-message')
                || document.querySelector('.message-container');

            if (chatContainer) {
                const chatLinks = chatContainer.querySelectorAll('a[href*="/listing/"]');
                for (const link of chatLinks) {
                    const href = link.href || link.getAttribute('href');
                    const match = href?.match(/\/listing\/(\d+)/);
                    if (match) {
                        const url = `https://www.etsy.com/listing/${match[1]}`;
                        return [url]; // Return first listing from chat
                    }
                }
            }

            // Priority 2: "Most recent order" section
            const recentOrderSection = document.querySelector('.latest-order-module');
            if (recentOrderSection) {
                const orderLinks = recentOrderSection.querySelectorAll('a[href*="/listing/"]');
                for (const link of orderLinks) {
                    const href = link.href || link.getAttribute('href');
                    const match = href?.match(/\/listing\/(\d+)/);
                    if (match) {
                        const url = `https://www.etsy.com/listing/${match[1]}`;
                        return [url];
                    }
                }
            }

            // Priority 3: "Order history" section
            const orderHistorySection = document.querySelector('[class*="order-history"]')
                || Array.from(document.querySelectorAll('h3')).find(h =>
                    h.textContent.includes('Order history') || h.textContent.includes('order history')
                )?.closest('section, div[class*="module"]');

            if (orderHistorySection) {
                const historyLinks = orderHistorySection.querySelectorAll('a[href*="/listing/"]');
                for (const link of historyLinks) {
                    const href = link.href || link.getAttribute('href');
                    const match = href?.match(/\/listing\/(\d+)/);
                    if (match) {
                        const url = `https://www.etsy.com/listing/${match[1]}`;
                        return [url];
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
                    const match = href?.match(/\/listing\/(\d+)/);
                    if (match) {
                        const url = `https://www.etsy.com/listing/${match[1]}`;
                        return [url];
                    }
                }
            }

            // Fallback: If no priority sections found, scan ALL listing links
            const allLinks = document.querySelectorAll('a[href*="/listing/"]');
            for (const link of allLinks) {
                const href = link.href || link.getAttribute('href');
                const match = href?.match(/\/listing\/(\d+)/);
                if (match) {
                    const url = `https://www.etsy.com/listing/${match[1]}`;
                    return [url]; // Return first listing found anywhere
                }
            }

            return []; // No listings found at all
        },

        /**
         * Load chat history context from Etsy conversation
         * Uses data extracted by EtsyContextInterceptor
         * @returns {Promise<string>} Formatted chat history or empty string
         */
        async getChatHistoryContext() {
            try {
                // Check extension context first
                if (!chrome.runtime?.id) {
                    return '';
                }

                // Only on specific message conversation pages
                if (!/^\/messages\/\d+/.test(window.location.pathname)) {
                    return '';
                }

                // Get current conversation ID from URL
                const currentConvoId = window.location.pathname.match(/\/messages\/(\d+)/)?.[1];
                if (!currentConvoId) {
                    return '';
                }

                const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
                const chatHistory = result.ETSY_CHAT_HISTORY;

                if (!chatHistory?.messages?.length) {
                    return '';
                }

                // STRICT: Must match current conversation ID
                if (!chatHistory.convo_id || chatHistory.convo_id !== currentConvoId) {
                    return ''; // Wrong conversation or no convo_id set
                }

                // Check timestamp - if data is older than 30 seconds, it's likely stale
                const age = Date.now() - (chatHistory.timestamp || 0);
                if (age > 30000) {
                    // Data is too old, likely from previous session
                    // Return empty to avoid showing wrong context
                    return '';
                }

                let context = '\n\n### CUSTOMER CONVERSATION HISTORY:\n';
                context += '(Messages between you and the customer, from oldest to newest)\n\n';

                for (const msg of chatHistory.messages) {
                    const sender = msg.sender_display_name || `User ${msg.sender_user_id || msg.sender_id}` || 'Unknown';
                    const text = msg.message_body || msg.message || '';
                    const date = msg.create_date ? new Date(msg.create_date * 1000).toLocaleString() : '';

                    context += `[${sender}]${date ? ` (${date})` : ''}: ${text}\n`;

                    // Include attachment info (normalized to 'attachments' field)
                    if (msg.attachments?.length > 0 || msg.has_images) {
                        context += `  📎 ${msg.attachments?.length || 'Image'} attachment(s)\n`;
                    }
                }

                return context;
            } catch (error) {
                console.warn('⚠️ getChatHistoryContext: Failed to load:', error);
                return '';
            }
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


