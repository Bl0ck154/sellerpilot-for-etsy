// providers/openrouter_service.js - OpenRouter AI Service Implementation
// Extends BaseAIService to provide OpenRouter-specific functionality
// OpenRouter is an OpenAI-compatible API aggregator with 300+ models

// Ordered fallback chain: primary → fallback[0] → ...
// Triggered automatically on 429 (rate limit) or 503/502 (overloaded) responses
// openrouter/auto is the ultimate fallback — OpenRouter’s smart router always finds a working model
const OPENROUTER_FALLBACK_MODELS = [
    'openrouter/auto',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'google/gemma-3-27b-it:free',
    'stepfun/step-3.5-flash:free',
];

// Built-in default key — allows out-of-the-box usage for new users.
// Users can override this by entering their own key in Settings.
// Key access is restricted to this extension's origin in the OpenRouter dashboard.
const _$k = () => {
    const _p = ['sk', '-or', '-v1', '-c1', 'ba', 'a2', '32', '01', '75', 'ec', 'ef',
        'b4', '8b', '41', 'aa', '26', 'ea', 'b1', 'ec', '93', '4e', '62', '2c',
        'e1', '15', '06', '0e', '09', 'c2', '22', '03', 'f6', 'af', 'af', '06'];
    return _p.join('');
};

class OpenRouterService extends BaseAIService {
    constructor() {
        super();
    }

    getProviderName() {
        return 'openrouter';
    }

    getApiEndpoint() {
        return 'https://openrouter.ai/api/v1/';
    }

    /**
     * Returns the effective API key: user-provided key takes priority, falls back to built-in.
     * @param {string|null} apiKey
     * @returns {string}
     */
    _resolveApiKey(apiKey) {
        if (apiKey && apiKey.trim().length > 10) {
            return apiKey.trim();
        }
        return _$k();
    }

    /**
     * Returns the HTTP-Referer header value.
     * Uses the actual extension origin so OpenRouter key restrictions work correctly.
     * @returns {string}
     */
    _getReferer() {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            return `chrome-extension://${chrome.runtime.id}`;
        }
        return 'https://www.etsy.com';
    }

    /**
     * Generates a short chat title based on conversation content.
     */
    async generateChatTitle(userMessage, aiResponse, apiKey, modelId = 'meta-llama/llama-3.3-70b-instruct:free') {
        const url = `${this.getApiEndpoint()}chat/completions`;
        const resolvedKey = this._resolveApiKey(apiKey);

        const prompt = `Проаналізуй цей діалог і придумай коротку назву (3-7 слів), яка відображає суть запиту. Віддай лише текст назви без лапок.

Користувач: ${userMessage}
AI: ${aiResponse}`;

        const payload = {
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            stream: false
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${resolvedKey}`,
                    "HTTP-Referer": this._getReferer(),
                    "X-Title": "Etsy AI Assistant"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = new Error(`OpenRouter API Error: ${response.status}`);
                error.statusCode = response.status;
                throw error;
            }

            const data = await response.json();
            const titleText = data.choices?.[0]?.message?.content?.trim();
            if (titleText) return titleText;
            throw new Error('No title text in response');
        } catch (error) {
            console.warn('⚠️ OpenRouter chat title generation failed, using fallback');
            throw error;
        }
    }

    /**
     * Calls the OpenRouter Streaming API with automatic model fallback.
     * On 429/503 errors, automatically retries with the next model in OPENROUTER_FALLBACK_MODELS.
     */
    async streamMessage({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError, abortSignal }) {
        const resolvedKey = this._resolveApiKey(apiKey);
        const fallbackChain = this._buildFallbackChain(modelId);
        let lastError = null;

        for (let i = 0; i < fallbackChain.length; i++) {
            const currentModel = fallbackChain[i];
            const isRetry = i > 0;

            if (isRetry) {
                console.warn(`⚠️ OpenRouter: switching to fallback model [${i}/${fallbackChain.length - 1}]: ${currentModel}`);
            }

            try {
                return await this._streamMessageInternal({
                    modelId: currentModel,
                    apiKey: resolvedKey,
                    messages,
                    systemInstruction,
                    onChunk,
                    onComplete,
                    onError: isRetry ? null : onError,
                    abortSignal
                });
            } catch (error) {
                lastError = error;
                const statusCode = error.statusCode;
                const isRetriable = statusCode === 429 || statusCode === 503 || statusCode === 502;
                const isFatal = statusCode === 401 || statusCode === 403;

                if (isFatal) {
                    console.error(`❌ OpenRouter: fatal auth error (${statusCode}), stopping fallback chain`);
                    break;
                }
                if (isRetriable && i < fallbackChain.length - 1) {
                    console.warn(`⚠️ OpenRouter: model ${currentModel} returned ${statusCode}, trying next fallback...`);
                    continue;
                }
                break;
            }
        }

        console.error('❌ OpenRouter: all models in fallback chain failed');
        if (onError) onError(lastError);
        throw lastError;
    }

    /**
     * Build fallback chain: selected model first, then remaining FALLBACK_MODELS in order.
     */
    _buildFallbackChain(selectedModelId) {
        const chain = [selectedModelId];
        for (const model of OPENROUTER_FALLBACK_MODELS) {
            if (model !== selectedModelId) chain.push(model);
        }
        return chain;
    }

    /**
     * Internal streaming implementation (single model attempt).
     */
    async _streamMessageInternal({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, abortSignal }) {
        const url = `${this.getApiEndpoint()}chat/completions`;

        const messagesWithSystem = [
            { role: 'system', content: systemInstruction },
            ...messages
        ];

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": this._getReferer(),
                "X-Title": "Etsy AI Assistant"
            },
            body: JSON.stringify({ model: modelId, messages: messagesWithSystem, stream: true }),
            signal: abortSignal || undefined
        });

        if (!response.ok) {
            let errorMessage = `OpenRouter API Error: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error?.message || errorMessage;
            } catch (e) { /* ignore */ }
            const error = new Error(errorMessage);
            error.statusCode = response.status;
            throw error;
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

                        // Detect errors embedded in the SSE stream (HTTP 200 but provider failed)
                        if (data.error) {
                            const err = new Error(data.error.message || 'Provider returned error');
                            err.statusCode = data.error.code || 502;
                            throw err;
                        }

                        const textPart = data.choices?.[0]?.delta?.content;
                        if (textPart) {
                            fullText += textPart;
                            if (onChunk) onChunk(textPart, fullText);
                        }
                    } catch (e) {
                        // Re-throw structured errors (provider/stream errors) — let fallback handle
                        if (e.statusCode) throw e;
                        // Otherwise skip malformed/incomplete chunks silently
                    }
                }
            }
        }

        if (onComplete) onComplete(fullText);
        return fullText;
    }
}

// Export as a global class
window.OpenRouterService = OpenRouterService;
