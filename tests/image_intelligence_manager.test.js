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
        'https://img.example/0.jpg',
        'https://img.example/1.jpg',
        'https://img.example/2.jpg'
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
            }
        }
    };

    const document = {
        querySelectorAll() {
            return domUrls.map(url => ({
                href: url,
                querySelector() { return null; }
            }));
        }
    };

    const context = {
        window: { ETSY_AI_GEMINI_FALLBACK_CHAIN: ['gemini-flash-latest'] },
        chrome,
        document,
        console,
        Date,
        Math,
        Object,
        Array,
        String,
        Set,
        Map,
        Promise,
        AbortController,
        FileReader: MockFileReader,
        createImageBitmap: async () => ({ width: 640, height: 480, close() { } }),
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
                await new Promise(resolve => setTimeout(resolve, 5));
                return {
                    ok: true,
                    async json() {
                        return {
                            candidates: [{ content: { parts: [{ text: JSON.stringify({
                                imageType: 'photo',
                                quality: 'poor',
                                qualityAssessment: 'The source is small and visibly soft.',
                                qualityLimitations: ['Low detail'],
                                visualSummary: ['One person'],
                                uncertainties: [],
                                workImplications: ['Fine detail may not reproduce cleanly']
                            }) }] } }]
                        };
                    }
                };
            } finally {
                state.activeVisionCalls -= 1;
            }
        },
        Blob
    };
    context.window.window = context.window;
    context.window.chrome = chrome;
    context.window.document = document;
    vm.createContext(context);
    vm.runInContext(managerSource, context);

    return {
        manager: context.window.ImageIntelligenceManager,
        storage,
        state
    };
}

async function waitFor(predicate, message) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(message || 'condition was not reached');
        await new Promise(resolve => setTimeout(resolve, 1));
    }
}

async function testAllStructuredCustomerImagesAndCache() {
    const { manager, state } = createHarness();
    const first = await manager.analyzeCurrentCustomerImages();
    assert.equal(first.imageIntelCount, 3);
    assert.equal(first.imageIntelCustomerCount, 3);
    assert.equal(first.imageIntelUnknownRoleCount, 0);
    assert.equal(first.imageIntelAnalyzedThisRequest, 3, 'every structured customer image is analyzed');
    assert.equal(first.imageIntelAvailableCount, 3);
    assert.equal(first.imageIntelCoverage, 1);
    assert.equal(state.visionCalls, 3);
    assert.equal(state.maxActiveVisionCalls, 2, 'vision analysis concurrency stays capped at two');
    assert.ok(state.visionPrompts.every(prompt => /resolution, sharpness, compression/.test(prompt)));
    assert.ok(state.visionPrompts.every(prompt => /640x480px/.test(prompt)));
    assert.ok(state.visionPrompts.some(prompt => /Please use source photo 1/.test(prompt)));

    const second = await manager.analyzeCurrentCustomerImages();
    assert.equal(second.imageIntelAnalyzedThisRequest, 0);
    assert.equal(second.imageIntelAvailableCount, 3);
    assert.equal(state.visionCalls, 3, 'fresh analyses are reused from cache');

    const section = await manager.buildContextSection();
    assert.match(section, /3 structured customer image attachment/);
    assert.match(section, /Vision coverage: 3\/3/);
    assert.match(section, /Quality assessment: The source is small and visibly soft/);
}

async function testCacheIncludesTaskContext() {
    const sharedUrl = 'https://img.example/shared.jpg';
    const { manager, storage, state } = createHarness({
        history: makeHistory('context-cache', [sharedUrl], { message: 'Use this for portrait A' }),
        storageOverrides: {
            ETSY_CURRENT_LISTING_ID: '1',
            RAG_LISTING_1: { title: 'Portrait A', description: 'First task context' }
        }
    });

    await manager.analyzeCurrentCustomerImages();
    storage.RAG_LISTING_1 = { title: 'Portrait B', description: 'Different task context' };
    await manager.analyzeCurrentCustomerImages();
    assert.equal(state.visionCalls, 2, 'the same URL is re-evaluated when its task context changes');
    assert.match(state.visionPrompts[0], /First task context/);
    assert.match(state.visionPrompts[1], /Different task context/);
}

