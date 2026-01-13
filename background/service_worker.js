// ============================================
// Автоматична перевірка оновлень маніфесту
// ============================================

/**
 * Перевіряє, чи закрите головне вікно чату
 */
async function isChatWindowClosed() {
    try {
        // Отримуємо всі вкладки
        const tabs = await chrome.tabs.query({});

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

// Створюємо alarm для перевірки оновлень кожні 3 хвилини
chrome.alarms.create('checkManifestUpdate', {
    periodInMinutes: 3 // Перевірка кожні 3 хвилини
});

// Обробник для alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkManifestUpdate') {
        console.log('⏰ Alarm triggered: перевірка оновлень...');
        checkForManifestUpdate();
    }
});

// Виконуємо першу перевірку одразу при запуску service worker
checkForManifestUpdate();

// ============================================
// Обробники повідомлень
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
                console.log('✅ Download started:', filename);
                sendResponse({ success: true, downloadId: downloadId });
            }
        });

        return true; // Keep message channel open for async response
    }
});