// image_intelligence_manager.js - Gemini Vision summaries for customer-side Etsy attachments
// Stores text summaries only. Raw images are never stored.

window.ImageIntelligenceManager = (function () {
    const CACHE_KEY = 'ETSY_AI_IMAGE_INTELLIGENCE_CACHE';
    const VERSION = '2026-05-09.1';
    const TTL_MS = 14 * 24 * 60 * 60 * 1000;
    const MAX_IMAGES_PER_REQUEST = 2;
    const MAX_CONTEXT_CHARS = 1800;
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    let lastMetadata = {
        imageIntelCount: 0,
        imageIntelAnalyzedThisRequest: 0,
        imageIntelErrors: []
    };

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function trimText(text, maxChars) {
        if (!text || typeof text !== 'string') return '';
        const clean = text.replace(/\s+/g, ' ').trim();
        return clean.length > maxChars ? `${clean.slice(0, maxChars).trim()} [trimmed]` : clean;
    }

    async function getStorage(keys) {
        if (!chrome.runtime?.id) return {};
        try { return await chrome.storage.local.get(keys); }
        catch (error) { console.warn('ImageIntelligence: storage get failed', error); return {}; }
    }

    async function setStorage(data) {
        if (!chrome.runtime?.id) return false;
        try { await chrome.storage.local.set(data); return true; }
        catch (error) { console.warn('ImageIntelligence: storage set failed', error); return false; }
    }

    function isImageUrl(url = '') {
        return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /etsystatic\.com/i.test(url) || /i\.etsystatic\.com/i.test(url);
    }

    function getAttachmentUrl(att) {
        return att?.url || att?.fullsize_url || att?.image_url || att?.download_url || att?.thumb_url || att?.thumbnail_url || '';
    }

    function getImageUrlFromImageObject(img) {
        return img?.image_data?.url || img?.url || img?.fullsize_url || '';
    }

    function isCustomerMessage(msg, ownerIds) {
        const senderIds = [msg.sender_user_id, msg.sender_id, msg.user_id, msg.from_user_id]
            .filter(Boolean)
            .map(String);
        if (senderIds.length && senderIds.some(id => ownerIds.has(id))) return false;

        const roleText = `${msg.sender_type || ''} ${msg.role || ''} ${msg.author_role || ''}`.toLowerCase();
        if (/seller|shop|owner/.test(roleText)) return false;
        if (/buyer|customer/.test(roleText)) return true;

        // If Etsy doesn't expose sender IDs/roles, be conservative: skip instead of scanning owner files.
        return senderIds.length > 0;
    }

    function extractCustomerImages(chatHistory, ownerIds) {
        if (!chatHistory?.messages?.length) return [];
        const images = [];
        const seen = new Set();

        for (const msg of chatHistory.messages) {
            if (!isCustomerMessage(msg, ownerIds)) continue;

            for (const att of (msg.attachments || [])) {
                const url = getAttachmentUrl(att);
                const id = String(att.convo_message_attachment_id || att.attachment_id || url || '');
                if (!url || !isImageUrl(url) || seen.has(id)) continue;
                seen.add(id);
                images.push({
                    id,
                    url,
                    messageId: msg.message_id || msg.convo_message_id || null,
                    sender: msg.sender_display_name || 'Customer'
                });
            }

            for (const img of (msg.images || [])) {
                const url = getImageUrlFromImageObject(img);
                const id = String(img.image_id || url || '');
                if (!url || !isImageUrl(url) || seen.has(id)) continue;
                seen.add(id);
                images.push({
                    id,
                    url,
                    messageId: msg.message_id || msg.convo_message_id || null,
                    sender: msg.sender_display_name || 'Customer'
                });
            }
        }

        return images.slice(-6);
    }

    function extractCustomerImagesFromDom() {
        const images = [];
        const seen = new Set();
        const links = document.querySelectorAll('.quick-refunds-message-images a[href]');

        for (const link of links) {
            const nestedImage = link.querySelector('img[src]');
            const url = link.href || nestedImage?.src || '';
            if (!url || !isImageUrl(url) || seen.has(url)) continue;
            seen.add(url);
            images.push({
                id: `dom-${hashString(url)}`,
                url,
                messageId: null,
                sender: 'Customer'
            });
        }

        return images.slice(-6);
    }

    async function loadCache() {
        const result = await getStorage([CACHE_KEY]);
        return result[CACHE_KEY] && typeof result[CACHE_KEY] === 'object' ? result[CACHE_KEY] : {};
    }

    async function saveCache(cache) {
        const entries = Object.entries(cache)
            .filter(([, value]) => value?.updatedAt && Date.now() - value.updatedAt < TTL_MS)
            .slice(-40);
        await setStorage({ [CACHE_KEY]: Object.fromEntries(entries) });
    }

    async function fetchImageAsBase64(url) {
        const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
        if (!response.ok) throw new Error(`image fetch ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`not an image: ${blob.type}`);
        if (blob.size > MAX_IMAGE_BYTES) throw new Error(`image too large: ${blob.size}`);

        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
            reader.readAsDataURL(blob);
        });

        return {
            mimeType: blob.type || 'image/jpeg',
            base64: String(dataUrl).split(',')[1]
        };
    }

    function buildVisionPrompt() {
        return `Analyze this customer-provided Etsy message attachment for a seller reply assistant.
Do not identify private people. Do not infer sensitive traits. Focus only on work feasibility, visible quality, missing details, and safe reply wording.
Return JSON only:
{
  "imageType": "photo|reference|screenshot|document|other|unknown",
  "quality": "good|medium|poor|unknown",
  "visibleIssues": ["short issue"],
  "workRisks": ["short risk"],
  "missingDetailsNeeded": ["short detail"],
  "safeReplyGuidance": ["short guidance"],
  "doNotPromise": ["short warning"]
}`;
    }

    function parseJson(text) {
        const clean = (text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        return JSON.parse(clean);
    }

    async function analyzeImage(apiKey, image) {
        const { mimeType, base64 } = await fetchImageAsBase64(image.url);
        const model = window.ETSY_AI_GEMINI_FALLBACK_CHAIN?.[0] || 'gemini-flash-latest';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [
                            { text: buildVisionPrompt() },
                            { inline_data: { mime_type: mimeType, data: base64 } }
                        ]
                    }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
                }),
                signal: controller.signal
            });

            if (!response.ok) throw new Error(`Gemini vision ${response.status}`);
            const data = await response.json();
            return parseJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function formatSummary(image, data) {
        const lines = [`Image ${image.id}:`];
        if (data.imageType) lines.push(`- Type: ${data.imageType}`);
        if (data.quality) lines.push(`- Quality: ${data.quality}`);
        if (Array.isArray(data.visibleIssues) && data.visibleIssues.length) lines.push(`- Visible issues: ${data.visibleIssues.slice(0, 5).map(x => trimText(x, 90)).join('; ')}`);
        if (Array.isArray(data.workRisks) && data.workRisks.length) lines.push(`- Work risks: ${data.workRisks.slice(0, 5).map(x => trimText(x, 90)).join('; ')}`);
        if (Array.isArray(data.missingDetailsNeeded) && data.missingDetailsNeeded.length) lines.push(`- Missing details: ${data.missingDetailsNeeded.slice(0, 5).map(x => trimText(x, 90)).join('; ')}`);
        if (Array.isArray(data.safeReplyGuidance) && data.safeReplyGuidance.length) lines.push(`- Reply guidance: ${data.safeReplyGuidance.slice(0, 4).map(x => trimText(x, 120)).join('; ')}`);
        if (Array.isArray(data.doNotPromise) && data.doNotPromise.length) lines.push(`- Do not promise: ${data.doNotPromise.slice(0, 4).map(x => trimText(x, 120)).join('; ')}`);
        return lines.join('\n');
    }

    async function getCurrentCustomerImages() {
        const result = await getStorage(['ETSY_CHAT_HISTORY', 'ETSY_GLOBAL_USER_ID', 'ETSY_GLOBAL_SHOP_ID']);
        const ownerIds = new Set([result.ETSY_GLOBAL_USER_ID, result.ETSY_GLOBAL_SHOP_ID].filter(Boolean).map(String));
        const storedImages = extractCustomerImages(result.ETSY_CHAT_HISTORY, ownerIds);
        const domImages = extractCustomerImagesFromDom();
        const seen = new Set();

        return [...storedImages, ...domImages]
            .filter(image => {
                if (!image.url || seen.has(image.url)) return false;
                seen.add(image.url);
                return true;
            })
            .slice(-6);
    }

    async function analyzeCurrentCustomerImages({ limit = MAX_IMAGES_PER_REQUEST, onStatus } = {}) {
        lastMetadata = { imageIntelCount: 0, imageIntelAnalyzedThisRequest: 0, imageIntelErrors: [] };
        const result = await getStorage(['gemini_api_key']);
        const apiKey = result.gemini_api_key;
        if (!apiKey) return lastMetadata;

        const images = await getCurrentCustomerImages();
        if (!images.length) return lastMetadata;

        const cache = await loadCache();
        const fresh = (entry) => entry?.updatedAt && Date.now() - entry.updatedAt < TTL_MS;
        const missing = images.filter(image => !fresh(cache[hashString(image.url)])).slice(-limit);

        lastMetadata.imageIntelCount = images.length;
        if (!missing.length) return lastMetadata;

        onStatus?.(`Analyzing ${missing.length} customer image${missing.length === 1 ? '' : 's'}...`);

        for (const image of missing) {
            const key = hashString(image.url);
            try {
                const summaryJson = await analyzeImage(apiKey, image);
                cache[key] = {
                    version: VERSION,
                    id: image.id,
                    updatedAt: Date.now(),
                    summaryText: formatSummary(image, summaryJson),
                    summaryJson
                };
                lastMetadata.imageIntelAnalyzedThisRequest += 1;
            } catch (error) {
                console.warn('ImageIntelligence: image analysis failed', error);
                lastMetadata.imageIntelErrors.push(error.message || String(error));
            }
        }

        await saveCache(cache);
        return lastMetadata;
    }

    async function buildContextSection() {
        const images = await getCurrentCustomerImages();
        if (!images.length) return '';
        const cache = await loadCache();
        const sections = [];
        for (const image of images.slice(-MAX_IMAGES_PER_REQUEST)) {
            const entry = cache[hashString(image.url)];
            if (entry?.summaryText && Date.now() - entry.updatedAt < TTL_MS) sections.push(entry.summaryText);
        }
        const attachmentNotice = `${images.length} customer image attachment(s) are already present in the current conversation. Never ask the customer to send these photos again.`;
        if (!sections.length) {
            return `\n\n### CUSTOMER_IMAGE_CONTEXT\n${attachmentNotice}\n(Vision summaries are not available, so do not claim to know image contents.)`;
        }
        return `\n\n### CUSTOMER_IMAGE_CONTEXT\n${attachmentNotice}\n(Customer-side image attachments only. Text summaries from Gemini Vision; raw images are not stored.)\n${trimText(sections.join('\n\n'), MAX_CONTEXT_CHARS)}`;
    }

    function getMetadata() {
        return { ...lastMetadata };
    }

    return {
        VERSION,
        analyzeCurrentCustomerImages,
        buildContextSection,
        getMetadata
    };
})();
