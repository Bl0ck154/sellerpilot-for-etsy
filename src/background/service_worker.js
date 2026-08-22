// Reload open Etsy tabs after an extension runtime update so old content scripts
// are not left in the browser with an invalidated chrome.runtime context.
const ETSY_TAB_RELOAD_AFTER_UPDATE_KEY = 'etsy_ai_reload_tabs_after_extension_update';

async function reloadOpenEtsyTabs() {
    const tabs = await chrome.tabs.query({ url: 'https://www.etsy.com/*' });
    await Promise.allSettled(tabs
        .filter(tab => Number.isInteger(tab.id))
        .map(tab => chrome.tabs.reload(tab.id)));
}

async function resumePendingEtsyTabReload() {
    try {
        const state = await chrome.storage.local.get([ETSY_TAB_RELOAD_AFTER_UPDATE_KEY]);
        if (!state[ETSY_TAB_RELOAD_AFTER_UPDATE_KEY]) return;
        await chrome.storage.local.remove([ETSY_TAB_RELOAD_AFTER_UPDATE_KEY]);
        await reloadOpenEtsyTabs();
    } catch (error) {
        console.warn('Could not reload Etsy tabs after extension update:', error);
    }
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
        reloadOpenEtsyTabs().catch(error => console.warn('Could not refresh Etsy tabs after update:', error));
    }
});

resumePendingEtsyTabReload();

// ============================================
// Автоматична перевірка оновлень маніфесту
// ============================================

/**
 * Перевіряє, чи закрите головне вікно чату
 */
async function isChatWindowClosed() {
    try {
        // Отримуємо лише Etsy вкладки (не перевіряємо YouTube та інші сайти)
        const tabs = await chrome.tabs.query({ url: "https://www.etsy.com/*" });

        for (const tab of tabs) {
            try {
                // Перевіряємо чи є на сторінці контейнер чату
                const result = await chrome.tabs.sendMessage(tab.id, {
                    type: 'CHECK_CHAT_WINDOW'
                });

                if (result && result.isOpen) {
                    return false; // Вікно чату відкрите
                }
            } catch (e) {
                // Ігноруємо помилки для вкладок, де немає content script
                continue;
            }
        }

        return true; // Вікно чату закрите на всіх вкладках
    } catch (error) {
        console.error('❌ Помилка при перевірці стану вікна чату:', error);
        return true; // У разі помилки вважаємо що можна оновлювати
    }
}

/**
 * Перевіряє оновлення маніфесту і оновлює розширення якщо потрібно
 */
async function checkForManifestUpdate() {
    try {
        // 1. Отримуємо версію, яка зараз "крутиться" в пам'яті браузера
        const runningVersion = chrome.runtime.getManifest().version;

        // 2. Читаємо файл manifest.json ФІЗИЧНО З ДИСКУ
        // Параметр '?t=' + Date.now() змушує браузер ігнорувати кеш і читати реальний файл
        const response = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now());
        const data = await response.json();
        const diskVersion = data.version;

        // 3. Якщо версії відрізняються - значить файли оновлено!
        if (diskVersion !== runningVersion) {
            console.log(`♻️ Знайдено оновлення на диску! ${runningVersion} -> ${diskVersion}`);

            // 4. Перевіряємо чи закрите вікно чату
            const chatClosed = await isChatWindowClosed();

            if (chatClosed) {
                console.log("✅ Вікно чату закрите. Перезавантажую розширення...");
                // The new service worker consumes this flag and reloads Etsy tabs.
                // Without that second step, already-open pages keep dead content scripts
                // until the user presses F5 manually.
                await chrome.storage.local.set({ [ETSY_TAB_RELOAD_AFTER_UPDATE_KEY]: Date.now() });
                chrome.runtime.reload();
            } else {
                console.log("⏸️ Оновлення знайдено, але вікно чату відкрите. Очікую закриття...");
            }
        }
    } catch (error) {
        console.error('❌ Помилка при перевірці оновлення маніфесту:', error);
    }
}

// ============================================
// Налаштування chrome.alarms для періодичних перевірок
// ============================================

// Створюємо alarm для перевірки оновлень кожні 5 хвилин
chrome.alarms.create('checkManifestUpdate', {
    periodInMinutes: 5 // Перевірка кожні 5 хвилин
});

// Обробник для alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkManifestUpdate') {
        checkForManifestUpdate();
    } else if (alarm.name === 'cleanupRAGStorage') {
        cleanupRAGStorage();
    }
});

