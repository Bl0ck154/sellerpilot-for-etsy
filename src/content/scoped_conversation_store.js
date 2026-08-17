// scoped_conversation_store.js - Per-conversation transient Etsy context for multi-tab safety.
window.ScopedConversationStore = (function () {
    'use strict';
    const PREFIX='ETSY_AI_CONVO_SCOPE_';
    // Legacy global keys are kept only as a compatibility mirror while scoped keys are canonical.
    const LEGACY={history:'ETSY_CHAT_HISTORY',listingId:'ETSY_CURRENT_LISTING_ID',listingScope:'ETSY_CURRENT_LISTING_SCOPE',facts:'ETSY_AI_ACTIVE_CONTEXT_FACTS'};
    const id=v=>v===null||v===undefined?'':String(v).trim();
    const currentConversationId=()=>{try{return location.pathname.match(/^\/messages\/(\d+)/)?.[1]||null;}catch(_){return null;}};
    const keys=convoId=>{const c=id(convoId);return{history:`${PREFIX}${c}_HISTORY`,listing:`${PREFIX}${c}_LISTING`,facts:`${PREFIX}${c}_FACTS`};};
    async function get(k){if(!chrome?.runtime?.id)return{};try{return await chrome.storage.local.get(k);}catch(e){console.warn('ScopedConversationStore: read failed',e);return{};}}
    async function set(v){if(!chrome?.runtime?.id)return false;try{await chrome.storage.local.set(v);return true;}catch(e){console.warn('ScopedConversationStore: write failed',e);return false;}}
    async function remove(k){if(!chrome?.runtime?.id)return false;try{await chrome.storage.local.remove(k);}catch(e){console.warn('ScopedConversationStore: remove failed',e);return false;}return true;}

    async function getHistory(convoId=currentConversationId()){
        const c=id(convoId);if(!c)return null;const key=keys(c).history,s=await get([key,LEGACY.history]),scoped=s[key];
        if(id(scoped?.convo_id||scoped?.conversation_id)===c)return scoped;
        const legacy=s[LEGACY.history];if(id(legacy?.convo_id||legacy?.conversation_id)===c){await set({[key]:legacy});return legacy;}return null;
    }
    async function setHistory(history,{mirrorLegacy=true}={}){const c=id(history?.convo_id||history?.conversation_id);if(!c)return false;const v={[keys(c).history]:history};if(mirrorLegacy)v[LEGACY.history]=history;return set(v);}
    async function clearHistory(convoId,{clearLegacyIfMatching=true}={}){const c=id(convoId);if(!c)return false;const r=[keys(c).history];if(clearLegacyIfMatching){const s=await get([LEGACY.history]),legacy=s[LEGACY.history];if(id(legacy?.convo_id||legacy?.conversation_id)===c)r.push(LEGACY.history);}return remove(r);}

    async function getListing(convoId=currentConversationId()){
        const c=id(convoId);if(!c)return null;const key=keys(c).listing,s=await get([key,LEGACY.listingId,LEGACY.listingScope]),scoped=s[key];
        if(id(scoped?.convoId)===c&&id(scoped?.listingId))return scoped;
        const legacyId=id(s[LEGACY.listingId]),scope=s[LEGACY.listingScope];if(legacyId&&id(scope?.convoId)===c&&id(scope?.listingId)===legacyId){const migrated={...scope,convoId:c,listingId:legacyId};await set({[key]:migrated});return migrated;}return null;
    }
    async function setListing(convoId,listingId,extra={}, {mirrorLegacy=true}={}){const c=id(convoId),listing=id(listingId);if(!c||!listing)return false;const scope={...extra,convoId:c,listingId:listing,updatedAt:Number(extra.updatedAt)||Date.now()},v={[keys(c).listing]:scope};if(mirrorLegacy){v[LEGACY.listingId]=listing;v[LEGACY.listingScope]=scope;}return set(v);}
    async function clearListing(convoId,{clearLegacyIfMatching=true}={}){const c=id(convoId);if(!c)return false;const r=[keys(c).listing];if(clearLegacyIfMatching){const s=await get([LEGACY.listingScope]);if(id(s[LEGACY.listingScope]?.convoId)===c)r.push(LEGACY.listingId,LEGACY.listingScope);}return remove(r);}

    async function getFacts(convoId=currentConversationId()){
        const c=id(convoId);if(!c)return null;const key=keys(c).facts,s=await get([key,LEGACY.facts]),scoped=s[key];if(id(scoped?.convoId)===c)return scoped;
        const legacy=s[LEGACY.facts];if(id(legacy?.convoId)===c){await set({[key]:legacy});return legacy;}return null;
    }
    async function setFacts(facts,{mirrorLegacy=true}={}){const c=id(facts?.convoId);if(!c)return false;const v={[keys(c).facts]:facts};if(mirrorLegacy)v[LEGACY.facts]=facts;return set(v);}
    async function clearFacts(convoId,{clearLegacyIfMatching=true}={}){const c=id(convoId);if(!c)return false;const r=[keys(c).facts];if(clearLegacyIfMatching){const s=await get([LEGACY.facts]);if(id(s[LEGACY.facts]?.convoId)===c)r.push(LEGACY.facts);}return remove(r);}
    return{PREFIX,LEGACY,keys,currentConversationId,getHistory,setHistory,clearHistory,getListing,setListing,clearListing,getFacts,setFacts,clearFacts};
})();
