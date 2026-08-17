const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const managerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content', 'image_intelligence_manager.js'),
    'utf8'
);

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
    const window = {
        ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'],
        addEventListener() {}
    };
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
                    async blob() {
                        return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
                    }
                };
            }

            state.visionCalls += 1;
            state.activeVisionCalls += 1;
            state.maxActiveVisionCalls = Math.max(state.maxActiveVisionCalls, state.activeVisionCalls);
            const body = JSON.parse(options.body);
            state.visionPrompts.push(body.contents[0].parts[0].text);
            try {
                if (visionResponse) return await visionResponse(url, options, state);
                await new Promise(resolve => setTimeout(resolve, 10));
                const payload = {
                    imageType: 'photo',
                    technicalQuality: {
                        overall: 'limited',
                        resolutionDetail: 'Low face detail',
                        sharpnessFocus: 'Soft',
                        compressionNoise: 'Some JPEG artifacts',
                        lightingExposure: 'Side light',
                        color: 'Neutral',
                        croppingOcclusion: 'Hands cropped',
                        perspective: 'Normal',
                        background: 'Busy',
                        damageArtifacts: 'None'
                    },
                    subjects: [{
                        label: 'Person 1',
                        position: 'center',
                        poseOrientation: 'front-facing',
                        faceVisibility: 'face visible but soft',
                        expression: 'neutral',
                        hair: 'visible',
                        clothingAccessories: 'dark top',
                        bodyHandsVisibility: 'upper body',
                        occlusions: 'none',
                        identityCues: ['hairline'],
                        uncertainties: []
                    }],
                    editingRisks: ['Low face detail'],
                    identityCriticalDetails: ['hairline'],
                    clarificationQuestions: ['Is another sharper face reference available?'],
                    uncertainties: [],
                    overallAssessment: 'Usable as a secondary source.',
                    confidence: 'high'
                };
                return {
                    ok: true,
                    async json() {
                        return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
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

async function testBackgroundByDefaultAndPersistentCache() {
    const { manager, storage, state } = createHarness();
    const immediate = await manager.analyzeCurrentCustomerImages();
    assert.equal(immediate.imageIntelCount, 3);
    assert.equal(immediate.imageIntelQueuedThisRequest, 3);
    assert.equal(immediate.imageIntelAvailableCount, 0);

    await manager.waitForCurrentAnalysis(1200);
    assert.equal(state.visionCalls, 3);
    assert.equal(state.maxActiveVisionCalls, 2, 'global Vision concurrency stays capped at two');

    const cache = storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE;
    assert.equal(Object.keys(cache).length, 3);
    for (const entry of Object.values(cache)) {
        entry.updatedAt = Date.now() - 365 * 24 * 60 * 60 * 1000;
        entry.analyzedAt = entry.updatedAt;
    }
    storage.ETSY_CURRENT_LISTING_ID = '999';
    storage.RAG_LISTING_999 = { title: 'Changed listing context' };
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 3, 'successful image analysis never expires or changes with listing context');
}

async function testDetailedProductionPromptAndCompactContext() {
    const { manager, state } = createHarness({
        history: makeHistory('42', ['https://img.example/source.jpg'], {
            message: 'Please merge grandfather into family photo'
        })
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    const prompt = state.visionPrompts[0];
    assert.match(prompt, /production source material/i);
    assert.match(prompt, /sharpness\/focus/i);
    assert.match(prompt, /compression\/JPEG artifacts/i);
    assert.match(prompt, /face\/head replacement/i);
    assert.match(prompt, /identity cues/i);
    assert.match(prompt, /clarification questions/i);
    assert.match(prompt, /1600x1200px/);
    assert.match(prompt, /Please merge grandfather/);

    const section = await manager.buildContextSection();
    assert.match(section, /Persistent Gemini Vision production summaries/);
    assert.match(section, /Technical:/);
    assert.match(section, /Subjects:/);
    assert.match(section, /Editing risks:/);
    assert.match(section, /Useful clarification questions:/);
}

async function testSignedUrlRotationStillUsesSameAttachmentCache() {
    const { manager, storage, state } = createHarness({
        history: makeHistory('42', ['https://img.example/source.jpg?token=first'])
    });
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    storage.ETSY_CHAT_HISTORY = makeHistory('42', ['https://img.example/source.jpg?token=second']);
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 1, 'stable attachment id prevents repeat analysis when a signed URL rotates');
}

async function testStructuredImagesSuppressDomOnlyWaste() {
    const { manager, state } = createHarness({
        history: makeHistory('42', ['https://img.example/customer.jpg']),
        domUrls: ['https://img.example/customer.jpg', 'https://img.example/decorative.jpg']
    });
    const metadata = await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(metadata.imageIntelCount, 1);
    assert.equal(metadata.imageIntelCustomerCount, 1);
    assert.equal(metadata.imageIntelUnknownRoleCount, 0);
    assert.equal(state.visionCalls, 1, 'unknown DOM images are not analyzed when structured customer images exist');
}

async function testFailuresAreDeferred() {
    const tooLarge = (10 * 1024 * 1024) + 1;
    const { manager, storage, state } = createHarness({
        history: makeHistory('42', ['https://img.example/huge.jpg']),
        imageResponse: async () => ({
            ok: true,
            async blob() { return { type: 'image/jpeg', size: tooLarge }; }
        })
    });

    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.visionCalls, 0);
    const failure = Object.values(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE)[0];
    assert.equal(failure.failureType, 'oversized');
    await manager.analyzeCurrentCustomerImages({ waitForCompletion: true });
    assert.equal(state.imageFetchCalls, 1, 'deferred failure is not retried immediately');
}

(async () => {
    await testBackgroundByDefaultAndPersistentCache();
    await testDetailedProductionPromptAndCompactContext();
    await testSignedUrlRotationStillUsesSameAttachmentCache();
    await testStructuredImagesSuppressDomOnlyWaste();
    await testFailuresAreDeferred();
    console.log('image intelligence manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
