// agent_vision_metadata_guard.js - Prevents stale Vision diagnostics across Etsy conversations/tabs.
(() => {
    'use strict';
    const manager=window.ImageIntelligenceManager;if(!manager||manager.__etsyVisionMetadataScoped)return;
    let metadataConversationId=null;const originalAnalyze=manager.analyzeCurrentCustomerImages.bind(manager),originalGetMetadata=manager.getMetadata.bind(manager);
    const currentConversationId=()=>location.pathname.match(/^\/messages\/(\d+)/)?.[1]||null;
    function emptyMetadata(){return{imageIntelCount:0,imageIntelCustomerCount:0,imageIntelOwnerCount:0,imageIntelUnknownRoleCount:0,imageIntelAvailableCount:0,imageIntelFailedCount:0,imageIntelOversizedCount:0,imageIntelDeferredCount:0,imageIntelPendingCount:0,imageIntelCoverage:0,imageIntelAnalyzedThisRequest:0,imageIntelQueuedThisRequest:0,imageIntelBatchCallsThisRequest:0,imageIntelErrors:[]};}
    async function liveHistory(conversationId){if(!conversationId||!chrome?.runtime?.id)return null;try{if(window.ScopedConversationStore)return await window.ScopedConversationStore.getHistory(conversationId);const s=await chrome.storage.local.get(['ETSY_CHAT_HISTORY']),h=s.ETSY_CHAT_HISTORY;return String(h?.convo_id||h?.conversation_id||'')===String(conversationId)?h:null;}catch(_){return null;}}
    manager.analyzeCurrentCustomerImages=async function(...args){const convoId=currentConversationId();if(!(await liveHistory(convoId))){metadataConversationId=null;return emptyMetadata();}const result=await originalAnalyze(...args);if(convoId&&currentConversationId()===convoId&&await liveHistory(convoId))metadataConversationId=convoId;return result;};
    manager.getMetadata=function(){const convoId=currentConversationId();if(!convoId||metadataConversationId!==convoId)return emptyMetadata();return originalGetMetadata();};
    const invalidate=()=>{metadataConversationId=null;};window.addEventListener('etsy-ai-locationchange',invalidate);window.addEventListener('popstate',invalidate);window.addEventListener('hashchange',invalidate);manager.__etsyVisionMetadataScoped=true;
})();
