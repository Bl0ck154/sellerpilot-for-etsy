// content.js
console.log("🍬 Etsy AI Candy: Content Script Loaded (Visual Debug Edition)");

let lastContext = null;
let debounceTimer = null;
let lastUrl = location.href;
let lastBuyerId = null;
let urlCheckInterval = null;
let lastParsedHash = "";


// 1. MAIN LOGIC
function attemptExtraction() {
    // 1. КРИТИЧНА ПЕРЕВІРКА: Чи живе розширення?
    if (!chrome.runtime?.id) {
        console.log('⛔ Extension context invalidated. Stopping script.');
        // Вимикаємо все, щоб скрипт "помер" спокійно
        if (typeof observer !== 'undefined') observer.disconnect();
        if (urlCheckInterval) clearInterval(urlCheckInterval);
        return;
    }
    // Використовуємо новий PageParser для витягування контенту
    const pageData = window.PageParser ? window.PageParser.getFullPageData() : null;

    if (!pageData) {
        console.log('🍬 Etsy AI: PageParser not ready or no content found');
        return;
    }

    const currentHash = pageData.title + pageData.markdown.length + pageData.markdown.slice(0, 50);
    if (currentHash === lastParsedHash) {
        // Ми нічого не логуємо, нічого не відправляємо. Тиша.
        return;
    }
    lastParsedHash = currentHash;

    // Створюємо контекст з повним контентом сторінки
    const data = {
        page_content: {
            title: pageData.title,
            markdown: pageData.markdown,
            excerpt: pageData.excerpt,
            siteName: pageData.siteName,
            hasContent: pageData.hasContent
        },
        metadata: pageData.metadata,
        page_url: window.location.href
    };

    const json = JSON.stringify(data);

    // Перевіряємо чи змінився контекст або URL
    if (lastContext !== json || window.location.href !== lastUrl) {
        lastContext = json;
        lastUrl = window.location.href;
        console.log('🍬 Etsy AI: Page content extracted');
        console.log('📄 Title:', data.page_content.title);
        console.log('📊 Markdown size:', data.page_content.markdown?.length || 0, 'chars');

        try {
            chrome.runtime.sendMessage({
                type: "ETSY_DATA_PARSED",
                payload: data
            }, (response) => {
                // Обробка асинхронної помилки (коли повідомлення пішло, але ніхто не відповів)
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;

                    // Ігноруємо "port closed" - це нормально якщо background не слухає
                    if (errorMsg.includes("message port closed")) {
                        // Тихо ігноруємо - background може не відповідати
                        return;
                    }

                    // Якщо контекст втрачено - зупиняємось
                    if (errorMsg.includes("context invalidated")) {
                        console.warn("⚠️ Extension context invalidated");
                        if (typeof observer !== 'undefined') observer.disconnect();
                        if (urlCheckInterval) clearInterval(urlCheckInterval);
                    }
                }
            });
        } catch (error) {
            // Обробка синхронної помилки (якщо розширення вмерло прямо перед викликом)
            console.warn("⚠️ Extension context invalidated inside catch. Stopping.");
            if (typeof observer !== 'undefined') observer.disconnect();
            if (urlCheckInterval) clearInterval(urlCheckInterval);
        }
    }
}

// 2. SPA Handling + URL Change Detection
const observer = new MutationObserver((mutations) => {
    // Додаткова перевірка перед запуском таймера
    if (!chrome.runtime?.id) {
        observer.disconnect();
        return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        attemptExtraction();
    }, 1000);
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true, // Also watch for attribute changes
    attributeFilter: ['class', 'data-region'] // Watch specific attributes
});

urlCheckInterval = setInterval(() => {
    if (!chrome.runtime?.id) {
        clearInterval(urlCheckInterval);
        return;
    }

    if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('🍬 Etsy AI: URL changed, re-extracting...');
        attemptExtraction();
    }
}, 500);

// 3. Listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "refresh_context") {
        window.postMessage({ type: "GET_ETSY_CONTEXT" }, "*");
        attemptExtraction();
        sendResponse({ status: "Refreshed" });
    }
});

window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    // Removed old Etsy.Context handling - now using PageParser
});

// --- HELPERS ---
// Old parsing functions removed - now using PageParser module