// Створюємо alarm для очищення старих RAG даних (раз на годину)
chrome.alarms.create('cleanupRAGStorage', {
    periodInMinutes: 60
});

// Виконуємо першу перевірку одразу при запуску service worker
checkForManifestUpdate();

// ============================================
// Обробники повідомлень
// ============================================

async function openQuickReplyOptions() {
    const optionsBaseUrl = chrome.runtime.getURL('options/options.html');
    const optionsUrl = `${optionsBaseUrl}#quick-replies`;

    try {
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(tab => typeof tab.url === 'string' && tab.url.startsWith(optionsBaseUrl));
        if (Number.isInteger(existing?.id)) {
            await chrome.tabs.update(existing.id, { url: optionsUrl, active: true });
            if (Number.isInteger(existing.windowId) && chrome.windows?.update) {
                try {
                    await chrome.windows.update(existing.windowId, { focused: true });
                } catch (windowError) {
                    console.warn('Could not focus the existing options window', windowError);
                }
            }
            return;
        }
        await chrome.tabs.create({ url: optionsUrl, active: true });
    } catch (tabError) {
        console.warn('Could not deep-link quick reply settings; opening default options page', tabError);
        await chrome.runtime.openOptionsPage();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_OPTIONS_PAGE') {
        Promise.resolve()
            .then(() => openQuickReplyOptions())
            .then(() => sendResponse({ success: true }))
            .catch((error) => {
                console.error('Failed to open extension options:', error);
                sendResponse({ success: false, error: error?.message || String(error) });
            });
        return true;
    }

    if (message.type === "ETSY_DATA_PARSED") {
        chrome.storage.local.set({ 'current_context': message.payload })
            .then(() => {
                sendResponse({ status: "success" });
            });
        return true;
    }

    // Handle image downloads
    if (message.action === 'downloadImage') {
        const { url, filename } = message;

        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('Download failed:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {

                sendResponse({ success: true, downloadId: downloadId });
            }
        });

        return true; // Keep message channel open for async response
    }

    // ============================================
    // RAG Context Parsing - Offscreen Document Coordination
    // ============================================

    if (message.type === 'PARSE_LISTING_HTML') {
        (async () => {
            try {
                // Ensure offscreen document exists
                await ensureOffscreenDocument();

                // Send HTML to offscreen for parsing
                const response = await chrome.runtime.sendMessage({
                    target: 'offscreen',
                    type: 'PARSE_LISTING_HTML',
                    html: message.html,
                    url: message.url
                });

                // Store parsed data in local storage with RAG prefix
                if (response && response.success) {
                    // Extract listing ID for storage key
                    const match = message.url.match(/\/listing\/(\d+)/);
                    const storageKey = match
                        ? `RAG_LISTING_${match[1]}`
                        : `RAG_LISTING_${btoa(message.url).substring(0, 20)}`;

                    // Add metadata for TTL
                    const dataToStore = {
                        ...response,
                        storageKey: storageKey,
                        timestamp: Date.now() // TTL: for auto-cleanup after 24 hours
                    };

                    await chrome.storage.local.set({ [storageKey]: dataToStore });


                }

                sendResponse({ success: true, data: response });
            } catch (error) {
                console.error('🔴 RAG: Parse failed:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Keep channel open for async
    }
});

// ============================================
// Offscreen Document Management
// ============================================

let offscreenDocumentCreated = false;

/**
 * Ensure the offscreen document exists for HTML parsing
 */
async function ensureOffscreenDocument() {
    if (offscreenDocumentCreated) {
        return;
    }

    // Check if already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        offscreenDocumentCreated = true;
        return;
    }

    // Create new offscreen document
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['DOM_PARSER'],
            justification: 'Parse listing HTML to extract product data for AI context'
        });
        offscreenDocumentCreated = true;
        console.log('🟢 RAG: Offscreen document created');
    } catch (error) {
        if (error.message.includes('already exists')) {
            offscreenDocumentCreated = true;
        } else {
            throw error;
        }
    }
}

// ============================================
// RAG Storage Cleanup
// ============================================

/**
 * Cleanup old RAG listing data (older than 24 hours)
 */
