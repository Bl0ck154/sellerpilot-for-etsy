const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const managerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'image_intelligence_manager.js'), 'utf8');

class MockFileReader {
    readAsDataURL() {
        this.result = 'data:image/jpeg;base64,AQID';
        setTimeout(() => this.onload?.(), 0);
    }
}

function makeHistory(convoId, imageUrls, options = {}) {
    return {
        convo_id: convoId,
        customer_user_id: 'buyer',
        messages: imageUrls.map((url, index) => ({
            message_id: `${convoId}-${index}`,
            sender_user_id: 'buyer',
            sender_display_name: 'Customer',
            message_body: options.message || `Please use source photo ${index + 1}`,
            attachments: [{ attachment_id: `${convoId}-a${index}`, url }]
        }))
    };
}

function payloadFor(label) {
    return {
        imageLabel: label,
        imageType: 'photo',
        technicalQuality: {
            overall: 'limited',
            resolutionDetail: 'Low face detail',
            sharpnessFocus: 'Soft',
            compressionNoise: 'JPEG artifacts',
            lightingExposure: 'Side light',
            color: 'Neutral',
            croppingOcclusion: 'Hands cropped',
            perspective: 'Normal',
            background: 'Busy',
            damageArtifacts: 'None'
        },
        subjects: [{
            label: 'Person 1', position: 'center', poseOrientation: 'front-facing',
            faceVisibility: 'face visible', expression: 'neutral', hair: 'visible',
            clothingAccessories: 'dark top', bodyHandsVisibility: 'upper body',
            occlusions: 'none', identityCues: ['hairline'], uncertainties: []
        }],
        editingRisks: ['Low face detail'],
        identityCriticalDetails: ['hairline'],
        clarificationQuestions: ['Sharper face reference?'],
        uncertainties: [],
        overallAssessment: 'Usable secondary source',
        confidence: 'high'
    };
}

function createHarness({
    history = makeHistory('42', [
        'https://img.example/0.jpg?token=a',
        'https://img.example/1.jpg?token=a',
        'https://img.example/2.jpg?token=a'
    ]),
    domUrls = [],
    imageResponse,
    visionResponse,
    storageOverrides = {}
} = {}) {
    const storage = {
        gemini_api_key: 'vision-key',
        ETSY_GLOBAL_USER_ID: 'owner',
        ETSY_CHAT_HISTORY: history,
        ...structuredClone(storageOverrides)
    };
    const state = {
        imageFetchCalls: 0,
        visionCalls: 0,
        visionPrompts: [],
        visionBatchSizes: [],
        activeVisionCalls: 0,
        maxActiveVisionCalls: 0
    };
    const chrome = {
        runtime: { id: 'test-extension' },
        storage: {
            local: {
                async get(keys) {
                    return Object.fromEntries(keys
                        .filter(key => Object.prototype.hasOwnProperty.call(storage, key))
                        .map(key => [key, structuredClone(storage[key])]));
                },
                async set(values) { Object.assign(storage, structuredClone(values)); }
            },
            onChanged: { addListener() {} }
        }
    };
    const document = {
        querySelectorAll() {
            return domUrls.map(url => ({ href: url, querySelector() { return null; } }));
        }
    };
    const window = { ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'], addEventListener() {} };
    const context = {
        window,
        chrome,
        document,
        location: { pathname: '/messages/42', href: 'https://www.etsy.com/messages/42' },
        console,
        Date,
        Math,
        Object,
        Array,
        String,
        Set,
        Map,
        Promise,
        URL,
        AbortController,
        FileReader: MockFileReader,
        createImageBitmap: async () => ({ width: 1600, height: 1200, close() {} }),
        setTimeout,
        clearTimeout,
        fetch: async (url, options = {}) => {
            if (String(url).startsWith('https://img.example/')) {
                state.imageFetchCalls += 1;
                if (imageResponse) return imageResponse(url, options, state);
                return {
                    ok: true,
                    async blob() { return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }); }
                };
            }

            state.visionCalls += 1;
            state.activeVisionCalls += 1;
            state.maxActiveVisionCalls = Math.max(state.maxActiveVisionCalls, state.activeVisionCalls);
            const body = JSON.parse(options.body);
            const textParts = body.contents[0].parts.filter(part => typeof part.text === 'string').map(part => part.text);
            const joined = textParts.join('\n');
            state.visionPrompts.push(joined);
            const labels = joined.match(/IMAGE_LABEL: (IMG_\d+)/g)?.map(value => value.split(': ')[1]) || [];
            state.visionBatchSizes.push(labels.length);
            try {
                if (visionResponse) return await visionResponse(url, options, state, labels);
                await new Promise(resolve => setTimeout(resolve, 10));
                return {
                    ok: true,
                    async json() {
                        return {
                            candidates: [{ content: { parts: [{ text: JSON.stringify({ images: labels.map(payloadFor) }) }] } }]
                        };
                    }
                };
            } finally {
                state.activeVisionCalls -= 1;
            }
        },
        Blob
    };
    window.window = window;
    window.chrome = chrome;
    window.document = document;
    window.location = context.location;
    vm.createContext(context);
    vm.runInContext(managerSource, context);
    return { manager: window.ImageIntelligenceManager, storage, state };
}

