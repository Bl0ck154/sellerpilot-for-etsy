// providers/grok_service.js - Grok (xAI) Service Implementation
// Extends BaseAIService to provide Grok-specific functionality

class GrokService extends BaseAIService {
    constructor() {
        super();
    }

    getProviderName() {
        return 'grok';
    }

    getApiEndpoint() {
        return 'https://api.x.ai/v1/';
    }

    /**
     * Generates a short chat title based on conversation content.
     * @param {string} userMessage - The user's first message.
     * @param {string} aiResponse - The AI's first response.
     * @param {string} apiKey - Grok API Key.
     * @param {string} modelId - Model ID to use.
     * @returns {Promise<string>} Generated chat title.
     */
    async generateChatTitle(userMessage, aiResponse, apiKey, modelId = 'grok-beta') {
        const url = `${this.getApiEndpoint()}chat/completions`;

        const prompt = `Проаналізуй цей діалог і придумай коротку назву (3-7 слів), яка відображає суть запиту. Віддай лише текст назви без лапок.

Користувач: ${userMessage}
AI: ${aiResponse}`;

        const payload = {
            model: modelId,
            messages: [
                { role: 'user', content: prompt }
            ],
            stream: false
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = new Error(`Grok API Error: ${response.status}`);
                error.statusCode = response.status;
                throw error;
            }

            const data = await response.json();
            const titleText = data.choices?.[0]?.message?.content?.trim();

            if (titleText) {
                return titleText;
            }

            throw new Error('No title text in response');
        } catch (error) {
            console.warn('⚠️ Grok chat title generation failed, using fallback');
            throw error;
        }
    }

    /**
     * Calls the Grok Streaming API.
     * @param {Object} params - Configuration object.
     * @param {string} params.modelId - ID of the model to use.
     * @param {string} params.apiKey - Grok API Key.
     * @param {Array} params.messages - Conversation history in standard format.
     * @param {string} params.systemInstruction - System instructions.
     * @param {Function} [params.onChunk] - Callback for partial text updates (text, fullText).
     * @param {Function} [params.onComplete] - Callback when stream finishes (fullText).
     * @param {Function} [params.onError] - Callback for errors.
     * @returns {Promise<string>} The complete generated text.
     */
    async streamMessage({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError }) {
        const url = `${this.getApiEndpoint()}chat/completions`;

        // Add system instruction as first message
        const messagesWithSystem = [
            { role: 'system', content: systemInstruction },
            ...messages
        ];

        const payload = {
            model: modelId,
            messages: messagesWithSystem,
            stream: true
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMessage = `Grok API Error: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error?.message || errorMessage;
                } catch (e) { /* ignore json parse error */ }
                throw new Error(errorMessage);
            }

            let fullText = '';
            let buffer = '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.substring(6).trim();
                        if (jsonStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            const textPart = data.choices?.[0]?.delta?.content;

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
            console.error('Grok Stream Error:', error);
            if (onError) onError(error);
            throw error;
        }
    }
}

// Export as a global class
window.GrokService = GrokService;


