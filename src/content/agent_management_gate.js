// agent_management_gate.js - Avoids an extra AI classifier call for ordinary Owner messages.
(() => {
    'use strict';

    if (!window.AIServiceFactory || window.__ETSY_AI_MANAGEMENT_GATE__) return;
    window.__ETSY_AI_MANAGEMENT_GATE__ = true;

    const MANAGEMENT_PROMPT_MARKER =
        "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";

    function looksLikeExplicitManagement(text) {
        const value = String(text || '').trim().toLowerCase();
        if (!value) return false;

        const memoryPatterns = [
            /\bremember\b.{0,80}\b(this|that|for future|in memory|preference|fact)\b/i,
            /\b(forget|clear|delete|remove)\b.{0,60}\b(memory|remembered|saved fact|preference)\b/i,
            /\bmemory\b.{0,60}\b(add|save|store|remove|delete|clear|forget|update)\b/i,
            /(запам['’ʼ]?ятай|запамятай|збережи.{0,40}пам['’ʼ]?ят|додай.{0,40}пам['’ʼ]?ят|забудь|очисти.{0,30}пам['’ʼ]?ят|видали.{0,30}пам['’ʼ]?ят)/iu,
            /(запомни|сохрани.{0,40}памят|добав.{0,40}памят|забудь|очисти.{0,30}памят|удали.{0,30}памят)/iu
        ];
        if (memoryPatterns.some(pattern => pattern.test(value))) return true;

        return /(quick\s*repl(?:y|ies)|saved\s+repl(?:y|ies)|reply\s+template|швидк\w*\s+(?:відпов|репл)|шаблон\w*\s+(?:відпов|репл)|быстр\w*\s+(?:ответ|репл)|шаблон\w*\s+(?:ответ|репл))/iu.test(value);
    }

    function noneClassification() {
        return JSON.stringify({
            domain: 'none',
            action: 'none',
            text: '',
            keyword: '',
            target: '',
            label: '',
            confidence: 1
        });
    }

    function wrapService(service) {
        if (!service || service.__etsyManagementGated || typeof service.streamMessage !== 'function') {
            return service;
        }

        const originalStreamMessage = service.streamMessage.bind(service);
        service.streamMessage = async function (params = {}) {
            const systemInstruction = String(params.systemInstruction || '');
            if (!systemInstruction.includes(MANAGEMENT_PROMPT_MARKER)) {
                return originalStreamMessage(params);
            }

            const latestOwnerText = [...(params.messages || [])]
                .reverse()
                .find(message => message?.role === 'user')?.content || '';

            if (!looksLikeExplicitManagement(latestOwnerText)) {
                const raw = noneClassification();
                params.onChunk?.(raw, raw);
                params.onComplete?.(raw);
                return raw;
            }

            // Explicit management requests still get semantic classification. Unsolicited
            // memory offers are intentionally disabled: saving durable facts must be an
            // Owner-initiated action, not a side effect of an ordinary conversation.
            return originalStreamMessage({
                ...params,
                systemInstruction: `${systemInstruction}\n\nIMPORTANT: action=offer is disabled. Return domain=none/action=none unless the Owner explicitly asked to manage persistent memory or saved quick replies.`
            });
        };
        service.__etsyManagementGated = true;
        return service;
    }

    const originalGetCurrentService = window.AIServiceFactory.getCurrentService.bind(window.AIServiceFactory);
    window.AIServiceFactory.getCurrentService = async function (...args) {
        return wrapService(await originalGetCurrentService(...args));
    };

    window.EtsyAgentManagementGate = {
        looksLikeExplicitManagement,
        noneClassification
    };
})();
