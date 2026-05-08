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

        LIMITS: {
            pageMarkdownChars: 8000,
            primaryListingDescriptionChars: 2500,
            secondaryListings: 3,
            secondarySnippetChars: 140,
            etsyChatMessages: 20,
            etsyChatMessageChars: 1000
        },

        trimText(text, maxChars) {
            if (!text || typeof text !== 'string') return '';
            if (text.length <= maxChars) return text;
            return `${text.slice(0, maxChars).trim()}\n[trimmed ${text.length - maxChars} chars]`;
        },

        normalizeContext(context) {
            return {
                page_content: context?.page_content || context || {},
                metadata: context?.metadata || context?.page_content?.metadata || {}
            };
        },

        getPageContext(pageContent, metadata) {
            const firstPart = `\n
Now I am on the page:
- URL: ${metadata?.url || 'Unknown'}
- Title: ${pageContent.title || metadata?.title || 'Unknown'}`;
            if (!pageContent || !pageContent.hasContent) {
                return firstPart;
            }

            const markdown = this.trimText(pageContent.markdown, this.LIMITS.pageMarkdownChars);

            return `${firstPart}
${pageContent.excerpt ? `- Summary: ${pageContent.excerpt}` : ''}
${markdown ? `\n\nPAGE CONTENT:\n${markdown}` : ''}`;
        },

        async buildFullInstruction(context) {
            const safeContext = this.normalizeContext(context);
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

            const policyAddendum = window.AgentPolicyManager
                ? await window.AgentPolicyManager.buildSystemAddendum()
                : '';

            const pageContent = safeContext.page_content || {};
            const metadata = safeContext.metadata || {};
            const pageContext = this.getPageContext(pageContent, metadata);

            // User memory (persistent facts) — placed high so it's visible before page-specific data
            const memoryContext = window.MemoryManager
                ? await window.MemoryManager.buildContextSection()
                : '';

            // Get RAG context from parsed listings (non-blocking read)
            const ragContext = await this.getRAGContext();

            // Get chat history context from Etsy conversation
            const chatHistoryContext = await this.getChatHistoryContext();

            // PAGE_SCOPE tag — placed last so the model sees it right before generating
            const pageScope = this.getPageScope(metadata);

            return `${instruction}${policyAddendum}${memoryContext}${pageContext}${ragContext}${chatHistoryContext}${pageScope}`;
        },

        /**
         * Produce a [PAGE_SCOPE: ...] tag describing what kind of Etsy page the user is on.
         * Lets the model pick the right mode (SEO / reply / triage / advice) without guessing from URL slugs.
         */
        getPageScope(metadata) {
            let path = '';
            try {
                const url = metadata?.url || window.location.href;
                path = new URL(url).pathname || '';
            } catch (_) {
                path = window.location.pathname || '';
            }

            const m = (re) => path.match(re);
            let match;

            if ((match = m(/^\/your\/shops\/me\/listing-editor\/edit\/(\d+)/))) {
                return `\n\n[PAGE_SCOPE: listing-editor | listing_id=${match[1]}]`;
            }
            if ((match = m(/^\/messages\/(\d+)/))) {
                return `\n\n[PAGE_SCOPE: messages | convo_id=${match[1]}]`;
            }
            if (/^\/messages/.test(path)) {
                return `\n\n[PAGE_SCOPE: messages-inbox]`;
            }
            if (/^\/your\/shops\/me\//.test(path)) {
                return `\n\n[PAGE_SCOPE: shop-dashboard | path=${path}]`;
            }
            if ((match = m(/^\/listing\/(\d+)/))) {
                return `\n\n[PAGE_SCOPE: public-listing | listing_id=${match[1]}]`;
            }
            return `\n\n[PAGE_SCOPE: other | path=${path || '/'}]`;
        },

        /**
         * Get RAG context from cached listings.
         * Loads ALL listings relevant to the current page (primary + secondary mentions),
         * gives the primary one a full description and the rest a short summary.
         * @returns {Promise<string>} Formatted context string or empty
         */
        async getRAGContext() {
            try {
                const path = window.location.pathname;
                const onMessages = /^\/messages\/\d+/.test(path);
                const onEditor = /^\/your\/shops\/me\/listing-editor\/edit\/(\d+)/.test(path);
                const onPublicListing = /^\/listing\/(\d+)/.test(path);

                if (!onMessages && !onEditor && !onPublicListing) {
                    return '';
                }

                // 1. Build prioritized list of listing IDs to pull from cache.
                // Primary = the listing the user is actively looking at (editor / public / transaction).
                // Secondary = other listings referenced on the page (chat attachments, recent orders, etc.)
                const primaryIds = [];
                const secondaryIds = [];

                if (onEditor) {
                    primaryIds.push(path.match(/edit\/(\d+)/)[1]);
                } else if (onPublicListing) {
                    primaryIds.push(path.match(/\/listing\/(\d+)/)[1]);
                } else if (onMessages && chrome.runtime?.id) {
                    try {
                        const result = await chrome.storage.local.get(['ETSY_CURRENT_LISTING_ID']);
                        if (result.ETSY_CURRENT_LISTING_ID) primaryIds.push(result.ETSY_CURRENT_LISTING_ID);
                    } catch (_) { /* ignore, fall back to DOM scanning */ }
                }

                // Scan DOM for additional listing references
                for (const url of this.scanCurrentChatForListings()) {
                    const id = url.match(/\/listing\/(\d+)/)?.[1];
                    if (!id) continue;
                    if (primaryIds.includes(id) || secondaryIds.includes(id)) continue;
                    secondaryIds.push(id);
                }

                const allIds = [...primaryIds, ...secondaryIds].slice(0, 5); // cap at 5 to keep prompt small
                if (allIds.length === 0) return '';

                // 2. Load cached data for those IDs only (avoid reading the whole storage)
                const keys = allIds.map(id => `RAG_LISTING_${id}`);
                const items = await chrome.storage.local.get(keys);
                const TTL_24_HOURS = 24 * 60 * 60 * 1000;
                const now = Date.now();
                const expiredKeys = [];

                const primary = [];
                const secondary = [];

                for (let i = 0; i < allIds.length; i++) {
                    const id = allIds[i];
                    const storageKey = `RAG_LISTING_${id}`;
                    const cached = items[storageKey];
                    if (!cached || !cached.title) continue;
                    const age = now - (cached.timestamp || 0);
                    if (age > TTL_24_HOURS) { expiredKeys.push(storageKey); continue; }

                    const isPrimary = primaryIds.includes(id);
                    (isPrimary ? primary : secondary).push({ id, cached, ageMs: age });
                }

                if (expiredKeys.length > 0) {
                    chrome.storage.local.remove(expiredKeys);
                }

                if (primary.length === 0 && secondary.length === 0) return '';

                let context = '\n\n### PRODUCT_CONTEXT (cached listing data):\n';

                for (const { id, cached, ageMs } of primary) {
                    context += `\n**[PRIMARY listing_id=${id}] ${cached.title}** (cached ${this.formatAge(ageMs)} ago)\n`;
                    if (cached.personalization) {
                        context += `Personalization field (buyer-facing): ${cached.personalization}\n`;
                    }
                    if (cached.description) {
                        const desc = this.trimText(cached.description, this.LIMITS.primaryListingDescriptionChars);
                        context += `Description: ${desc}\n`;
                    }
                }

                if (secondary.length > 0) {
                    context += `\n**Other listings mentioned on this page (summary only):**\n`;
                    for (const { id, cached } of secondary.slice(0, this.LIMITS.secondaryListings)) {
                        const snippet = this.trimText((cached.description || '').replace(/\s+/g, ' '), this.LIMITS.secondarySnippetChars);
                        context += `- listing_id=${id} — "${cached.title}"${snippet ? ` — ${snippet}` : ''}\n`;
                    }
                }

                return context;
            } catch (error) {
                console.warn('⚠️ RAG: Failed to load context:', error);
                return '';
            }
        },

        /**
         * Format a duration (ms) as a short human-readable age string.
         */
        formatAge(ms) {
            if (ms < 60 * 1000) return `${Math.floor(ms / 1000)}s`;
            if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m`;
            if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)}h`;
            return `${Math.floor(ms / 86400000)}d`;
        },

        /**
         * Scan current chat DOM for listing URLs, priority-sorted and deduped.
         * Priority order:
         * 1. Chat window messages
         * 2. "Most recent order" section (.latest-order-module)
         * 3. "Order history" section
         * 4. "Favorited items" section
         * 5. Anywhere else on the page (fallback)
         * @returns {string[]} Unique listing URLs in priority order
         */
        scanCurrentChatForListings() {
            const results = [];
            const seen = new Set();

            const collectFrom = (container) => {
                if (!container) return;
                const links = container.querySelectorAll('a[href*="/listing/"]');
                for (const link of links) {
                    const href = link.href || link.getAttribute('href');
                    const match = href?.match(/\/listing\/(\d+)/);
                    if (!match) continue;
                    const id = match[1];
                    if (seen.has(id)) continue;
                    seen.add(id);
                    results.push(`https://www.etsy.com/listing/${id}`);
                }
            };

            // Priority 1: Chat window messages
            collectFrom(
                document.querySelector('[data-appears-component-name*="message"]')
                || document.querySelector('.wt-conversation-message')
                || document.querySelector('.message-container')
            );

            // Priority 2: "Most recent order"
            collectFrom(document.querySelector('.latest-order-module'));

            // Priority 3: "Order history"
            collectFrom(
                document.querySelector('[class*="order-history"]')
                || Array.from(document.querySelectorAll('h3')).find(h =>
                    /order history/i.test(h.textContent)
                )?.closest('section, div[class*="module"]')
            );

            // Priority 4: "Favorited items"
            collectFrom(
                document.querySelector('[class*="favorited"]')
                || Array.from(document.querySelectorAll('h3')).find(h =>
                    /favorited/i.test(h.textContent)
                )?.closest('section, div[class*="module"]')
            );

            // Priority 5: fallback — anywhere else on the page
            collectFrom(document);

            return results;
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

                let context = `\n\n### CUSTOMER_CONVERSATION_HISTORY [CONTEXT_AGE: ${this.formatAge(age)}]:\n`;
                context += '(Messages between the Owner and the customer, oldest → newest.)\n\n';

                const messages = chatHistory.messages.slice(-this.LIMITS.etsyChatMessages);

                for (const msg of messages) {
                    const sender = msg.sender_display_name || `User ${msg.sender_user_id || msg.sender_id}` || 'Unknown';
                    const text = this.trimText(msg.message_body || msg.message || '', this.LIMITS.etsyChatMessageChars);
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
        const MAX_HISTORY_MESSAGES = 16;
        const MAX_MESSAGE_CHARS = 2500;
        const messages = [];

        // Always use global chat storage
        const key = 'current_chat_messages';
        try {
            const result = await chrome.storage.local.get([key]);
            const history = (result[key] || []).slice(-MAX_HISTORY_MESSAGES);

            for (const msg of history) {
                messages.push({
                    role: msg.type === 'user' ? 'user' : 'assistant',
                    content: this.trimMessageText(msg.text, MAX_MESSAGE_CHARS)
                });
            }
        } catch (error) {
            console.warn('Failed to load global chat history:', error);
        }

        messages.push({
            role: 'user',
            content: this.trimMessageText(currentUserMessage, MAX_MESSAGE_CHARS)
        });

        return messages;
    }

    trimMessageText(text, maxChars) {
        if (!text || typeof text !== 'string') return '';
        if (text.length <= maxChars) return text;
        return `${text.slice(0, maxChars).trim()}\n[trimmed ${text.length - maxChars} chars]`;
    }

    /**
     * Prepares the system instruction and user prompt based on context.
     * @param {Object} context - The current page context.
     * @param {string} userQuery - The user's input.
     * @returns {Promise<Object>} { systemInstruction, userPrompt }
     */
    async constructPromptData(context, userQuery) {
        const safeContext = context || { page_content: {}, metadata: {} };
        return {
            systemInstruction: await BaseAIService.INSTRUCTIONS.buildFullInstruction(safeContext),
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


