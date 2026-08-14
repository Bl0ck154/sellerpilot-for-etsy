// providers/custom_openai_service.js - User-configured OpenAI-compatible endpoint.

class CustomOpenAIService extends BaseAIService {
    constructor() {
        super();
        this.lastRequestDiagnostics = { attempts: [] };
    }

    getProviderName() {
        return 'custom';
    }

    getApiEndpoint() {
        return '';
    }

    async _loadSettings() {
        const result = await chrome.storage.local.get([
            'custom_base_url',
            'custom_api_key',
            'custom_model',
            'custom_fallback_provider'
        ]);
        return {
            baseUrl: String(result.custom_base_url || '').trim(),
            apiKey: String(result.custom_api_key || '').trim(),
            model: String(result.custom_model || '').trim(),
            fallbackProvider: String(result.custom_fallback_provider || 'none').trim().toLowerCase()
        };
    }

    _chatCompletionsUrl(baseUrl) {
        let parsed;
        try {
            parsed = new URL(baseUrl);
        } catch (_) {
            throw new Error('Custom provider URL is invalid.');
        }
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new Error('Custom provider URL must be an HTTP(S) URL without embedded credentials.');
        }
        const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        if (parsed.protocol === 'http:' && !localHost) {
            throw new Error('Custom provider URL must use HTTPS unless it is a local server.');
        }
        if (parsed.search || parsed.hash) {
            throw new Error('Custom provider URL cannot contain a query or fragment.');
        }
        const clean = parsed.toString().replace(/\/+$/, '');
        return /\/chat\/completions$/i.test(parsed.pathname)
            ? clean
            : `${clean}/chat/completions`;
    }

    _headers(apiKey) {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        return headers;
    }

    _errorFromResponse(status, body) {
        const message = body?.error?.message || body?.message || `Custom provider API error: ${status}`;
        const error = new Error(message);
        error.statusCode = status;
        return error;
    }

    _extractText(data) {
        const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.delta?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
        }
        return '';
    }

    async _streamViaBackground({ modelId, messages, systemInstruction, onChunk, onComplete, abortSignal }) {
        return new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({ name: 'custom-ai-stream' });
            let settled = false;
            const finish = callback => value => {
                if (settled) return;
                settled = true;
                abortSignal?.removeEventListener('abort', relayAbort);
                try { port.disconnect(); } catch (_) { /* Already disconnected. */ }
                callback(value);
            };
            const fail = finish(reject);
            const succeed = finish(resolve);
            const relayAbort = () => {
                try { port.postMessage({ type: 'abort' }); } catch (_) { /* Port may already be closed. */ }
                const error = new DOMException('The request was aborted.', 'AbortError');
                fail(error);
            };

            port.onMessage.addListener(message => {
                if (message?.type === 'chunk') {
                    onChunk?.(message.chunk || '', message.fullText || '');
                    return;
                }
                if (message?.type === 'complete') {
                    Promise.resolve(onComplete?.(message.fullText || ''))
                        .then(() => succeed(message.fullText || ''))
                        .catch(fail);
                    return;
                }
                if (message?.type === 'error') {
                    const error = message.aborted
                        ? new DOMException(message.message || 'The request was aborted.', 'AbortError')
                        : new Error(message.message || 'Custom provider failed.');
                    if (message.statusCode) error.statusCode = message.statusCode;
                    fail(error);
                }
            });
            port.onDisconnect.addListener(() => {
                if (!settled) fail(new Error('Custom provider connection closed before completion.'));
            });
            abortSignal?.addEventListener('abort', relayAbort, { once: true });
            if (abortSignal?.aborted) {
                relayAbort();
                return;
            }
            port.postMessage({ type: 'start', modelId, messages, systemInstruction });
        });
    }

    async _streamInternal({ url, apiKey, modelId, messages, systemInstruction, onChunk, onComplete, abortSignal }) {
        if (chrome.runtime?.connect) {
            return this._streamViaBackground({ modelId, messages, systemInstruction, onChunk, onComplete, abortSignal });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new DOMException('Custom provider timed out.', 'TimeoutError')), 60000);
        const relayAbort = () => controller.abort(abortSignal.reason);
        abortSignal?.addEventListener('abort', relayAbort, { once: true });
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: this._headers(apiKey),
                body: JSON.stringify({
                    model: modelId,
                    messages: [{ role: 'system', content: systemInstruction }, ...messages],
                    stream: true
                }),
                redirect: 'error',
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
            abortSignal?.removeEventListener('abort', relayAbort);
        }

        if (!response.ok) {
            let body = null;
            try { body = await response.json(); } catch (_) { /* The status remains useful. */ }
            throw this._errorFromResponse(response.status, body);
        }

        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            const data = await response.json();
            if (data?.error) throw this._errorFromResponse(response.status, data);
            const text = this._extractText(data);
            if (!text) throw new Error('Custom provider returned no text.');
            onChunk?.(text, text);
            await onComplete?.(text);
            return text;
        }

        if (!response.body?.getReader) throw new Error('Custom provider returned an unreadable stream.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        const processLine = line => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            let data;
            try { data = JSON.parse(payload); } catch (_) { return; }
            if (data?.error) throw this._errorFromResponse(200, data);
            const text = this._extractText(data);
            if (!text) return;
            fullText += text;
            onChunk?.(text, fullText);
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) processLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
        if (!fullText) throw new Error('Custom provider returned no text.');
        await onComplete?.(fullText);
        return fullText;
    }

    async _fallback(settings, request, primaryError, receivedPrimaryOutput) {
        if (receivedPrimaryOutput || settings.fallbackProvider === 'none' || !settings.fallbackProvider) {
            throw primaryError;
        }
        if (settings.fallbackProvider === 'custom') throw primaryError;
        if (request.abortSignal?.aborted || primaryError?.name === 'AbortError') throw primaryError;

        const fallbackService = await window.AIServiceFactory.createService(settings.fallbackProvider);
        const fallbackModel = await window.AIServiceFactory.getModelId(settings.fallbackProvider);
        const fallbackApiKey = await window.AIServiceFactory.getApiKey(settings.fallbackProvider);
        if (settings.fallbackProvider !== 'openrouter' && !fallbackApiKey) {
            throw new Error(`Custom provider failed and the ${settings.fallbackProvider} fallback has no API key.`);
        }

        request.onStatus?.(`Custom provider unavailable. Trying ${settings.fallbackProvider}...`);
        this.lastRequestDiagnostics.attempts.push({
            provider: settings.fallbackProvider,
            modelId: fallbackModel,
            fallback: true
        });
        return fallbackService.streamMessage({
            ...request,
            modelId: fallbackModel,
            apiKey: fallbackApiKey,
            onError: null
        });
    }

    async streamMessage(request) {
        const settings = await this._loadSettings();
        const modelId = String(request.modelId || settings.model).trim();
        if (!settings.baseUrl) throw new Error('Configure the custom provider URL in Settings.');
        if (!modelId) throw new Error('Configure the custom provider model in Settings.');

        const url = this._chatCompletionsUrl(settings.baseUrl);
        let receivedPrimaryOutput = false;
        this.lastRequestDiagnostics = {
            attempts: [{ provider: 'custom', modelId, endpointOrigin: new URL(url).origin }]
        };

        try {
            return await this._streamInternal({
                ...request,
                url,
                apiKey: settings.apiKey || request.apiKey,
                modelId,
                onChunk: (chunk, fullText) => {
                    receivedPrimaryOutput = true;
                    request.onChunk?.(chunk, fullText);
                }
            });
        } catch (error) {
            this.lastRequestDiagnostics.attempts[0].error = error?.message || String(error);
            try {
                return await this._fallback(settings, request, error, receivedPrimaryOutput);
            } catch (finalError) {
                request.onError?.(finalError);
                throw finalError;
            }
        }
    }

    async generateChatTitle(userMessage, aiResponse, apiKey, modelId) {
        const settings = await this._loadSettings();
        const url = this._chatCompletionsUrl(settings.baseUrl);
        const response = await fetch(url, {
            method: 'POST',
            headers: this._headers(settings.apiKey || apiKey),
            body: JSON.stringify({
                model: modelId || settings.model,
                messages: [{ role: 'user', content: `Create a concise 3-7 word title for this exchange. Return only the title.\n\nOwner: ${userMessage}\nAssistant: ${aiResponse}` }],
                stream: false
            })
        });
        if (!response.ok) throw this._errorFromResponse(response.status, await response.json().catch(() => null));
        const text = this._extractText(await response.json()).trim();
        if (!text) throw new Error('Custom provider returned no title.');
        return text;
    }
}

window.CustomOpenAIService = CustomOpenAIService;
