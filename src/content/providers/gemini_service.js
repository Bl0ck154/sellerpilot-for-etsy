// providers/gemini_service.js - Google Gemini AI Service Implementation
// Extends BaseAIService to provide Gemini-specific functionality

class GeminiService extends BaseAIService {
    constructor() {
        super();
        // Keep the total user wait bounded, but never start a fallback attempt
        // with only a couple of seconds left.
        this.requestTimeoutMs = 30000;
        this.totalRequestBudgetMs = 60000;
        this.minimumAttemptBudgetMs = 10000;
        this.overloadedRetryDelaysMs = [1500, 3000];
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
     * @param {string} modelId - Model ID to use (defaults to current Gemini fallback chain).
     * @returns {Promise<string>} Generated chat title.
     */
    async generateChatTitle(userMessage, aiResponse, apiKey, modelId = null) {
        const prompt = `Проаналізуй цей діалог і придумай коротку назву (3-7 слів), яка відображає суть запиту. Віддай лише текст назви без лапок.

Користувач: ${userMessage}
AI: ${aiResponse}`;

        const payload = {
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]
            }]
        };

        const models = this._buildFallbackList(modelId);

        for (const currentModel of models) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            try {
                const url = `${this.getApiEndpoint()}${currentModel}:generateContent`;
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
                    const error = new Error(`API Error: ${response.status}`);
                    error.statusCode = response.status;
                    throw error;
                }

                const data = await response.json();
                const titleText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (titleText) {
                    return titleText;
                }

                throw new Error('No title text in response');
            } catch (error) {
                if (error?.name === 'AbortError') {
                    error = new Error('Chat title generation timed out');
                }

                if (!this._shouldFallback(error) || currentModel === models[models.length - 1]) {
                    console.warn('⚠️ Chat title generation failed, using fallback title:', error.message);
                    throw error;
                }
            } finally {
                clearTimeout(timeoutId);
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

    _getPromptSize(messages, systemInstruction) {
        return (systemInstruction?.length || 0) +
            messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    }

    _selectThinkingMode(messages, systemInstruction) {
        const promptChars = this._getPromptSize(messages, systemInstruction);
        const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user')?.content || '';
        const importantPattern = /важлив|термінов|urgent|important|strategy|стратег|аналіз|analy[sz]e|compare|порівняй|diagnos|чому|why|refund|case|dispute|скарг|negative review|відгук|тз|технічн|техническ|\bbrief\b|task for|specification/i;

        if (promptChars > 18000 || messages.length > 14 || importantPattern.test(lastUserMessage)) {
            return 'deep';
        }
        if (promptChars > 9000 || messages.length > 8) {
            return 'balanced';
        }
        return 'fast';
    }

    _getThinkingConfig(thinkingMode, modelId = '') {
        // Gemini thinkingConfig is supported by newer Gemini models. If a model
        // rejects it, streamMessage retries the same model without this config.
        // Gemini 3.x (including moving "latest" aliases) uses thinkingLevel.
        // Gemini 2.5 only supports the legacy numeric thinkingBudget.
        const usesThinkingLevel = /(?:^gemini-(?:3|flash)|-latest$)/i.test(modelId) &&
            !/^gemini-2\.5/i.test(modelId);

        if (usesThinkingLevel) {
            if (thinkingMode === 'fast') return { thinkingLevel: 'minimal' };
            if (thinkingMode === 'balanced') return { thinkingLevel: 'medium' };
            return { thinkingLevel: 'high' };
        }

        if (thinkingMode === 'fast') return { thinkingBudget: 0 };
        if (thinkingMode === 'balanced') return { thinkingBudget: 1024 };
        return { thinkingBudget: 4096 };
    }

    _buildStreamPayload(contents, systemInstruction, thinkingMode, modelId = '') {
        const payload = {
            contents: contents,
            system_instruction: {
                parts: [{ text: systemInstruction }]
            }
        };

        if (thinkingMode) {
            payload.generationConfig = {
                thinkingConfig: this._getThinkingConfig(thinkingMode, modelId)
            };
        }

        return payload;
    }

    _isThinkingConfigError(error) {
        const message = (error?.message || '').toLowerCase();
        return error?.statusCode === 400 &&
            (message.includes('thinking') || message.includes('generationconfig') || message.includes('unknown field'));
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
            'gemini-flash-lite-latest',
            'gemini-3.1-flash-lite',
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

    _isOverloaded(error) {
        const message = (error?.message || '').toLowerCase();
        return error?.statusCode === 503 || message.includes('overloaded') || message.includes('busy');
    }

    async _delay(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async _consumeDebugForced503() {
        if (!chrome.runtime?.id) return false;

        try {
            const result = await chrome.storage.local.get(['ETSY_AI_DEBUG_FORCE_GEMINI_503_ONCE']);
            if (!result.ETSY_AI_DEBUG_FORCE_GEMINI_503_ONCE) return false;
            await chrome.storage.local.set({ ETSY_AI_DEBUG_FORCE_GEMINI_503_ONCE: false });
            return true;
        } catch (error) {
            console.warn('Failed to read Gemini debug 503 flag:', error);
            return false;
        }
    }

    async streamMessage({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError, onStatus, abortSignal }) {
        const models = this._buildFallbackList(modelId);
        let lastError = null;
        let chunkDelivered = false;
        let forceDebug503 = await this._consumeDebugForced503();
        const startedAt = Date.now();
        this.lastRequestDiagnostics = {
            provider: this.getProviderName(),
            requestedModel: modelId,
            promptChars: this._getPromptSize(messages, systemInstruction),
            thinkingMode: this._selectThinkingMode(messages, systemInstruction),
            attempts: []
        };
        const thinkingMode = this.lastRequestDiagnostics.thinkingMode;

        const wrappedOnChunk = (chunk, fullText) => {
            chunkDelivered = true;
            if (onChunk) onChunk(chunk, fullText);
        };

        for (let i = 0; i < models.length; i++) {
            const currentModel = models[i];
            const remainingBudgetMs = this.totalRequestBudgetMs - (Date.now() - startedAt);

            if (remainingBudgetMs < this.minimumAttemptBudgetMs) {
                lastError = new Error(`Gemini fallback timed out after ${Math.round(this.totalRequestBudgetMs / 1000)}s`);
                break;
            }

            const attemptStartedAt = Date.now();
            const attemptTimeoutMs = Math.min(this.requestTimeoutMs, remainingBudgetMs);

            try {
                if (forceDebug503) {
                    forceDebug503 = false;
                    const debugError = new Error('Debug forced Gemini 503 overloaded');
                    debugError.statusCode = 503;
                    debugError.debugForced = true;
                    throw debugError;
                }

                const result = await this._streamMessageInternal({
                    modelId: currentModel,
                    apiKey,
                    messages,
                    systemInstruction,
                    onChunk: wrappedOnChunk,
                    onComplete,
                    timeoutMs: attemptTimeoutMs,
                    thinkingMode,
                    abortSignal
                });
                this.lastRequestDiagnostics.attempts.push({
                    modelId: currentModel,
                    durationMs: Date.now() - attemptStartedAt,
                    ok: true,
                    thinkingMode
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
                    thinkingMode,
                    debugForced: !!error?.debugForced,
                    statusCode: error?.statusCode || null,
                    error: error?.message || String(error)
                });

                if (!chunkDelivered && this._isThinkingConfigError(error)) {
                    const plainRetryBudgetMs = this.totalRequestBudgetMs - (Date.now() - startedAt);
                    if (plainRetryBudgetMs < this.minimumAttemptBudgetMs) {
                        break;
                    }
                    const retryStartedAt = Date.now();
                    try {
                        const result = await this._streamMessageInternal({
                            modelId: currentModel,
                            apiKey,
                            messages,
                            systemInstruction,
                            onChunk: wrappedOnChunk,
                            onComplete,
                            timeoutMs: Math.min(this.requestTimeoutMs, plainRetryBudgetMs),
                            thinkingMode: null,
                            abortSignal
                        });
                        this.lastRequestDiagnostics.attempts.push({
                            modelId: currentModel,
                            durationMs: Date.now() - retryStartedAt,
                            ok: true,
                            retryWithoutThinkingConfig: true
                        });
                        return result;
                    } catch (plainRetryError) {
                        lastError = plainRetryError;
                        this.lastRequestDiagnostics.attempts.push({
                            modelId: currentModel,
                            durationMs: Date.now() - retryStartedAt,
                            ok: false,
                            retryWithoutThinkingConfig: true,
                            statusCode: plainRetryError?.statusCode || null,
                            error: plainRetryError?.message || String(plainRetryError)
                        });
                        error = plainRetryError;
                    }
                }

                // If we've already started streaming to the UI, we can't silently switch models
                if (chunkDelivered) break;

                // Non-retryable (e.g. bad API key) — stop immediately
                if (!this._shouldFallback(error)) break;

                if (this._isOverloaded(error)) {
                    for (let retryIndex = 0; retryIndex < this.overloadedRetryDelaysMs.length; retryIndex++) {
                        const retryDelayMs = this.overloadedRetryDelaysMs[retryIndex];
                        const retryRemainingBudgetMs = this.totalRequestBudgetMs - (Date.now() - startedAt) - retryDelayMs;
                        if (retryRemainingBudgetMs < this.minimumAttemptBudgetMs) break;

                        if (onStatus) {
                            onStatus({
                                type: 'retry',
                                modelId: currentModel,
                                nextModelId: null,
                                delayMs: retryDelayMs,
                                retryNumber: retryIndex + 1,
                                maxRetries: this.overloadedRetryDelaysMs.length,
                                message: 'Gemini is busy. Retrying the same model...'
                            });
                        }
                        await this._delay(retryDelayMs);

                        const retryStartedAt = Date.now();
                        try {
                            const result = await this._streamMessageInternal({
                                modelId: currentModel,
                                apiKey,
                                messages,
                                systemInstruction,
                                onChunk: wrappedOnChunk,
                                onComplete,
                                timeoutMs: Math.min(this.requestTimeoutMs, retryRemainingBudgetMs),
                                thinkingMode,
                                abortSignal
                            });
                            this.lastRequestDiagnostics.attempts.push({
                                modelId: currentModel,
                                durationMs: Date.now() - retryStartedAt,
                                ok: true,
                                retry: true,
                                retryNumber: retryIndex + 1,
                                thinkingMode
                            });
                            return result;
                        } catch (retryError) {
                            lastError = retryError;
                            this.lastRequestDiagnostics.attempts.push({
                                modelId: currentModel,
                                durationMs: Date.now() - retryStartedAt,
                                ok: false,
                                retry: true,
                                retryNumber: retryIndex + 1,
                                thinkingMode,
                                statusCode: retryError?.statusCode || null,
                                error: retryError?.message || String(retryError)
                            });

                            if (chunkDelivered) break;
                            if (!this._shouldFallback(retryError)) break;
                            if (!this._isOverloaded(retryError)) {
                                error = retryError;
                                break;
                            }
                        }
                    }
                }

                if (chunkDelivered) break;

                // Try the next model if any remain
                if (i < models.length - 1) {
                    if (onStatus) {
                        onStatus({
                            type: 'fallback',
                            modelId: currentModel,
                            nextModelId: models[i + 1],
                            delayMs: 0,
                            message: 'Gemini is still busy. Trying the next fallback model...'
                        });
                    }
                    console.log(`🔄 Gemini fallback: "${currentModel}" failed (${error.message}) → trying "${models[i + 1]}"`);
                    continue;
                }
            }
        }

        if (onError) onError(lastError);
        throw lastError;
    }

    async _streamMessageInternal({ modelId, apiKey, messages, systemInstruction, onChunk, onComplete, onError, attempt = 0, timeoutMs = this.requestTimeoutMs, thinkingMode = null, abortSignal = null }) {
        const url = `${this.getApiEndpoint()}${modelId}:streamGenerateContent?alt=sse`;

        const contents = this._formatMessagesForGemini(messages);

        const payload = this._buildStreamPayload(contents, systemInstruction, thinkingMode, modelId);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let externalAbortHandler = null;

        if (abortSignal) {
            if (abortSignal.aborted) controller.abort();
            externalAbortHandler = () => controller.abort();
            abortSignal.addEventListener('abort', externalAbortHandler, { once: true });
        }

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
                if (abortSignal?.aborted) {
                    const stopError = new Error('AI request was stopped.');
                    stopError.cancelled = true;
                    throw stopError;
                }
                throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
            }
            // Don't call onError during retry attempts - let the outer streamMessage handle it
            throw error;
        } finally {
            clearTimeout(timeoutId);
            if (abortSignal && externalAbortHandler) {
                abortSignal.removeEventListener('abort', externalAbortHandler);
            }
        }
    }
}

// Export as a global class
window.GeminiService = GeminiService;


