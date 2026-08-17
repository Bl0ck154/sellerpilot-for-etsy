// agent_image_request_gate.js - Gives explicit image questions a tiny bounded chance to use fresh background Vision.
(() => {
    'use strict';

    if (!window.AIServiceFactory || window.__ETSY_AI_IMAGE_REQUEST_GATE__) return;
    window.__ETSY_AI_IMAGE_REQUEST_GATE__ = true;

    const MAX_IMAGE_WAIT_MS = 1000;
    const MANAGEMENT_PROMPT_MARKER =
        "Classify whether the Owner's latest turn is an explicit request to manage assistant memory or reusable Etsy quick replies.";
    const MEMORY_DECISION_PROMPT_MARKER =
        "You classify the Owner's reply to a pending memory confirmation.";

    function isImageSpecificRequest(text) {
        const value = String(text || '').toLowerCase();
        if (!value.trim()) return false;
        return /(photo|image|picture|screenshot|attachment|portrait|face|faces|фото|фотограф|зображ|картин|скрін|скрин|вкладен|изображ|фотк|лиц[оа]|обличч)/iu.test(value);
    }

    function replaceImageContext(systemInstruction, imageContext) {
        let instruction = String(systemInstruction || '');
        const imageStart = instruction.indexOf('\n\n### CUSTOMER_IMAGE_CONTEXT');
        if (imageStart >= 0) {
            const tail = instruction.slice(imageStart + 2);
            const nextCandidates = [
                tail.indexOf('\n\n### ', '### CUSTOMER_IMAGE_CONTEXT'.length),
                tail.indexOf('\n\nNow I am on the page:', '### CUSTOMER_IMAGE_CONTEXT'.length),
                tail.indexOf('\n\n[PAGE_SCOPE:', '### CUSTOMER_IMAGE_CONTEXT'.length)
            ].filter(index => index >= 0);
            const relativeEnd = nextCandidates.length ? Math.min(...nextCandidates) : tail.length;
            instruction = instruction.slice(0, imageStart) + tail.slice(relativeEnd);
        }

        if (!imageContext) return instruction;
        const pageScopeIndex = instruction.lastIndexOf('\n\n[PAGE_SCOPE:');
        if (pageScopeIndex >= 0) {
            return `${instruction.slice(0, pageScopeIndex)}${imageContext}${instruction.slice(pageScopeIndex)}`;
        }
        return `${instruction}${imageContext}`;
    }

    function wrapService(service) {
        if (!service || service.__etsyImageRequestGated || typeof service.streamMessage !== 'function') return service;
        const originalStreamMessage = service.streamMessage.bind(service);

        service.streamMessage = async function (params = {}) {
            const systemInstruction = String(params.systemInstruction || '');
            if (systemInstruction.includes(MANAGEMENT_PROMPT_MARKER) ||
                systemInstruction.includes(MEMORY_DECISION_PROMPT_MARKER) ||
                !window.ImageIntelligenceManager) {
                return originalStreamMessage(params);
            }

            const currentOwnerTurn = [...(params.messages || [])]
                .reverse()
                .find(message => message?.role === 'user')?.content || '';
            if (!isImageSpecificRequest(currentOwnerTurn)) return originalStreamMessage(params);

            try {
                await window.ImageIntelligenceManager.waitForCurrentAnalysis?.(MAX_IMAGE_WAIT_MS);
                const freshImageContext = await window.ImageIntelligenceManager.buildContextSection?.();
                if (freshImageContext) {
                    params = {
                        ...params,
                        systemInstruction: replaceImageContext(systemInstruction, freshImageContext)
                    };
                }
            } catch (error) {
                console.debug('ImageRequestGate: bounded Vision wait skipped', error?.message || error);
            }
            return originalStreamMessage(params);
        };
        service.__etsyImageRequestGated = true;
        return service;
    }

    const originalGetCurrentService = window.AIServiceFactory.getCurrentService.bind(window.AIServiceFactory);
    window.AIServiceFactory.getCurrentService = async function (...args) {
        return wrapService(await originalGetCurrentService(...args));
    };

    window.EtsyAgentImageRequestGate = {
        MAX_IMAGE_WAIT_MS,
        isImageSpecificRequest,
        replaceImageContext
    };
})();
