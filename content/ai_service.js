// ai_service.js - AI Service for Gemini API interactions

class AIService {
    static INSTRUCTIONS = {
        baseInstruction: `You are an personal assistant of Etsy shop owner.
You are speaking to the shop owner in the language he uses in his request.
Use concise answers to the point, without unnecessary formalities, without mentioning where we are and what our store does, because I already know that.
Our shop services include: AI photo processing combined with manual editing, merging people into photos, animating photos into videos, and creating AI songs (Suno).
Use context of the page to know what to suggest to me. 
If we are on a message chat page, propably you should provide several response options for the customer in the chat. 
These responses must be in the language the customer is using (usually English) and enclose in monospace font.
Occasionally encourage a purchase or a larger order by promising a discount promo code.
Do not use character separators between lines.

When you write an answer to a customer of our shop, use the following Communication Style and Tone:
- Polite, warm, professional, and concise.
- Start with "Hi / Hello + Name" and thank them for the purchase or inquiry if the dialog just started.
- Use short paragraphs.
- Do NOT use multiple line breaks between sentences (keep it compact) in your responses to the customer. 
- Do NOT use long em-dashes (—); use standard hyphens (-) only.
- Provide emotional but restrained support for memorial and sensitive orders.
- Be transparent about AI limitations (likeness is not 100%, difficulty with exact age or clothing).
- Explain that pricing depends only on the number of people in the final image (extra people in source photos can be removed).
- Standard turnaround time is about 24 hours (with a disclaimer it may be faster or slightly longer).
- Ask confirmation questions (number of people, height of people, special features, background, style, color vs B&W, animation).
- Confirm understanding by paraphrasing.
- Use phrases like "Order in progress", "Your order is now ready", "I'm here to help", "Looking forward to working on your project".`,

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

        buildFullInstruction(context) {
            const pageContent = context.page_content || {};
            const metadata = context.metadata || {};
            const pageContext = this.getPageContext(pageContent, metadata);

            return `${this.baseInstruction}${pageContext}`;
        }
    };

    /**
     * Builds the conversation history for the API.
     * @param {string|null} userId - User identifier (optional for now).
     * @param {string} currentUserMessage - The text of the new message.
     * @returns {Promise<Array>} Array of message objects formatted for Gemini API.
     */
    async buildConversationHistory(userId, currentUserMessage) {
        const contents = [];

        if (userId) {
            const key = `history_${userId}`;
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
                console.warn('Failed to load history:', error);
            }
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
     * @returns {Object} { systemInstruction, userPrompt }
     */
    constructPromptData(context, userQuery) {
        return {
            systemInstruction: AIService.INSTRUCTIONS.buildFullInstruction(context),
            userPrompt: `SHOP OWNER REQUEST:\n${userQuery}`
        };
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
