// page_parser.js
// Модуль для парсингу контенту сторінки за допомогою Readability та Turndown
// Бібліотеки Readability та Turndown завантажуються через manifest.json (libs/*)

/**
 * Витягує чистий контент зі сторінки та конвертує у Markdown
 * @returns {Object|null} - { title, markdown, excerpt } або null якщо не вдалося
 */
function extractPageContent() {
    try {
        // Робимо глибоку копію документа в пам'яті
        // щоб Readability не змінював видиму сторінку
        const clonedDoc = window.document.cloneNode(true);

        const trashSelectors = [
            'script', 'style', 'noscript', 'svg', 'img', 'video', 'iframe', // Технічне
            'nav', 'header', 'footer',              // Навігація сайту
            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', // ARIA ролі
            '#global-nav', '.wt-overlay',           // Специфічне для Etsy
            '[class*="cookie"]', '#gdpr-banner',    // Кукіси
            '[aria-label="Privacy settings"]',     // Ще кукіси
            // Extension UI must never become page context. On Etsy layouts without
            // <main>, the parser falls back to <body>, which otherwise includes our
            // own old assistant messages and can make them look like current Etsy data.
            '#etsy-ai-chat-container', '#etsy-ai-toggle-btn', '#etsy-ai-tooltip',
            '#etsy-image-modal', '#etsy-ai-attachments-viewer', '#etsy-ai-quick-replies', '.etsy-ai-quick-reply-flyer'
        ];

        trashSelectors.forEach(selector => {
            clonedDoc.querySelectorAll(selector).forEach(el => el.remove());
        });

        let contentNode = clonedDoc.querySelector('main, [role="main"], #content');

        // Фолбек: Якщо розробники Etsy забули <main>, беремо body (але він вже очищений від хедерів/футерів)
        if (!contentNode) {
            contentNode = clonedDoc.body;
        }

        // Ініціалізуємо TurndownService для конвертації HTML → Markdown
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            emDelimiter: '*'
        });

        // Видаляємо все медійне та технічне сміття
        turndownService.remove(['img', 'script', 'style']); // На всяк випадок

        turndownService.addRule('universalLinkCleaner', {
            filter: 'a',
            replacement: function (content, node) {
                const href = node.getAttribute('href');

                // Якщо це просто якір <a name="..."> без посилання
                if (!href) return content;

                // Замінюємо всі ентери і табуляції на один пробіл
                let cleanText = content.replace(/\s+/g, ' ').trim();

                // Якщо після чистки тексту не залишилось (пусте посилання) — видаляємо
                if (cleanText.length === 0) return '';

                // Повертаємо гарний Markdown
                return '[' + cleanText + '](' + href + ')';
            }
        });

        // Правило: ігнорувати пусті параграфи та діви, щоб не плодити \n
        turndownService.addRule('ignoreEmpty', {
            filter: function (node) {
                // Фільтруємо блоки, які не містять тексту (або тільки пробіли)
                return (
                    ['DIV', 'P', 'SPAN', 'SECTION'].includes(node.nodeName) &&
                    node.textContent.trim().length === 0
                );
            },
            replacement: function () { return ''; } // Повертаємо пустоту замість \n
        });

        // Конвертуємо HTML → Markdown
        const markdown = turndownService.turndown(contentNode);

        // Cleanup: мінімізуємо переноси рядків
        const cleanedMarkdown = markdown
            .replace(/\n{3,}/g, '\n\n')  // Заміна 3+ переносів на 2
            .replace(/\n\n\n/g, '\n\n')   // Дубль-перевірка
            .replace(/^\n+/, '')          // Видаляємо переноси на початку
            .replace(/\n+$/, '')          // Видаляємо переноси в кінці
            .trim();

        return {
            title: document.title || "",
            markdown: cleanedMarkdown,
            url: window.location.href
        };

    } catch (error) {
        console.error("🍬 Page Parser Error:", error);
        return null;
    }
}

/**
 * Витягує метадані сторінки (URL, title, тощо)
 * @returns {Object} - Об'єкт з метаданими
 */
function extractPageMetadata() {
    return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        timestamp: new Date().toISOString()
    };
}

/**
 * Комбінує витягнутий контент з метаданими
 * @returns {Object|null} - Повний об'єкт даних сторінки
 */
function getFullPageData() {
    const content = extractPageContent();
    const metadata = extractPageMetadata();

    if (!content) {
        // Якщо Readability не спрацював, повертаємо хоча б метадані
        return {
            metadata: metadata,
            hasContent: false,
            markdown: null,
            title: metadata.title
        };
    }

    return {
        metadata: metadata,
        hasContent: true,
        markdown: content.markdown,
        title: content.title,
        excerpt: content.excerpt,
        siteName: content.siteName,
        byline: content.byline
    };
}

// Експортуємо функції для використання в content.js
window.PageParser = {
    extractPageContent,
    extractPageMetadata,
    getFullPageData
};
