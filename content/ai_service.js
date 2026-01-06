// ai_service.js - AI Service for Gemini API interactions

class AIService {
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
                    console.log('📝 Using custom instructions from storage');
                } else {
                    console.log('📝 Using default base instructions');
                }
            } catch (error) {
                console.warn('Failed to load custom instructions, using default:', error);
            }

            const pageContent = context.page_content || {};
            const metadata = context.metadata || {};
            const pageContext = this.getPageContext(pageContent, metadata);

            return `${instruction}${pageContext}`;
        }
    };

    /**
     * Builds the conversation history for the API.
     * @param {string|null} userId - User identifier (use 'global_chat' for global storage).
     * @param {string} currentUserMessage - The text of the new message.
     * @returns {Promise<Array>} Array of message objects formatted for Gemini API.
     */
    async buildConversationHistory(userId, currentUserMessage) {
        const contents = [];

        // Always use global chat storage
        const key = 'current_chat_messages';
        try {
            const result = await chrome.storage.local.get([key]);
            const history = result[key] || [];

            for (const msg of history) {
                const role = msg.type === 'user' ? 'user' : (msg.type === 'ai' ? 'model' : null);
                if (role) {
                    contents.push({
                        role: role,
                        parts: [{ text: msg.text }]
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to load global chat history:', error);
        }

        contents.push({
            role: 'user',
            parts: [{ text: currentUserMessage }]
        });

        return contents;
    }

    /**
     * Prepares the system instruction and user prompt based on context.
     * @param {Object} context - The current page context.
     * @param {string} userQuery - The user's input.
     * @returns {Promise<Object>} { systemInstruction, userPrompt }
     */
    async constructPromptData(context, userQuery) {
        return {
            systemInstruction: await AIService.INSTRUCTIONS.buildFullInstruction(context),
            userPrompt: `SHOP OWNER REQUEST:\n${userQuery}`
        };
    }

    /**
     * Generates a short chat title based on conversation content.
     * @param {string} userMessage - The user's first message.
     * @param {string} aiResponse - The AI's first response.
     * @param {string} apiKey - Google API Key.
     * @param {string} modelId - Model ID to use (defaults to fast model).
     * @returns {Promise<string>} Generated chat title.
     */
    async generateChatTitle(userMessage, aiResponse, apiKey, modelId = 'gemini-2.0-flash-exp') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

        const prompt = `Проаналізуй цей діалог і придумай коротку назву (3-7 слів), яка відображає суть запиту. Віддай лише текст назви без лапок.

Користувач: ${userMessage}
AI: ${aiResponse}`;

        const payload = {
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]
            }]
        };

        const maxRetries = 1; // Reduced from 3 to avoid excessive API calls during rate limits
        const retryDelays = [2000]; // Single retry with 2s delay

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": apiKey
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const error = new Error(`API Error: ${response.status}`);
                    error.statusCode = response.status;

                    // Retry only on 429 (rate limit) errors
                    if (response.status === 429 && attempt < maxRetries) {
                        const delay = retryDelays[attempt];
                        console.warn(`⏳ Rate limit (429). Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue; // Retry
                    }

                    throw error;
                }

                const data = await response.json();
                const titleText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (titleText) {
                    return titleText;
                }

                // If no title text, throw error to trigger fallback
                throw new Error('No title text in response');
            } catch (error) {
                // If this is the last attempt or not a retryable error, throw to trigger fallback
                if (attempt === maxRetries || (error.statusCode && error.statusCode !== 429)) {
                    // Only log error on final attempt to reduce noise
                    if (attempt === maxRetries) {
                        console.warn('⚠️ Chat title generation failed after retries, using fallback');
                    }
                    throw error; // Caller will handle fallback
                }
            }
        }
    }

    /**
     * Calls the Gemini Streaming API.
     * @param {Object} params - Configuration object.
     * @param {string} params.modelId - ID of the model to use.
     * @param {string} params.apiKey - Google API Key.
     * @param {Array} params.contents - Conversation history.
     * @param {string} params.systemInstruction - System instructions.
     * @param {Function} [params.onChunk] - Callback for partial text updates (text, fullText).
     * @param {Function} [params.onComplete] - Callback when stream finishes (fullText).
     * @param {Function} [params.onError] - Callback for errors.
     * @returns {Promise<string>} The complete generated text.
     */
    async streamMessage({ modelId, apiKey, contents, systemInstruction, onChunk, onComplete, onError }) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`;

        const payload = {
            contents: contents,
            system_instruction: {
                parts: [{ text: systemInstruction }]
            }
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMessage = `API Error: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error?.message || errorMessage;
                } catch (e) { /* ignore json parse error */ }
                throw new Error(errorMessage);
            }

            let fullText = '';
            let buffer = ''; // Buffer для incomplete chunks
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Last line може бути неповним
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.substring(6).trim();
                        if (jsonStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text;

                            if (textPart) {
                                fullText += textPart;
                                if (onChunk) onChunk(textPart, fullText);
                            }
                        } catch (e) {
                            // Skip incomplete chunks
                        }
                    }
                }
            }

            if (onComplete) onComplete(fullText);
            return fullText;

        } catch (error) {
            console.error('Gemini Stream Error:', error);
            if (onError) onError(error);
            throw error;
        }
    }
}

// Helper to avoid flooding logs with massive JSON strings
function trimLog(str) {
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
}

// Export as a global class
window.AIService = AIService;