async function testBatchingAndPersistentCache() {
    const urls = Array.from({ length: 5 }, (_, index) => `https://img.example/${index}.jpg?token=a`);
    const { manager, storage, state } = createHarness({ history: makeHistory('42', urls) });
    const immediate = await manager.analyzeCurrentCustomerImages();
    assert.equal(immediate.imageIntelQueuedThisRequest, 5);
    assert.equal(immediate.imageIntelAvailableCount, 0);

    const done = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(done.imageIntelAvailableCount, 5);
    assert.equal(state.visionCalls, 2, 'five images use two Vision requests (4+1), not five');
    assert.deepEqual(state.visionBatchSizes, [4, 1]);
    assert.equal(state.maxActiveVisionCalls, 1, 'heavy Vision batches stay serialized in background');
    assert.equal(Object.keys(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE).length, 5);

    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 2, 'cached images are never re-analyzed');
}

async function testDetailedBatchPromptAndPerImageMapping() {
    const { manager, state, storage } = createHarness({
        history: makeHistory('42', ['https://img.example/a.jpg', 'https://img.example/b.jpg'], {
            message: 'Merge grandfather into family photo'
        })
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 1);
    const prompt = state.visionPrompts[0];
    assert.match(prompt, /Analyze 2 Etsy image attachments independently/i);
    assert.match(prompt, /sharpness\/focus/i);
    assert.match(prompt, /face\/head replacement/i);
    assert.match(prompt, /identity-preserving cues/i);
    assert.match(prompt, /IMAGE_LABEL: IMG_1/);
    assert.match(prompt, /IMAGE_LABEL: IMG_2/);
    assert.match(prompt, /Merge grandfather/);

    const entries = Object.values(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(entry => entry.summaryText.includes('Technical:')));
}

async function testPayloadSplittingBelowInlineLimit() {
    const { manager, state } = createHarness({
        history: makeHistory('42', [
            'https://img.example/a.jpg',
            'https://img.example/b.jpg',
            'https://img.example/c.jpg'
        ]),
        imageResponse: async () => ({
            ok: true,
            async blob() { return { type: 'image/jpeg', size: 6 * 1024 * 1024 }; }
        })
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 2, '18 MB raw image input is split into safe requests');
    assert.deepEqual(state.visionBatchSizes, [2, 1]);
}

async function testLegacySuccessMigratesWithoutReanalysis() {
    const legacy = {
        status: 'success',
        version: '2026-old',
        promptVersion: 'old-prompt',
        id: '42-a0',
        updatedAt: 1,
        summaryText: 'Legacy permanent summary',
        summaryJson: { imageType: 'photo', overallAssessment: 'legacy' }
    };
    const { manager, storage, state } = createHarness({
        history: makeHistory('42', ['https://img.example/source.jpg?token=new']),
        storageOverrides: { ETSY_AI_IMAGE_INTELLIGENCE_CACHE: { 'old-context-key': legacy } }
    });
    const result = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(result.imageIntelAvailableCount, 1);
    assert.equal(state.visionCalls, 0, 'successful analyses survive prompt/extension version upgrades');
    assert.equal(Object.keys(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE).length, 1, 'legacy entry is re-keyed instead of duplicated');
    assert.equal(Object.values(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE)[0].summaryText, 'Legacy permanent summary');
}

async function testSignedUrlRotationUsesSameCache() {
    const { manager, storage, state } = createHarness({
        history: makeHistory('42', ['https://img.example/source.jpg?token=first'])
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    storage.ETSY_CHAT_HISTORY = makeHistory('42', ['https://img.example/source.jpg?token=second']);
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 1, 'stable attachment id prevents repeat analysis when signed URL rotates');
}

async function testStructuredImagesSuppressDomOnlyWaste() {
    const { manager, state } = createHarness({
        history: makeHistory('42', ['https://img.example/customer.jpg']),
        domUrls: ['https://img.example/customer.jpg', 'https://img.example/decorative.jpg']
    });
    const result = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(result.imageIntelCount, 1);
    assert.equal(result.imageIntelCustomerCount, 1);
    assert.equal(state.visionCalls, 1, 'DOM fallback is ignored when structured customer images exist');
}

async function testFailuresAreDeferred() {
    const { manager, storage, state } = createHarness({
        history: makeHistory('42', ['https://img.example/huge.jpg']),
        imageResponse: async () => ({
            ok: true,
            async blob() { return { type: 'image/jpeg', size: (10 * 1024 * 1024) + 1 }; }
        })
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 0);
    const failure = Object.values(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE)[0];
    assert.equal(failure.failureType, 'oversized');
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.imageFetchCalls, 1, 'deferred failure is not fetched again immediately');
}

(async () => {
    await testBatchingAndPersistentCache();
    await testDetailedBatchPromptAndPerImageMapping();
    await testPayloadSplittingBelowInlineLimit();
    await testLegacySuccessMigratesWithoutReanalysis();
    await testSignedUrlRotationUsesSameCache();
    await testStructuredImagesSuppressDomOnlyWaste();
    await testFailuresAreDeferred();
    console.log('image intelligence manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