async function testDomOnlyRoleRemainsUnknown() {
    const { manager, state } = createHarness({
        history: makeHistory('dom-only', []),
        domUrls: ['https://img.example/dom.jpg']
    });

    const metadata = await manager.analyzeCurrentCustomerImages();
    assert.equal(metadata.imageIntelCount, 1);
    assert.equal(metadata.imageIntelCustomerCount, 0);
    assert.equal(metadata.imageIntelUnknownRoleCount, 1);
    assert.match(state.visionPrompts[0], /sender is not known/);
    assert.doesNotMatch(state.visionPrompts[0], /customer-provided Etsy attachment/);

    const section = await manager.buildContextSection();
    assert.match(section, /0 structured customer image attachment/);
    assert.match(section, /1 additional DOM-only attachment.*unknown sender role/);
    assert.match(section, /Sender role: unknown \(DOM-only evidence does not identify the sender\)/);
}

async function testFailuresAreDeferredAndCoverageIsExposed() {
    const tooLarge = (10 * 1024 * 1024) + 1;
    const { manager, storage, state } = createHarness({
        history: makeHistory('oversized', ['https://img.example/huge.jpg']),
        imageResponse: async () => ({
            ok: true,
            async blob() { return { type: 'image/jpeg', size: tooLarge }; }
        })
    });

    const before = Date.now();
    const first = await manager.analyzeCurrentCustomerImages();
    assert.equal(first.imageIntelAnalyzedThisRequest, 0);
    assert.equal(first.imageIntelAvailableCount, 0);
    assert.equal(first.imageIntelFailedCount, 1);
    assert.equal(first.imageIntelOversizedCount, 1);
    assert.equal(first.imageIntelDeferredCount, 1);
    assert.equal(first.imageIntelCoverage, 0);
    assert.equal(first.imageIntelErrors.length, 1);
    assert.equal(state.imageFetchCalls, 1);
    assert.equal(state.visionCalls, 0, 'oversized bytes are never sent to vision');

    const failure = Object.values(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE)[0];
    assert.equal(failure.status, 'failed');
    assert.equal(failure.failureType, 'oversized');
    assert.equal(failure.attemptCount, 1);
    assert.ok(failure.retryAfter > before);
    assert.ok(failure.retryAfter - before <= (24 * 60 * 60 * 1000) + 1000, 'retry delay is bounded');

    const second = await manager.analyzeCurrentCustomerImages();
    assert.equal(second.imageIntelDeferredCount, 1);
    assert.equal(second.imageIntelErrors.length, 0, 'a deferred cached failure is not reported as a new error');
    assert.equal(state.imageFetchCalls, 1, 'a known failure is not retried immediately');

    const section = await manager.buildContextSection();
    assert.match(section, /Vision coverage: 0\/1 attachment.*1 temporarily unavailable/);
    assert.match(section, /do not claim to know image contents or sender role/);
}

async function testInFlightWorkIsScopedByConversationSource() {
    const release = new Map();
    const { manager, storage, state } = createHarness({
        history: makeHistory('first', ['https://img.example/first.jpg']),
        imageResponse: url => new Promise(resolve => {
            release.set(String(url), () => resolve({
                ok: true,
                async blob() { return new Blob([new Uint8Array([1])], { type: 'image/jpeg' }); }
            }));
        })
    });

    const first = manager.analyzeCurrentCustomerImages();
    await waitFor(() => release.has('https://img.example/first.jpg'), 'first conversation did not begin');

    const duplicateFirst = manager.analyzeCurrentCustomerImages();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(state.imageFetchCalls, 1, 'identical in-flight source shares its promise');

    storage.ETSY_CHAT_HISTORY = makeHistory('second', ['https://img.example/second.jpg']);
    const second = manager.analyzeCurrentCustomerImages();
    await waitFor(() => release.has('https://img.example/second.jpg'), 'second conversation was blocked by the first');
    assert.equal(state.imageFetchCalls, 2, 'a different conversation/source starts independently');

    release.get('https://img.example/first.jpg')();
    release.get('https://img.example/second.jpg')();
    const [firstResult, duplicateResult, secondResult] = await Promise.all([first, duplicateFirst, second]);
    assert.equal(firstResult.imageIntelAnalyzedThisRequest, 1);
    assert.equal(duplicateResult.imageIntelAnalyzedThisRequest, 1);
    assert.equal(secondResult.imageIntelAnalyzedThisRequest, 1);
    assert.equal(state.visionCalls, 2);
    assert.equal(Object.keys(storage.ETSY_AI_IMAGE_INTELLIGENCE_CACHE).length, 2, 'serialized cache merges preserve both conversations');
}

(async () => {
    await testAllStructuredCustomerImagesAndCache();
    await testCacheIncludesTaskContext();
    await testDomOnlyRoleRemainsUnknown();
    await testFailuresAreDeferredAndCoverageIsExposed();
    await testInFlightWorkIsScopedByConversationSource();
    console.log('image intelligence manager tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
