// agent_vision_metadata_guard.js - Prevents stale vision diagnostics from leaking across Etsy conversations.
(() => {
    'use strict';

    const manager = window.ImageIntelligenceManager;
    if (!manager || manager.__etsyVisionMetadataScoped) return;

    let metadataConversationId = null;
    const originalAnalyze = manager.analyzeCurrentCustomerImages.bind(manager);
    const originalGetMetadata = manager.getMetadata.bind(manager);

    function currentConversationId() {
        return location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function emptyMetadata() {
        return {
            imageIntelCount: 0,
            imageIntelCustomerCount: 0,
            imageIntelUnknownRoleCount: 0,
            imageIntelAvailableCount: 0,
            imageIntelFailedCount: 0,
            imageIntelOversizedCount: 0,
            imageIntelDeferredCount: 0,
            imageIntelPendingCount: 0,
            imageIntelCoverage: 0,
            imageIntelAnalyzedThisRequest: 0,
            imageIntelQueuedThisRequest: 0,
            imageIntelBatchCallsThisRequest: 0,
            imageIntelErrors: []
        };
    }

    async function hasHydratedLiveHistory(conversationId) {
        if (!conversationId || !chrome?.runtime?.id) return false;
        try {
            const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
            const history = result.ETSY_CHAT_HISTORY;
            if (window.EtsyAgentScopeGuard?.historyMatchesLive) {
                return window.EtsyAgentScopeGuard.historyMatchesLive(history);
            }
            return String(history?.convo_id || history?.conversation_id || '') === String(conversationId);
        } catch (_) {
            return false;
        }
    }

    manager.analyzeCurrentCustomerImages = async function (...args) {
        const conversationId = currentConversationId();
        if (!(await hasHydratedLiveHistory(conversationId))) {
            metadataConversationId = null;
            return emptyMetadata();
        }

        const result = await originalAnalyze(...args);
        if (conversationId &&
            currentConversationId() === conversationId &&
            await hasHydratedLiveHistory(conversationId)) {
            metadataConversationId = conversationId;
        }
        return result;
    };

    manager.getMetadata = function () {
        const conversationId = currentConversationId();
        if (!conversationId || metadataConversationId !== conversationId) return emptyMetadata();
        return originalGetMetadata();
    };

    const invalidate = () => {
        metadataConversationId = null;
    };
    window.addEventListener('etsy-ai-locationchange', invalidate);
    window.addEventListener('popstate', invalidate);
    window.addEventListener('hashchange', invalidate);

    manager.__etsyVisionMetadataScoped = true;
})();