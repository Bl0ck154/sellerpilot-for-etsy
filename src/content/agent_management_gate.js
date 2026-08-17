// agent_management_gate.js - Local-first management routing for memory and saved quick replies.
(() => {
    'use strict';

    if (!window.AIServiceFactory || window.__ETSY_AI_MANAGEMENT_GATE__) return;
    window.__ETSY_AI_MANAGEMENT_GATE__ = true;

    const MANAGEMENT_PROMPT_MARKER =
        "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";
    const MEMORY_DECISION_PROMPT_MARKER =
        "You classify the Owner's reply to a pending memory confirmation.";

    function normalized(value) {
        return String(value || '').trim().replace(/[’ʼ`]/g, "'");
    }

    function result(domain = 'none', action = 'none', fields = {}) {
        return JSON.stringify({
            domain,
            action,
            text: fields.text || '',
            keyword: fields.keyword || '',
            target: fields.target || '',
            label: fields.label || '',
            confidence: fields.confidence ?? 1
        });
    }

    function noneClassification() {
        return result('none', 'none');
    }

    function memoryDecision(decision, confidence = 1) {
        return JSON.stringify({ decision, confidence });
    }

    function stripCommandTail(value) {
        return normalized(value)
            .replace(/^[\s:,.\-–—]+/, '')
            .replace(/^(?:that|this|що|шо|что)\s+/i, '')
            .trim();
    }

    function deterministicManagementIntent(text) {
        const value = normalized(text);
        if (!value) return null;

        if (/^(?:please\s+)?(?:clear|erase|delete)\s+(?:all\s+)?(?:my\s+)?memory\s*[.!]?$/i.test(value) ||
            /^(?:очисти|видали|стерти|зітри)\s+(?:всю\s+)?пам['']?ять\s*[.!]?$/iu.test(value) ||
            /^(?:очисти|удали|сотри)\s+(?:всю\s+)?память\s*[.!]?$/iu.test(value)) {
            return result('memory', 'clear');
        }

        const rememberPatterns = [
            /^(?:please\s+)?remember\b([\s\S]*)$/i,
            /^(?:please\s+)?(?:save|store)\s+(?:this\s+)?(?:to|in)\s+(?:your\s+)?memory\b([\s\S]*)$/i,
            /^(?:запам['']?ятай|запамятай)\b([\s\S]*)$/iu,
            /^(?:збережи|додай)\s+(?:це\s+)?(?:в|до)\s+пам['']?ят(?:ь|і)\b([\s\S]*)$/iu,
            /^(?:запомни)\b([\s\S]*)$/iu,
            /^(?:сохрани|добавь)\s+(?:это\s+)?(?:в|в\s+мою)\s+память\b([\s\S]*)$/iu
        ];
        for (const pattern of rememberPatterns) {
            const match = value.match(pattern);
            if (!match) continue;
            const body = stripCommandTail(match[1]);
            if (!body || /^(?:what|when|where|who|why|how)\b/i.test(body)) return null;
            return result('memory', 'add', { text: body });
        }

        const forgetPatterns = [
            /^(?:please\s+)?forget\b([\s\S]*)$/i,
            /^(?:please\s+)?(?:remove|delete)\s+(.+?)\s+from\s+(?:your\s+)?memory\s*[.!]?$/i,
            /^(?:забудь)\b([\s\S]*)$/iu,
            /^(?:видали|прибери)\s+(.+?)\s+(?:з|із)\s+пам['']?ят(?:і|и)\s*[.!]?$/iu,
            /^(?:удали|убери)\s+(.+?)\s+из\s+памяти\s*[.!]?$/iu
        ];
        for (const pattern of forgetPatterns) {
            const match = value.match(pattern);
            if (!match) continue;
            const keyword = stripCommandTail(match[1]);
            if (keyword) return result('memory', 'remove', { keyword, text: keyword });
        }

        if (/^(?:show|list)\s+(?:my\s+)?(?:saved\s+)?quick\s*repl(?:y|ies)\s*[.!]?$/i.test(value) ||
            /^(?:покажи|покажи мені|список)\s+(?:збережен\w+\s+)?(?:швидк\w+\s+)?(?:відповід\w+|репл\w+)\s*[.!]?$/iu.test(value) ||
            /^(?:покажи|список)\s+(?:сохраненн\w+\s+)?(?:быстр\w+\s+)?(?:ответ\w+|репл\w+)\s*[.!]?$/iu.test(value)) {
            return result('quick_reply', 'list');
        }

        return null;
    }

    function looksLikeExplicitManagement(text) {
        if (deterministicManagementIntent(text)) return true;
        const value = normalized(text).toLowerCase();
        if (!value) return false;

        const memoryPatterns = [
            /\bmemory\b.{0,80}\b(add|save|store|remove|delete|clear|forget|update)\b/i,
            /\b(forget|clear|delete|remove)\b.{0,80}\b(memory|remembered|saved fact|preference)\b/i,
            /(пам['']?ят|памят).{0,80}(збереж|дод|видал|очист|забуд|сохран|удал|запом)/iu
        ];
        if (memoryPatterns.some(pattern => pattern.test(value))) return true;

        return /(quick\s*repl(?:y|ies)|saved\s+repl(?:y|ies)|reply\s+template|швидк\w*\s+(?:відпов|репл)|шаблон\w*\s+(?:відпов|репл)|быстр\w*\s+(?:ответ|репл)|шаблон\w*\s+(?:ответ|репл))/iu.test(value);
    }

    function extractPendingOwnerReply(raw) {
        const text = normalized(raw);
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.ownerReply === 'string') return normalized(parsed.ownerReply);
        } catch (_) { }
        return text;
    }

    function deterministicMemoryDecision(raw) {
        const value = extractPendingOwnerReply(raw).toLowerCase();
        if (!value) return memoryDecision('unclear', 1);

        if (/^(?:yes|yep|yeah|ok|okay|sure|confirm|confirmed|proceed|do it|go ahead|remove them|remove all|clear it|clear all|так|ага|так,?\s*(?:давай|роби|видаляй|очищай)?|звісно|добре|да|ага|да,?\s*(?:давай|делай|удаляй|очищай)?)\s*[.!]?$/iu.test(value)) {
            return memoryDecision('accept', 1);
        }
        if (/^(?:no|nope|cancel|stop|leave it|leave memory unchanged|don't|do not|ні|не треба|скасуй|залиш як є|нет|не надо|отмена|оставь как есть)\s*[.!]?$/iu.test(value)) {
            return memoryDecision('reject', 1);
        }
        return memoryDecision('unclear', 1);
    }

    function normalizeClassifierResult(raw) {
        const text = String(raw || '').trim();
        if (!text) return text;
        try {
            const clean = text
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();
            const parsed = JSON.parse(clean);
            if (parsed?.action === 'offer') return noneClassification();
            return text;
        } catch (_) {
            return text;
        }
    }

    function emitLocal(params, raw) {
        params.onChunk?.(raw, raw);
        params.onComplete?.(raw);
        return raw;
    }

    function wrapService(service) {
        if (!service || service.__etsyManagementGated || typeof service.streamMessage !== 'function') return service;

        const originalStreamMessage = service.streamMessage.bind(service);
        service.streamMessage = async function (params = {}) {
            const systemInstruction = String(params.systemInstruction || '');
            const latestOwnerText = [...(params.messages || [])]
                .reverse()
                .find(message => message?.role === 'user')?.content || '';

            if (systemInstruction.includes(MEMORY_DECISION_PROMPT_MARKER)) {
                return emitLocal(params, deterministicMemoryDecision(latestOwnerText));
            }

            if (!systemInstruction.includes(MANAGEMENT_PROMPT_MARKER)) {
                return originalStreamMessage(params);
            }

            const deterministic = deterministicManagementIntent(latestOwnerText);
            if (deterministic) return emitLocal(params, deterministic);

            if (!looksLikeExplicitManagement(latestOwnerText)) {
                return emitLocal(params, noneClassification());
            }

            let captured = '';
            const resultValue = await originalStreamMessage({
                ...params,
                systemInstruction: `${systemInstruction}\n\nIMPORTANT: action=offer is disabled. Return domain=none/action=none unless the Owner explicitly asked to manage persistent memory or saved quick replies.`,
                onChunk: (_chunk, fullText) => { captured = fullText || captured; },
                onComplete: fullText => { captured = fullText || captured; }
            });
            const output = normalizeClassifierResult(captured || resultValue || '');
            return emitLocal(params, output);
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
        deterministicManagementIntent,
        deterministicMemoryDecision,
        noneClassification,
        normalizeClassifierResult
    };
})();
