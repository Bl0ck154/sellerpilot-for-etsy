// image_intelligence_manager.js - Cached Gemini Vision analysis for customer attachments.
// Raw image bytes are sent to Gemini when first analyzed and are never stored locally.

window.ImageIntelligenceManager = (function () {
    const CACHE_KEY = 'ETSY_AI_IMAGE_INTELLIGENCE_CACHE';
    const VERSION = '2026-08-14.4';
    const TTL_MS = 14 * 24 * 60 * 60 * 1000;
    const MAX_CONTEXT_CHARS = 30000;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const ANALYSIS_CONCURRENCY = 2;
    const FAILURE_RETRY_BASE_MS = 5 * 60 * 1000;
    const FAILURE_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
    const OVERSIZED_RETRY_MS = 24 * 60 * 60 * 1000;
    const MAX_FAILURE_ATTEMPTS = 8;

    const analysesInFlight = new Map();
    let cacheWriteQueue = Promise.resolve();
    let lastMetadata = createMetadata();

    function createMetadata() {
        return {
            imageIntelCount: 0,
            imageIntelCustomerCount: 0,
            imageIntelUnknownRoleCount: 0,
            imageIntelAvailableCount: 0,
            imageIntelFailedCount: 0,
            imageIntelOversizedCount: 0,
            imageIntelDeferredCount: 0,
            imageIntelCoverage: 0,
            imageIntelAnalyzedThisRequest: 0,
            imageIntelErrors: []
        };
    }

    function hashString(value) {
        const str = String(value || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function trimText(value, maxChars) {
        const clean = String(value || '').replace(/\s+/g, ' ').trim();
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

    function getAttachmentUrl(attachment) {
        return attachment?.url || attachment?.fullsize_url || attachment?.image_url ||
            attachment?.download_url || attachment?.thumb_url || attachment?.thumbnail_url || '';
    }

    function getImageObjectUrl(image) {
        return image?.image_data?.url || image?.url || image?.fullsize_url || '';
    }

    function isImageUrl(url = '') {
        return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /etsystatic\.com/i.test(url);
    }

    function messageSenderId(message) {
        return String(message?.sender_user_id || message?.sender_id || message?.user_id || message?.from_user_id || '');
    }

    function isCustomerMessage(message, chatHistory, ownerIds) {
        const senderId = messageSenderId(message);
        const customerId = String(chatHistory?.customer_user_id || '');
        if (customerId && senderId) return customerId === senderId;
        if (senderId && ownerIds.has(senderId)) return false;

        const role = `${message?.sender_type || ''} ${message?.role || ''} ${message?.author_role || ''}`.toLowerCase();
        if (/seller|shop|owner/.test(role)) return false;
        if (/buyer|customer/.test(role)) return true;
        return false;
    }

    function extractCustomerImages(chatHistory, ownerIds) {
        const images = [];
        const seen = new Set();
        for (const message of (chatHistory?.messages || [])) {
            if (!isCustomerMessage(message, chatHistory, ownerIds)) continue;
            const messageText = trimText(message.message_body || message.message || message.body || message.text, 1000);

            const candidates = [
                ...(message.attachments || []).map(att => ({
                    id: String(att.convo_message_attachment_id || att.attachment_id || getAttachmentUrl(att)),
                    url: getAttachmentUrl(att)
                })),
                ...(message.images || []).map(image => ({
                    id: String(image.image_id || getImageObjectUrl(image)),
                    url: getImageObjectUrl(image)
                }))
            ];

            for (const candidate of candidates) {
                if (!candidate.url || !isImageUrl(candidate.url) || seen.has(candidate.url)) continue;
                seen.add(candidate.url);
                images.push({
                    ...candidate,
                    messageId: message.message_id || message.convo_message_id || null,
                    sender: message.sender_display_name || 'Customer',
                    messageText,
                    sourceRole: 'customer'
                });
            }
        }
        return images;
    }

    function extractCustomerImagesFromDom() {
        const images = [];
        const seen = new Set();
        for (const link of document.querySelectorAll('.quick-refunds-message-images a[href]')) {
            const url = link.href || link.querySelector('img[src]')?.src || '';
            if (!url || !isImageUrl(url) || seen.has(url)) continue;
            seen.add(url);
            images.push({
                id: `dom-${hashString(url)}`,
                url,
                messageId: null,
                sender: 'Unknown participant',
                messageText: '',
                // The DOM selector alone does not reveal who sent the image.
                // Keep it available for analysis without presenting it as customer evidence.
                sourceRole: 'unknown'
            });
        }
        return images;
    }

    async function getCurrentImageSource() {
        const result = await getStorage(['ETSY_CHAT_HISTORY', 'ETSY_GLOBAL_USER_ID', 'ETSY_GLOBAL_SHOP_ID']);
        const ownerIds = new Set([result.ETSY_GLOBAL_USER_ID, result.ETSY_GLOBAL_SHOP_ID].filter(Boolean).map(String));
        const images = [
            ...extractCustomerImages(result.ETSY_CHAT_HISTORY, ownerIds),
            ...extractCustomerImagesFromDom()
        ];
        const seen = new Set();
        const deduplicated = images.filter(image => {
            if (!image.url || seen.has(image.url)) return false;
            seen.add(image.url);
            return true;
        });
        const conversationId = String(
            result.ETSY_CHAT_HISTORY?.convo_id ||
            result.ETSY_CHAT_HISTORY?.conversation_id ||
            result.ETSY_CHAT_HISTORY?.customer_user_id ||
            'unknown-conversation'
        );
        const sourceFingerprint = deduplicated.map(image => [
            image.url,
            image.messageId || '',
            image.sourceRole || 'unknown',
            image.messageText || ''
        ].join('|')).join('\n');
        return {
            conversationId,
            sourceKey: `${conversationId}:${hashString(sourceFingerprint)}`,
            images: deduplicated
        };
    }

    async function loadCache() {
        const result = await getStorage([CACHE_KEY]);
        const cache = result[CACHE_KEY];
        return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
    }

    function isFresh(entry) {
        return entry?.version === VERSION && entry?.updatedAt && Date.now() - entry.updatedAt < TTL_MS;
    }

    async function saveCacheUpdates(updates) {
        const commit = async () => {
            const current = await loadCache();
            const merged = { ...current, ...updates };
            const entries = Object.entries(merged)
                .filter(([, value]) => value?.updatedAt && Date.now() - value.updatedAt < TTL_MS)
                .sort((a, b) => Number(b[1].updatedAt) - Number(a[1].updatedAt))
                .slice(0, 300);
            await setStorage({ [CACHE_KEY]: Object.fromEntries(entries) });
        };
        cacheWriteQueue = cacheWriteQueue.then(commit, commit);
        await cacheWriteQueue;
    }

    function getCacheKey(image, listingContext) {
        // Vision output includes task implications, so a URL-only cache can leak an
        // assessment made for another listing/message into the current task.
        const taskContext = JSON.stringify({
            url: image.url,
            sourceRole: image.sourceRole || 'unknown',
            messageText: image.messageText || '',
            listingContext: listingContext || ''
        });
        return `image-${hashString(`${VERSION}|${taskContext}`)}`;
    }

    function isSuccessful(entry) {
        return isFresh(entry) && entry.status === 'success' && !!entry.summaryText;
    }

    function isRetryDeferred(entry) {
        return isFresh(entry) && entry.status === 'failed' && Number(entry.retryAfter) > Date.now();
    }

    function classifyFailure(error) {
        return error?.code === 'IMAGE_TOO_LARGE' ? 'oversized' : 'transient';
    }

    function createFailureEntry(image, error, previousEntry) {
        const now = Date.now();
        const failureType = classifyFailure(error);
        const previousAttempts = isFresh(previousEntry) && previousEntry.status === 'failed'
            ? Number(previousEntry.attemptCount) || 0
            : 0;
        const attemptCount = Math.min(MAX_FAILURE_ATTEMPTS, previousAttempts + 1);
        const retryDelay = failureType === 'oversized'
            ? OVERSIZED_RETRY_MS
            : Math.min(FAILURE_RETRY_MAX_MS, FAILURE_RETRY_BASE_MS * (2 ** Math.max(0, attemptCount - 1)));
        return {
            version: VERSION,
            status: 'failed',
            id: image.id,
            sourceRole: image.sourceRole || 'unknown',
            updatedAt: now,
            retryAfter: now + retryDelay,
            attemptCount,
            failureType,
            error: trimText(error?.message || error, 180)
        };
    }

    function updateCoverage(metadata, images, cache, listingContext) {
        const entries = images.map(image => cache[getCacheKey(image, listingContext)]).filter(isFresh);
        metadata.imageIntelCount = images.length;
        metadata.imageIntelCustomerCount = images.filter(image => image.sourceRole === 'customer').length;
        metadata.imageIntelUnknownRoleCount = images.filter(image => image.sourceRole !== 'customer').length;
        metadata.imageIntelAvailableCount = entries.filter(isSuccessful).length;
        metadata.imageIntelFailedCount = entries.filter(entry => entry.status === 'failed').length;
        metadata.imageIntelOversizedCount = entries.filter(entry => entry.status === 'failed' && entry.failureType === 'oversized').length;
        metadata.imageIntelDeferredCount = entries.filter(isRetryDeferred).length;
        metadata.imageIntelCoverage = images.length
            ? Number((metadata.imageIntelAvailableCount / images.length).toFixed(3))
            : 1;
    }

    async function fetchImageData(url) {
        const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
        if (!response.ok) throw new Error(`image fetch ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`not an image: ${blob.type}`);
        if (blob.size > MAX_IMAGE_BYTES) {
            const error = new Error(`image too large: ${blob.size}`);
            error.code = 'IMAGE_TOO_LARGE';
            throw error;
        }

        let width = null;
        let height = null;
        if (typeof createImageBitmap === 'function') {
            try {
                const bitmap = await createImageBitmap(blob);
                width = bitmap.width;
                height = bitmap.height;
                bitmap.close?.();
            } catch (_) { /* Vision still works when local dimension decoding fails. */ }
        }

        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
            reader.readAsDataURL(blob);
        });

        return {
            mimeType: blob.type || 'image/jpeg',
            base64: String(dataUrl).split(',')[1],
            byteSize: blob.size,
            width,
            height
        };
    }

    async function getListingContext() {
        const idResult = await getStorage(['ETSY_CURRENT_LISTING_ID']);
        const listingId = idResult.ETSY_CURRENT_LISTING_ID;
        if (!listingId) return '';
        const listingResult = await getStorage([`RAG_LISTING_${listingId}`]);
        const listing = listingResult[`RAG_LISTING_${listingId}`];
        if (!listing) return '';
        return trimText([listing.title, listing.personalization, listing.description].filter(Boolean).join(' | '), 1400);
    }

    function buildVisionPrompt(image, metadata, listingContext) {
        const sourceDescription = image.sourceRole === 'customer'
            ? 'customer-provided Etsy attachment'
            : 'Etsy conversation attachment whose sender is not known from the available data';
        return `Analyze this ${sourceDescription} as source material for the shop's work.
Prioritize an honest quality assessment: resolution, sharpness, compression, lighting, cropping, obstruction, and whether the source quality may limit the achievable result. Also summarize visible content that helps understand the work discussed in the conversation.
Use uncertainty when evidence is insufficient. Describe private people only with neutral visual labels; do not establish real-world identity or infer sensitive traits.

Attachment metadata: ${metadata.width && metadata.height ? `${metadata.width}x${metadata.height}px, ` : ''}${metadata.byteSize} bytes, ${metadata.mimeType}
Associated conversation message: ${image.messageText || '(not available)'}
${listingContext ? `Listing context: ${listingContext}` : ''}

Return JSON only:
{
  "imageType": "photo|reference|screenshot|document|other|unknown",
  "quality": "good|medium|poor|unknown",
  "qualityAssessment": "brief evidence-based assessment of suitability as source material",
  "qualityLimitations": ["specific visible or technical limitation"],
  "visualSummary": ["concise task-relevant observation using neutral labels"],
  "uncertainties": ["what cannot be determined confidently"],
  "workImplications": ["how the evidence may affect the requested work"]
}`;
    }

    function parseJson(text) {
        const clean = String(text || '').trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```$/i, '')
            .trim();
        return JSON.parse(clean);
    }

    async function analyzeImage(apiKey, image, listingContext) {
        const metadata = await fetchImageData(image.url);
        if (window.GeminiAuxiliaryService) {
            const result = await window.GeminiAuxiliaryService.generateContent({
                apiKey,
                timeoutMs: 30000,
                body: {
                    contents: [{
                        role: 'user',
                        parts: [
                            { text: buildVisionPrompt(image, metadata, listingContext) },
                            { inline_data: { mime_type: metadata.mimeType, data: metadata.base64 } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.15,
                        maxOutputTokens: 900,
                        responseMimeType: 'application/json'
                    }
                }
            });
            return parseJson(result.data.candidates?.[0]?.content?.parts?.[0]?.text || '');
        }
        const model = window.ETSY_AI_GEMINI_FALLBACK_CHAIN?.[0] || 'gemini-flash-latest';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [
                            { text: buildVisionPrompt(image, metadata, listingContext) },
                            { inline_data: { mime_type: metadata.mimeType, data: metadata.base64 } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.15,
                        maxOutputTokens: 900,
                        responseMimeType: 'application/json'
                    }
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
        lines.push(image.sourceRole === 'customer'
            ? '- Sender role: customer (confirmed by structured conversation data)'
            : '- Sender role: unknown (DOM-only evidence does not identify the sender)');
        if (data.imageType) lines.push(`- Type: ${data.imageType}`);
        if (data.quality) lines.push(`- Quality: ${data.quality}`);
        if (data.qualityAssessment) lines.push(`- Quality assessment: ${trimText(data.qualityAssessment, 260)}`);
        if (Array.isArray(data.qualityLimitations) && data.qualityLimitations.length) {
            lines.push(`- Quality limitations: ${data.qualityLimitations.slice(0, 8).map(item => trimText(item, 150)).join('; ')}`);
        }
        if (Array.isArray(data.visualSummary) && data.visualSummary.length) {
            lines.push(`- Visual summary: ${data.visualSummary.slice(0, 10).map(item => trimText(item, 150)).join('; ')}`);
        }
        if (Array.isArray(data.uncertainties) && data.uncertainties.length) {
            lines.push(`- Uncertainties: ${data.uncertainties.slice(0, 8).map(item => trimText(item, 150)).join('; ')}`);
        }
        if (Array.isArray(data.workImplications) && data.workImplications.length) {
            lines.push(`- Work implications: ${data.workImplications.slice(0, 8).map(item => trimText(item, 160)).join('; ')}`);
        }
        return lines.join('\n');
    }

    async function analyzeImageSource(source, { onStatus } = {}) {
        const metadata = createMetadata();
        const result = await getStorage(['gemini_api_key']);
        const images = source.images;
        metadata.imageIntelCount = images.length;
        metadata.imageIntelCustomerCount = images.filter(image => image.sourceRole === 'customer').length;
        metadata.imageIntelUnknownRoleCount = images.length - metadata.imageIntelCustomerCount;
        if (!result.gemini_api_key || !images.length) {
            metadata.imageIntelCoverage = images.length ? 0 : 1;
            lastMetadata = metadata;
            return metadata;
        }

        const cache = await loadCache();
        const listingContext = await getListingContext();
        const missing = images.filter(image => {
            const entry = cache[getCacheKey(image, listingContext)];
            return !isSuccessful(entry) && !isRetryDeferred(entry);
        });
        if (!missing.length) {
            updateCoverage(metadata, images, cache, listingContext);
            lastMetadata = metadata;
            return metadata;
        }

        onStatus?.(`Analyzing ${missing.length} new conversation image${missing.length === 1 ? '' : 's'}...`);
        let nextIndex = 0;
        const cacheUpdates = {};

        const worker = async () => {
            while (nextIndex < missing.length) {
                const image = missing[nextIndex++];
                const key = getCacheKey(image, listingContext);
                try {
                    const summaryJson = await analyzeImage(result.gemini_api_key, image, listingContext);
                    cache[key] = {
                        version: VERSION,
                        status: 'success',
                        id: image.id,
                        sourceRole: image.sourceRole || 'unknown',
                        updatedAt: Date.now(),
                        summaryText: formatSummary(image, summaryJson),
                        summaryJson
                    };
                    cacheUpdates[key] = cache[key];
                    metadata.imageIntelAnalyzedThisRequest += 1;
                    onStatus?.(`Analyzed ${metadata.imageIntelAnalyzedThisRequest}/${missing.length} conversation images...`);
                } catch (error) {
                    console.warn('ImageIntelligence: image analysis failed', error);
                    cache[key] = createFailureEntry(image, error, cache[key]);
                    cacheUpdates[key] = cache[key];
                    metadata.imageIntelErrors.push(trimText(error.message || error, 180));
                }
            }
        };

        await Promise.all(Array.from(
            { length: Math.min(ANALYSIS_CONCURRENCY, missing.length) },
            () => worker()
        ));
        await saveCacheUpdates(cacheUpdates);
        updateCoverage(metadata, images, cache, listingContext);
        lastMetadata = metadata;
        return metadata;
    }

    async function analyzeCurrentCustomerImages(options = {}) {
        const source = await getCurrentImageSource();
        if (analysesInFlight.has(source.sourceKey)) return analysesInFlight.get(source.sourceKey);

        const analysisPromise = analyzeImageSource(source, options);
        analysesInFlight.set(source.sourceKey, analysisPromise);

        try {
            return await analysisPromise;
        } finally {
            if (analysesInFlight.get(source.sourceKey) === analysisPromise) {
                analysesInFlight.delete(source.sourceKey);
            }
        }
    }

    async function buildContextSection() {
        const { images } = await getCurrentImageSource();
        if (!images.length) return '';
        const cache = await loadCache();
        const listingContext = await getListingContext();
        const sections = images
            .map(image => cache[getCacheKey(image, listingContext)])
            .filter(isSuccessful)
            .map(entry => entry.summaryText);

        const customerCount = images.filter(image => image.sourceRole === 'customer').length;
        const unknownCount = images.length - customerCount;
        const failedEntries = images
            .map(image => cache[getCacheKey(image, listingContext)])
            .filter(entry => isFresh(entry) && entry.status === 'failed');
        const coverageNotice = `Vision coverage: ${sections.length}/${images.length} attachment(s) analyzed` +
            (failedEntries.length ? `; ${failedEntries.length} temporarily unavailable` : '') + '.';
        const notice = `${customerCount} structured customer image attachment(s) are present in this conversation.` +
            (unknownCount ? ` ${unknownCount} additional DOM-only attachment(s) have unknown sender role.` : '');
        if (!sections.length) {
            return `\n\n### CUSTOMER_IMAGE_CONTEXT\n${notice}\n${coverageNotice}\n(Vision analysis is pending or unavailable; do not claim to know image contents or sender role.)`;
        }
        return `\n\n### CUSTOMER_IMAGE_CONTEXT\n${notice}\n${coverageNotice}\n(Quality and content summaries generated by Gemini Vision; raw images are not stored. Treat uncertainty and unknown sender roles explicitly.)\n${trimText(sections.join('\n\n'), MAX_CONTEXT_CHARS)}`;
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
