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
