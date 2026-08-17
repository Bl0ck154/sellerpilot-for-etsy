const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'image_intelligence_manager.js'), 'utf8');

class MockFileReader {
    readAsDataURL(blob) {
        this.result = `data:${blob.type || 'image/jpeg'};base64,AQID`;
        setTimeout(() => this.onload?.(), 0);
    }
}

function history(convoId, count = 5, options = {}) {
    return {
        convo_id: String(convoId),
        customer_user_id: 'buyer',
        messages: Array.from({ length: count }, (_, index) => ({
            message_id: `${convoId}-m${index}`,
            sender_user_id: options.ownerIndex === index ? 'owner' : 'buyer',
            sender_type: options.ownerIndex === index ? 'seller' : 'buyer',
            sender_display_name: options.ownerIndex === index ? 'Owner' : 'Customer',
            message_body: `Source photo ${index + 1}`,
            attachments: [{
                attachment_id: `${convoId}-a${index}`,
                url: `https://img.example/il_${options.variant || 'fullxfull'}.${index}.jpg?token=${options.token || 'a'}`
            }]
        }))
    };
}

function analysis(label) {
    return {
        imageLabel: label,
        imageType: 'photo',
        technicalQuality: {
            overall: 'usable',
            resolutionDetail: 'good detail',
            sharpnessFocus: 'sharp',
            compressionNoise: 'minor JPEG artifacts',
            lightingExposure: 'usable side light',
            color: 'neutral',
            croppingOcclusion: 'hands partly cropped',
            perspective: 'normal',
            background: 'moderate complexity',
            damageArtifacts: 'none'
        },
        subjects: [{ label: 'Person 1', faceVisibility: 'clear', identityCues: ['hairline'] }],
        editingRisks: ['cropped hands'],
        identityCriticalDetails: ['hairline'],
        clarificationQuestions: [],
        uncertainties: [],
        overallAssessment: 'Usable production source.',
        confidence: 'high'
    };
}

function makeHarness({ chatHistory = history('42'), domUrls = [], storageOverrides = {}, imageBlob } = {}) {
    const storage = {
        gemini_api_key: 'vision-key',
        ETSY_GLOBAL_USER_ID: 'owner',
        ETSY_CHAT_HISTORY: chatHistory,
        ...structuredClone(storageOverrides)
    };
    const changedListeners = [];
    const state = { imageFetchCalls: 0, visionCalls: 0, activeVision: 0, maxActiveVision: 0, bodies: [] };
    const chrome = {
        runtime: { id: 'test-extension' },
        storage: {
            local: {
                async get(keys) {
                    const out = {};
                    for (const key of (Array.isArray(keys) ? keys : [keys])) {
                        if (Object.hasOwn(storage, key)) out[key] = structuredClone(storage[key]);
                    }
                    return out;
                },
                async set(values) {
                    const changes = {};
                    for (const [key, value] of Object.entries(values)) {
                        changes[key] = { oldValue: storage[key], newValue: structuredClone(value) };
                        storage[key] = structuredClone(value);
                    }
                    changedListeners.forEach(listener => listener(changes, 'local'));
                },
                async remove(keys) {
                    for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key];
                }
            },
            onChanged: { addListener(fn) { changedListeners.push(fn); } }
        }
    };
    const document = {
        querySelectorAll() {
            return domUrls.map(url => ({ href: url, src: '', querySelector() { return null; } }));
        },
        createElement(tag) {
            if (tag !== 'canvas') throw new Error('unexpected element');
            return {
                width: 0,
                height: 0,
                getContext() { return { drawImage() {} }; },
                toBlob(callback, type) {
                    callback(new Blob([new Uint8Array([1, 2, 3])], { type: type || 'image/webp' }));
                }
            };
        }
    };
    const location = { pathname: `/messages/${chatHistory.convo_id}`, href: `https://www.etsy.com/messages/${chatHistory.convo_id}` };
    const window = { addEventListener() {}, ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'] };
    const context = {
        window, chrome, document, location, console, Date, Math, Object, Array, String, Set, Map,
        Promise, URL, BigInt, AbortController, FileReader: MockFileReader,
        createImageBitmap: async () => ({ width: 1600, height: 1200, close() {} }),
        setTimeout, clearTimeout, Blob,
        fetch: async (url, options = {}) => {
            if (String(url).startsWith('https://img.example/')) {
                state.imageFetchCalls += 1;
                return {
                    ok: true,
                    async blob() {
                        return imageBlob
                            ? imageBlob(url)
                            : new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
                    }
                };
            }
            state.visionCalls += 1;
            state.activeVision += 1;
            state.maxActiveVision = Math.max(state.maxActiveVision, state.activeVision);
            const body = JSON.parse(options.body);
            state.bodies.push(body);
            try {
                await new Promise(resolve => setTimeout(resolve, 10));
                const labels = body.contents[0].parts
                    .filter(part => typeof part.text === 'string' && part.text.startsWith('IMAGE_LABEL:'))
                    .map(part => part.text.match(/IMAGE_LABEL:\s*(IMG_\d+)/)?.[1])
                    .filter(Boolean);
                return {
                    ok: true,
                    async json() {
                        return { candidates: [{ content: { parts: [{ text: JSON.stringify({ images: labels.map(analysis) }) }] } }] };
                    }
                };
            } finally {
                state.activeVision -= 1;
            }
        }
    };
    window.window = window;
    window.chrome = chrome;
    window.document = document;
    window.location = location;
    vm.createContext(context);
    vm.runInContext(source, context);
    return { manager: window.ImageIntelligenceManager, storage, state, location };
}

