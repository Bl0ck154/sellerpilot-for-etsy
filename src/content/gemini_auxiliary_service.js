// gemini_auxiliary_service.js - Shared resilient Gemini calls for derived context.

window.GeminiAuxiliaryService = (function () {
    function modelChain() {
        return [...new Set([
            ...(window.ETSY_AI_GEMINI_FALLBACK_CHAIN || []),
            'gemini-flash-latest'
        ].filter(Boolean))];
    }

    async function generateContent({ apiKey, body, timeoutMs = 30000 }) {
        if (!apiKey) throw new Error('Gemini API key is not configured.');
        let lastError = null;
        const attempts = [];

        for (const model of modelChain()) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                attempts.push({ model, status: response.status });
                if (response.ok) return { data: await response.json(), model, attempts };

                const error = new Error(`Gemini auxiliary request failed: ${response.status}`);
                error.statusCode = response.status;
                lastError = error;
                if ([401, 403].includes(response.status)) break;
                if (![400, 404, 408, 429, 500, 502, 503, 504].includes(response.status)) break;
            } catch (error) {
                lastError = error;
                attempts.push({ model, error: error?.name || 'network_error' });
                if (error?.name === 'AbortError') continue;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        if (lastError) lastError.attempts = attempts;
        throw lastError || new Error('No Gemini auxiliary model is available.');
    }

    return { generateContent };
})();