async function cleanupRAGStorage() {
    try {
        const storage = await chrome.storage.local.get(null);
        const now = Date.now();
        const TTL = 24 * 60 * 60 * 1000; // 24 hours

        let deletedCount = 0;

        for (const key of Object.keys(storage)) {
            if (key.startsWith('RAG_LISTING_')) {
                const data = storage[key];
                if (data.timestamp && (now - data.timestamp > TTL)) {
                    await chrome.storage.local.remove(key);
                    deletedCount++;
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`🧹 RAG Storage: Cleaned up ${deletedCount} old listings`);
        }
    } catch (error) {
        console.error('❌ RAG Storage cleanup failed:', error);
    }
}

// Custom OpenAI-compatible provider streaming runs in the extension worker so
// cross-origin behavior does not depend on the Etsy page's CORS policy.
function validateCustomProviderEndpoint(value) {
    const url = new URL(String(value || '').trim());
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
        throw new Error('Custom provider must use HTTPS unless it is local.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Custom provider URL contains unsupported credentials, query, or fragment.');
    }
    const clean = url.toString().replace(/\/+$/, '');
    return /\/chat\/completions$/i.test(url.pathname) ? clean : `${clean}/chat/completions`;
}

function customProviderText(data) {
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.delta?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
    return '';
}

async function streamCustomProviderRequest(port, message, controller) {
    const settings = await chrome.storage.local.get(['custom_provider_enabled', 'custom_base_url', 'custom_api_key', 'custom_model']);
    if (!settings.custom_provider_enabled) throw new Error('Custom provider is disabled.');
    const endpoint = validateCustomProviderEndpoint(settings.custom_base_url);
    const model = String(message.modelId || settings.custom_model || '').trim();
    if (!model) throw new Error('Custom provider model is not configured.');

    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json' };
    if (settings.custom_api_key) headers.Authorization = `Bearer ${settings.custom_api_key}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: message.systemInstruction || '' }, ...(message.messages || [])],
            stream: true
        }),
        redirect: 'error',
        signal: controller.signal
    });

    if (!response.ok) {
        let detail = '';
        try {
            const body = await response.json();
            detail = String(body?.error?.message || body?.message || '').slice(0, 500);
        } catch (_) { /* Status is sufficient. */ }
        const error = new Error(detail || `Custom provider API error: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data?.error) throw new Error(String(data.error.message || 'Custom provider returned an error').slice(0, 500));
        const text = customProviderText(data);
        if (!text) throw new Error('Custom provider returned no text.');
        port.postMessage({ type: 'chunk', chunk: text, fullText: text });
        port.postMessage({ type: 'complete', fullText: text });
        return;
    }

    if (!response.body?.getReader) throw new Error('Custom provider returned an unreadable stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    const processLine = line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let data;
        try { data = JSON.parse(payload); } catch (_) { return; }
        if (data?.error) throw new Error(String(data.error.message || 'Custom provider stream error').slice(0, 500));
        const chunk = customProviderText(data);
        if (!chunk) return;
        fullText += chunk;
        port.postMessage({ type: 'chunk', chunk, fullText });
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
    if (!fullText) throw new Error('Custom provider returned no text.');
    port.postMessage({ type: 'complete', fullText });
}

chrome.runtime.onConnect?.addListener(port => {
    if (port.name !== 'custom-ai-stream') return;
    const senderUrl = String(port.sender?.tab?.url || port.sender?.url || '');
    if (!senderUrl.startsWith('https://www.etsy.com/')) {
        port.disconnect();
        return;
    }

    const controller = new AbortController();
    let started = false;
    let timeoutId = null;
    let userAborted = false;
    let timedOut = false;
    port.onDisconnect.addListener(() => {
        clearTimeout(timeoutId);
        controller.abort();
    });
    port.onMessage.addListener(message => {
        if (message?.type === 'abort') {
            userAborted = true;
            controller.abort();
            return;
        }
        if (message?.type !== 'start' || started) return;
        started = true;
        timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('Custom provider timed out.', 'TimeoutError'));
        }, 60000);
        streamCustomProviderRequest(port, message, controller)
            .catch(error => {
                if (controller.signal.aborted && !error?.message) return;
                try {
                    port.postMessage({
                        type: 'error',
                        message: String(error?.message || error || 'Custom provider failed').slice(0, 500),
                        statusCode: error?.statusCode || (timedOut ? 408 : null),
                        aborted: userAborted
                    });
                } catch (_) { /* Port already closed. */ }
            })
            .finally(() => clearTimeout(timeoutId));
    });
});
