// providers/gemini_service.js - Google Gemini AI Service Implementation
// Extends BaseAIService to provide Gemini-specific functionality

class GeminiService extends BaseAIService {
    constructor() {
        super();
        this.requestTimeoutMs = 30000;
        this.totalRequestBudgetMs = 60000;
        this.lastRequestDiagnostics = null;
    }

    getProviderName() {
        return 'gemini';
    }

    getApiEndpoint() {
        return 'https://generativelanguage.googleapis.com/v1beta/models/';
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
        const url = `${this.getApiEndpoint()}${modelId}:generateContent`;

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
     * Converts internal message format to Gemini API format
     * @param {Array} messages - Array of {role, content} objects
     * @returns {Array} Gemini-formatted contents array
     */
    _formatMessagesForGemini(messages) {
        return messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));
    }

    /**
     * Calls the Gemini Streaming API.
     * @param {Object} params - Configuration object.
     * @param {string} params.modelId - ID of the model to use.
     * @param {string} params.apiKey - Google API Key.
     * @param {Array} params.messages - Conversation history in standard format.
     * @param {string} params.systemInstruction - System instructions.
     * @param {Function} [params.onChunk] - Callback for partial text updates (text, fullText).
     * @param {Function} [params.onComplete] - Callback when stream finishes (fullText).
     * @param {Function} [params.onError] - Callback for errors.
     * @returns {Promise<string>} The complete generated text.
     */
    /**
     * Build the ordered list of models to try: requested model first (if it's
     * in the chain, everything after it is fallback; if it's not in the chain,
     * we try it first, then the full chain).
     */
    _buildFallbackList(requestedModelId) {
        const chain = window.ETSY_AI_GEMINI_FALLBACK_CHAIN || [
            'gemini-flash-latest',
            'gemini-3.1-flash-lite-preview',
            'gemini-3-flash-preview',
            'gemini-2.5-flash'
        ];
        const idx = chain.indexOf(requestedModelId);
        if (idx >= 0) return chain.slice(idx);
        return requestedModelId ? [requestedModelId, ...chain] : [...chain];
    }

    /**
     * Decide whether to transparently fall back to the next model.
     * Skip fallback for auth/permission errors — they won't fix themselves.
     */
    _shouldFallback(error) {
        const status = error?.statusCode;
        if (status === 400 || status === 401 || status === 403) return false;
        return true;
    }

    async streamMessage({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError }) {
        const models = this._buildFallbackList(modelId);
        let lastError = null;
        let chunkDelivered = false;
        const startedAt = Date.now();
        this.lastRequestDiagnostics = {
            provider: this.getProviderName(),
            requestedModel: modelId,
            attempts: []
        };

        const wrappedOnChunk = (chunk, fullText) => {
            chunkDelivered = true;
            if (onChunk) onChunk(chunk, fullText);
        };

        for (let i = 0; i < models.length; i++) {
            const currentModel = models[i];
            const remainingBudgetMs = this.totalRequestBudgetMs - (Date.now() - startedAt);

            if (remainingBudgetMs <= 0) {
                lastError = new Error(`Gemini fallback timed out after ${Math.round(this.totalRequestBudgetMs / 1000)}s`);
                break;
            }

            const attemptStartedAt = Date.now();
            const attemptTimeoutMs = Math.min(this.requestTimeoutMs, remainingBudgetMs);

            try {
                const result = await this._streamMessageInternal({
                    modelId: currentModel,
                    apiKey,
                    messages,
                    systemInstruction,
                    onChunk: wrappedOnChunk,
                    onComplete,
                    timeoutMs: attemptTimeoutMs
                });
                this.lastRequestDiagnostics.attempts.push({
                    modelId: currentModel,
                    durationMs: Date.now() - attemptStartedAt,
                    ok: true
                });
                if (i > 0) {
                    console.log(`✅ Gemini fallback succeeded on "${currentModel}" (primary "${models[0]}" failed)`);
                }
                return result;
            } catch (error) {
                lastError = error;
                this.lastRequestDiagnostics.attempts.push({
                    modelId: currentModel,
                    durationMs: Date.now() - attemptStartedAt,
                    ok: false,
                    statusCode: error?.statusCode || null,
                    error: error?.message || String(error)
                });

                // If we've already started streaming to the UI, we can't silently switch models
                if (chunkDelivered) break;

                // Non-retryable (e.g. bad API key) — stop immediately
                if (!this._shouldFallback(error)) break;

                // Try the next model if any remain
                if (i < models.length - 1) {
                    console.log(`🔄 Gemini fallback: "${currentModel}" failed (${error.message}) → trying "${models[i + 1]}"`);
                    continue;
                }
            }
        }

        if (onError) onError(lastError);
        throw lastError;
    }

    async _streamMessageInternal({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError, attempt = 0, timeoutMs = this.requestTimeoutMs }) {
        const url = `${this.getApiEndpoint()}${modelId}:streamGenerateContent?alt=sse`;

        const contents = this._formatMessagesForGemini(messages);

        const payload = {
            contents: contents,
            system_instruction: {
                parts: [{ text: systemInstruction }]
            }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                let errorMessage = `API Error: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error?.message || errorMessage;
                } catch (e) { /* ignore json parse error */ }
                const err = new Error(errorMessage);
                err.statusCode = response.status;
                throw err;
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

            if (!fullText.trim()) {
                throw new Error('Gemini returned an empty response');
            }

            if (onComplete) onComplete(fullText);
            return fullText;

        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
            }
            // Don't call onError during retry attempts - let the outer streamMessage handle it
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

// Export as a global class
window.GeminiService = GeminiService;


