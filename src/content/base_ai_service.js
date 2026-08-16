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
            primaryListingDescriptionChars: 16000,
            secondaryListings: 3,
            secondarySnippetChars: 140,
            etsyChatMessageChars: 6000,
            etsyChatTotalChars: 160000
        },

        lastBuildMetadata: null,

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
            // Owner customizations are additive. The stable role/source/truth policy must
            // remain present even when an older customization was saved.
            let instruction = this.baseInstruction;

            const customInstructionsPromise = chrome.storage.local.get(['custom_instructions'])
                .catch(error => {
                    console.warn('Failed to load custom instructions, using default:', error);
                    return {};
                });
            const policyPromise = window.AgentPolicyManager
                ? window.AgentPolicyManager.getPolicy().catch(error => {
                    console.warn('Failed to load agent policy, using bundled base instruction:', error);
                    return {};
                })
                : Promise.resolve({});

            const [customInstructionResult, policy] = await Promise.all([
                customInstructionsPromise,
                policyPromise
            ]);

            let customInstructionsActive = false;
            try {
                const result = customInstructionResult;
                if (result.custom_instructions && result.custom_instructions.trim()) {
                    instruction += `\n\n### OWNER_CUSTOM_INSTRUCTIONS\n` +
                        `(Owner-authored preferences. Apply when relevant, but they do not redefine participant roles, source trust, capability, or truth boundaries.)\n` +
                        result.custom_instructions.trim();
                    customInstructionsActive = true;
                }
            } catch (error) {
                console.warn('Failed to load custom instructions, using default:', error);
            }

            const policyVersion = policy.version || null;
            const policyAddendum = policy.systemAddendum ? `\n\n${policy.systemAddendum}` : '';

            this.lastBuildMetadata = {
                customInstructionsActive,
                policyVersion
            };

            const pageContent = safeContext.page_content || {};
            const metadata = safeContext.metadata || {};
            const pageContext = this.getPageContext(pageContent, metadata);

            // These sources are independent. Read them concurrently so listing/chat
            // hydration waits do not stack while preserving the complete context.
            const [
                memoryContext,
                shopIntelligenceContext,
                imageContext,
                ragContext,
                chatHistoryContext
            ] = await Promise.all([
                window.MemoryManager ? window.MemoryManager.buildContextSection() : Promise.resolve(''),
                window.ShopIntelligenceManager ? window.ShopIntelligenceManager.buildContextSection() : Promise.resolve(''),
                window.ImageIntelligenceManager ? window.ImageIntelligenceManager.buildContextSection() : Promise.resolve(''),
                this.getRAGContext(),
                this.getChatHistoryContext()
            ]);

            // PAGE_SCOPE tag — placed last so the model sees it right before generating
            const pageScope = this.getPageScope(metadata);

            return `${instruction}${policyAddendum}${memoryContext}${shopIntelligenceContext}${imageContext}${pageContext}${ragContext}${chatHistoryContext}${pageScope}`;
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

                const collectListingIds = async () => {
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
                            if (result.ETSY_CURRENT_LISTING_ID) primaryIds.push(String(result.ETSY_CURRENT_LISTING_ID));
                        } catch (_) { /* ignore, fall back to DOM scanning */ }
                    }

                    // Scan DOM for additional listing references
                    for (const url of this.scanCurrentChatForListings()) {
                        const id = url.match(/\/listing\/(\d+)/)?.[1];
                        if (!id) continue;
                        if (primaryIds.includes(id) || secondaryIds.includes(id)) continue;
                        secondaryIds.push(id);
                    }

                    return {
                        primaryIds,
                        secondaryIds,
                        allIds: [...primaryIds, ...secondaryIds].slice(0, 5)
                    };
                };

                let { primaryIds, secondaryIds, allIds } = await collectListingIds();

                if (onMessages && allIds.length === 0) {
                    await this.waitForListingContext(1500);
                    ({ primaryIds, secondaryIds, allIds } = await collectListingIds());
                }

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

                if (onMessages && primaryIds.length > 0 && primary.length === 0) {
                    await this.waitForListingContext(1000);
                    const refreshed = await chrome.storage.local.get(keys);
                    primary.length = 0;
                    secondary.length = 0;

                    for (let i = 0; i < allIds.length; i++) {
                        const id = allIds[i];
                        const storageKey = `RAG_LISTING_${id}`;
                        const cached = refreshed[storageKey];
                        if (!cached || !cached.title) continue;
                        const age = now - (cached.timestamp || 0);
                        if (age > TTL_24_HOURS) { expiredKeys.push(storageKey); continue; }

                        const isPrimary = primaryIds.includes(id);
                        (isPrimary ? primary : secondary).push({ id, cached, ageMs: age });
                    }
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
         * Wait briefly for listing context hydration on message pages.
         * Helps bridge the gap between conversation parsing and cached RAG data.
         */
        async waitForListingContext(timeoutMs = 1500) {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                try {
                    const result = await chrome.storage.local.get([
                        'ETSY_CURRENT_LISTING_ID'
                    ]);
                    if (result.ETSY_CURRENT_LISTING_ID) {
                        const storageKey = `RAG_LISTING_${result.ETSY_CURRENT_LISTING_ID}`;
                        const cached = await chrome.storage.local.get([storageKey]);
                        if (cached[storageKey]?.title) {
                            return true;
                        }
                    }
                } catch (_) {
                    return false;
                }

                await new Promise(resolve => setTimeout(resolve, 250));
            }

            return false;
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

                let result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
                let chatHistory = result.ETSY_CHAT_HISTORY;

                if (!chatHistory?.messages?.length || String(chatHistory.convo_id || '') !== currentConvoId) {
                    await this.waitForChatHistory(currentConvoId, 1500);
                    result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
                    chatHistory = result.ETSY_CHAT_HISTORY;
                }

                if (!chatHistory?.messages?.length) return '';

                // STRICT: Must match current conversation ID
                if (!chatHistory.convo_id || chatHistory.convo_id !== currentConvoId) {
                    return ''; // Wrong conversation or no convo_id set
                }

                // The conversation ID is the authoritative stale-data guard. Etsy does not
                // necessarily refresh detail-view-data every 30 seconds, so rejecting a
                // matching conversation by age makes its messages and attachments disappear.
                const age = Date.now() - (chatHistory.timestamp || 0);

                let context = `\n\n### CUSTOMER_CONVERSATION_HISTORY [CONTEXT_AGE: ${this.formatAge(age)}]:\n`;
                context += '(Messages between the Owner and the customer, oldest → newest.)\n\n';

                const candidateMessages = chatHistory.messages;
                const messageSizes = candidateMessages.map(msg => Math.min(
                    String(msg.message_body || msg.message || '').length,
                    this.LIMITS.etsyChatMessageChars
                ));
                const fullSize = messageSizes.reduce((sum, size) => sum + size, 0);
                let selectedIndexes = candidateMessages.map((_, index) => index);

                // Ordinary conversations are included in full. If an unusually large thread
                // exceeds the safety budget, preserve both its beginning and its recent part.
                // The model, rather than keyword rules, decides which details matter now.
                if (fullSize > this.LIMITS.etsyChatTotalChars) {
                    const beginningBudget = Math.floor(this.LIMITS.etsyChatTotalChars * 0.35);
                    const recentBudget = this.LIMITS.etsyChatTotalChars - beginningBudget;
                    const selected = new Set();
                    let used = 0;

                    for (let i = 0; i < candidateMessages.length; i++) {
                        if (selected.size > 0 && used + messageSizes[i] > beginningBudget) break;
                        selected.add(i);
                        used += messageSizes[i];
                    }

                    used = 0;
                    for (let i = candidateMessages.length - 1; i >= 0; i--) {
                        if (selected.has(i)) continue;
                        if (used > 0 && used + messageSizes[i] > recentBudget) break;
                        selected.add(i);
                        used += messageSizes[i];
                    }

                    selectedIndexes = [...selected].sort((a, b) => a - b);
                }

                const messages = selectedIndexes.map(index => candidateMessages[index]);

                const omittedCount = chatHistory.messages.length - messages.length;
                if (omittedCount > 0) {
                    context += `[${omittedCount} middle message(s) omitted because the conversation exceeded the safety budget; the beginning and newest messages are included.]\n\n`;

                    if (window.ConversationContextManager) {
                        const selectedSet = new Set(selectedIndexes);
                        const omittedMessages = candidateMessages
                            .map((message, sourceIndex) => ({ message, sourceIndex }))
                            .filter(item => !selectedSet.has(item.sourceIndex));
                        const summaryText = await window.ConversationContextManager.getOrCreateSummary(
                            chatHistory,
                            omittedMessages
                        );
                        context += window.ConversationContextManager.buildContextSection(summaryText, omittedCount);
                    }
                }

                for (const msg of messages) {
                    const senderId = String(msg.sender_user_id || msg.sender_id || msg.user_id || '').trim();
                    const customerId = String(chatHistory.customer_user_id || '').trim();
                    const roleText = `${msg.sender_type || ''} ${msg.role || ''} ${msg.author_role || ''}`.toLowerCase();
                    const participantRole = customerId && senderId
                        ? (customerId === senderId ? 'CUSTOMER' : 'OWNER')
                        : /buyer|customer/.test(roleText)
                            ? 'CUSTOMER'
                            : /seller|shop|owner/.test(roleText)
                                ? 'OWNER'
                                : 'PARTICIPANT';
                    const senderName = msg.sender_display_name || `User ${senderId || 'unknown'}`;
                    const text = this.trimText(msg.message_body || msg.message || '', this.LIMITS.etsyChatMessageChars);
                    const date = msg.create_date ? new Date(msg.create_date * 1000).toLocaleString() : '';

                    context += `[${participantRole}: ${senderName}]${date ? ` (${date})` : ''}: ${text}\n`;

                    // Include attachment info (normalized to 'attachments' field)
                    if (msg.attachments?.length > 0 || msg.has_images) {
                        context += `  📎 ${msg.attachments?.length || 'Image'} attachment(s)\n`;
                    }
                }

                // Etsy sometimes renders message images in the DOM without exposing their
                // structured speaker/message association in the intercepted payload.
                const domAttachmentLinks = Array.from(document.querySelectorAll(
                    '.quick-refunds-message-images a[href], .quick-refunds-message-images img[src]'
                ));
                if (domAttachmentLinks.length > 0) {
                    context += `\n[VISIBLE_CONVERSATION_ATTACHMENTS: ${domAttachmentLinks.length} image element(s) are visible. Speaker and message association may be incomplete; use structured history and vision summaries when available.]\n`;
                }

                return context;
            } catch (error) {
                console.warn('⚠️ getChatHistoryContext: Failed to load:', error);
                return '';
            }
        },

        async waitForChatHistory(convoId, timeoutMs = 1500) {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                try {
                    const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
                    const history = result.ETSY_CHAT_HISTORY;
                    if (history?.messages?.length && String(history.convo_id || '') === String(convoId)) {
                        return true;
                    }
                } catch (_) {
                    return false;
                }
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            return false;
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
        const MAX_HISTORY_MESSAGES = 24;
        const MAX_MESSAGE_CHARS = 4000;
        const messages = [];

        const key = userId && String(userId).startsWith('current_chat_messages')
            ? String(userId)
            : 'current_chat_messages';
        try {
            const result = await chrome.storage.local.get([key]);
            const allHistory = result[key] || [];
            const history = allHistory.length <= MAX_HISTORY_MESSAGES
                ? allHistory
                : [
                    ...allHistory.slice(0, 4),
                    ...allHistory.slice(-(MAX_HISTORY_MESSAGES - 4))
                ];

            for (const msg of history) {
                messages.push({
                    role: msg.type === 'user' ? 'user' : 'assistant',
                    content: this.trimMessageText(msg.text, MAX_MESSAGE_CHARS)
                });
            }
        } catch (error) {
            console.warn('Failed to load global chat history:', error);
        }

        const currentContent = this.trimMessageText(currentUserMessage, MAX_MESSAGE_CHARS);
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== currentContent) {
            messages.push({ role: 'user', content: currentContent });
        }

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