(async () => {
    {
        const { manager, storage, state } = makeHarness();
        const metadata = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        assert.equal(state.visionCalls, 2, 'five new images are batched as 4 + 1');
        assert.equal(state.maxActiveVision, 1, 'large multimodal batches stay sequential');
        assert.equal(metadata.imageIntelAvailableCount, 5);
        assert.equal(metadata.imageIntelBatchCallsThisRequest, 2);
        assert.equal(Object.keys(storage).filter(key => key.startsWith(manager.ENTRY_PREFIX)).length, 5, 'analysis is sharded per image');
        const before = state.visionCalls;
        await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        assert.equal(state.visionCalls, before, 'successful image analysis has no TTL reanalysis');
        assert.match(state.bodies[0].contents[0].parts[0].text, /professional photo editing/i);
        assert.match(state.bodies[0].contents[0].parts[0].text, /Do not let one image's content leak/i);
    }

    {
        const h = history('42', 1, { ownerIndex: 0 });
        const { manager } = makeHarness({ chatHistory: h });
        const metadata = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        assert.equal(metadata.imageIntelOwnerCount, 1, 'Owner preview/reference images are included');
        assert.equal(metadata.imageIntelAvailableCount, 1);
    }

    {
        const h = history('42', 1);
        const { manager, state } = makeHarness({
            chatHistory: h,
            domUrls: [h.messages[0].attachments[0].url, 'https://img.example/il_fullxfull.extra.jpg']
        });
        const metadata = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        assert.equal(metadata.imageIntelCount, 2, 'DOM-only extras are merged instead of suppressed');
        assert.equal(metadata.imageIntelUnknownRoleCount, 1);
        assert.equal(state.visionCalls, 1, 'structured + DOM extra fit one batch');
    }

    {
        const { manager, state, location } = makeHarness({ chatHistory: history('41', 1) });
        location.pathname = '/messages/42';
        location.href = 'https://www.etsy.com/messages/42';
        const metadata = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        assert.equal(metadata.imageIntelCount, 0);
        assert.equal(state.visionCalls, 0, 'stale history is never analyzed for a new route');
    }

    {
        const { manager } = makeHarness({ chatHistory: history('42', 0) });
        const image = { attachmentId: 'same-attachment', messageId: 'm', url: 'https://img.example/il_fullxfull.same.jpg' };
        assert.notEqual(manager.getCacheKey(image, '42'), manager.getCacheKey(image, '43'), 'attachment identity includes conversation scope');
    }

    {
        const h = history('42', 1);
        h.messages[0].attachments[0].url = 'https://img.example/source.gif';
        const { manager, state } = makeHarness({
            chatHistory: h,
            imageBlob: () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' })
        });
        await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
        const inline = state.bodies[0].contents[0].parts.find(part => part.inline_data);
        assert.equal(inline.inline_data.mime_type, 'image/webp', 'unsupported direct MIME is rasterized before Gemini');
    }

    {
        const h = history('42', 1);
        const { manager } = makeHarness({ chatHistory: h });
        const metadata = await manager.waitForCurrentAnalysis(500);
        assert.equal(metadata.imageIntelAvailableCount, 1, 'bounded wait observes jobs after enqueue phase');
    }

    console.log('image intelligence manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
