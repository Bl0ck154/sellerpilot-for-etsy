// agent_ai_budget_guard.js - Prevents redundant auxiliary model calls when direct context already exists.
(() => {
    'use strict';

    if (window.__ETSY_AI_BUDGET_GUARD__) return;
    window.__ETSY_AI_BUDGET_GUARD__ = true;

    function isMessagesPage() {
        try { return /^\/messages(?:\/|$)/.test(location.pathname || ''); }
        catch (_) { return false; }
    }

    const shopManager = window.ShopIntelligenceManager;
    if (shopManager && !shopManager.__etsyBudgetGuarded) {
        const originalBootstrap = shopManager.maybeBootstrap?.bind(shopManager);
        const originalRefresh = shopManager.refresh?.bind(shopManager);

        if (originalBootstrap) {
            shopManager.maybeBootstrap = function (...args) {
                if (isMessagesPage()) return false;
                return originalBootstrap(...args);
            };
        }
        if (originalRefresh) {
            shopManager.refresh = async function (...args) {
                if (isMessagesPage()) return false;
                return originalRefresh(...args);
            };
        }
        shopManager.__etsyBudgetGuarded = true;
    }

    const imageManager = window.ImageIntelligenceManager;
    if (imageManager && !imageManager.__etsyBackgroundSilent && typeof imageManager.analyzeCurrentCustomerImages === 'function') {
        const originalAnalyzeImages = imageManager.analyzeCurrentCustomerImages.bind(imageManager);
        imageManager.analyzeCurrentCustomerImages = function (options = {}) {
            if (options?.waitForCompletion === true) return originalAnalyzeImages(options);
            return originalAnalyzeImages({ ...options, onStatus: undefined, waitForCompletion: false });
        };
        imageManager.__etsyBackgroundSilent = true;
    }

    const auxiliary = window.GeminiAuxiliaryService;
    if (auxiliary && !auxiliary.__etsyBudgetGuarded && typeof auxiliary.generateContent === 'function') {
        const originalGenerate = auxiliary.generateContent.bind(auxiliary);
        auxiliary.generateContent = async function (params = {}) {
            const firstText = params?.body?.contents?.flatMap(content => content?.parts || [])
                .find(part => typeof part?.text === 'string')?.text || '';

            if (isMessagesPage() && firstText.includes('Create a compact evidence map for an Etsy assistant.')) {
                return {
                    data: {
                        candidates: [{
                            content: {
                                parts: [{ text: '{"observations":[],"uncertainties":[]}' }]
                            }
                        }]
                    },
                    skippedByBudgetGuard: true
                };
            }
            return originalGenerate(params);
        };
        auxiliary.__etsyBudgetGuarded = true;
    }

    window.EtsyAiBudgetGuard = { isMessagesPage };
})();
