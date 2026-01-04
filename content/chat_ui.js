// chat_ui.js - Floating Chat UI
console.log('�� Etsy AI: Loading...');

// Inject CSS
const cssLink = document.createElement('link');
cssLink.rel = 'stylesheet';
cssLink.href = chrome.runtime.getURL('content/chat_ui.css');
document.head.appendChild(cssLink);

// Inject fonts
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';
document.head.appendChild(fontLink);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function init() {
    await injectUI();
    initChat();
}

async function injectUI() {
    if (document.getElementById('etsy-ai-chat-container')) return;

    const btn = document.createElement('button');
    btn.id = 'etsy-ai-toggle-btn';
    btn.innerHTML = `
    <span class="etsy-icon-open">🤖</span>
    <span class="etsy-icon-close">✕</span>
`;
    btn.setAttribute('data-ai-tooltip', 'Etsy Assistant');

    let chat;
    try {
        const uiUrl = chrome.runtime.getURL('content/ui.html');
        const response = await fetch(uiUrl);
        chat = document.createElement('div');
        chat.id = 'etsy-ai-chat-container';
        chat.innerHTML = await response.text();
    } catch (e) {
        console.log('⛔ UI load failed', e);
        return;
    }

    const startRight = 20; // Твій відступ справа
    const startBottom = 80; // Твій відступ знизу
    const btnSize = 60;     // Розмір кнопки

    // Формула: Ширина екрану - Відступ - Розмір кнопки = Координата Left
    const initialLeft = window.innerWidth - startRight - btnSize;
    const initialTop = window.innerHeight - startBottom - btnSize;

    // Присвоюємо ЖОРСТКІ координати
    btn.style.left = initialLeft + 'px';
    btn.style.top = initialTop + 'px';

    // Для гарантії вбиваємо якорі inline (хоч ми і в CSS їх прибрали)
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';

    document.body.appendChild(btn);
    document.body.appendChild(chat);


    // Видаляємо всі title атрибути щоб не було подвійних tooltips
    chat.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
    if (btn.hasAttribute('title')) btn.removeAttribute('title');

    // === DRAG & DROP для кнопки (тільки коли чат закритий) ===
    makeDraggable(btn, 'etsy-ai-btn-position', null, () => !chat.classList.contains('visible'));

    // === DRAG & DROP для чату (тільки за хедер) ===
    const header = chat.querySelector('.etsy-ai-header');
    if (header) {
        header.style.cursor = 'move';
        makeDraggable(chat, 'etsy-ai-chat-position', header);
    }

    // === SMART TOOLTIPS ===
    initTooltips();

    // Track drag vs click for main button
    let buttonDragDistance = 0;

    btn.addEventListener('mousedown', () => {
        buttonDragDistance = 0;
    });

    btn.addEventListener('mousemove', (e) => {
        // Рахуємо тільки якщо затиснута ліва кнопка миші (buttons === 1)
        if (e.buttons === 1) {
            buttonDragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
        }
    });

    btn.onclick = (e) => {
        // Твоя перевірка на драг (залишаємо як є)
        if (buttonDragDistance > 5) {
            buttonDragDistance = 0;
            return;
        }

        // 👇 ЗМІНИ ТУТ 👇
        if (chat.classList.contains('visible')) {
            chat.classList.remove('visible');

            // ЗАМІСТЬ btn.innerHTML = '🤖' ПИШЕМО:
            btn.classList.remove('is-active');
        } else {
            chat.classList.add('visible');

            // ЗАМІСТЬ btn.innerHTML = '✕' ПИШЕМО:
            btn.classList.add('is-active');
        }

        buttonDragDistance = 0;
    };

    document.getElementById('etsy-ai-close-btn').onclick = () => {
        chat.classList.remove('visible');
        btn.classList.remove('is-active');
    };
}

// Smart tooltips з автопозиціонуванням
function initTooltips() {
    const tooltipDiv = document.createElement('div');
    tooltipDiv.id = 'etsy-ai-tooltip';
    tooltipDiv.style.cssText = `
        position: fixed;
        background: #222;
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        z-index: 999999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(tooltipDiv);

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-ai-tooltip]');
        if (!target || !target.dataset.aiTooltip) return;

        const text = target.dataset.aiTooltip;
        tooltipDiv.textContent = text;
        tooltipDiv.style.opacity = '1';

        // Позиціонування завжди знизу
        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltipDiv.getBoundingClientRect();

        let top = rect.bottom + 8; // Завжди знизу
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        // Перевірка виходу за межі екрану (тільки по горизонталі)
        if (left < 5) left = 5;
        if (left + tooltipRect.width > window.innerWidth - 5) {
            left = window.innerWidth - tooltipRect.width - 5;
        }

        tooltipDiv.style.top = `${top}px`;
        tooltipDiv.style.left = `${left}px`;
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-ai-tooltip]');
        if (target) {
            tooltipDiv.style.opacity = '0';
        }
    });

    document.addEventListener('mousedown', (e) => {
        const target = e.target.closest('[data-ai-tooltip]');
        if (target) {
            const currentTooltip = document.getElementById('etsy-ai-tooltip');
            if (currentTooltip) {
                currentTooltip.style.opacity = '0';
            }
        }
    });
}

// Універсальна функція для drag & drop з відстанню від краю
function makeDraggable(element, storageKey, handleElement = null, enabledCallback = null) {
    const handle = handleElement || element;
    let isDragging = false;
    let currentX, currentY, initialX, initialY;

    // Функція для отримання позиції від найближчого краю
    function getEdgePosition() {
        const rect = element.getBoundingClientRect();
        const distanceFromLeft = rect.left;
        const distanceFromRight = window.innerWidth - rect.right;
        const distanceFromTop = rect.top;
        const distanceFromBottom = window.innerHeight - rect.bottom;

        // Визначаємо найближчий край
        const minHorizontal = Math.min(distanceFromLeft, distanceFromRight);
        const minVertical = Math.min(distanceFromTop, distanceFromBottom);

        return {
            edge: distanceFromLeft < distanceFromRight ? 'left' : 'right',
            edgeDistance: minHorizontal,
            verticalEdge: distanceFromTop < distanceFromBottom ? 'top' : 'bottom',
            verticalDistance: minVertical
        };
    }

    // Функція для відновлення позиції від краю
    function restorePosition() {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const pos = JSON.parse(saved);

            // Очищаємо всі позиції
            element.style.left = 'auto';
            element.style.right = 'auto';
            element.style.top = 'auto';
            element.style.bottom = 'auto';

            // Встановлюємо позицію від краю
            element.style[pos.edge] = `${pos.edgeDistance}px`;
            element.style[pos.verticalEdge] = `${pos.verticalDistance}px`;
        } else {
            // Якщо немає збережених даних - використовуємо дефолтні позиції з CSS
            // Не змінюємо стилі, залишаємо як є в CSS
        }
    }

    // Відновлюємо збережену позицію
    restorePosition();

    handle.addEventListener('mousedown', dragStart);

    function dragStart(e) {
        // Перевіряємо чи дозволено dragging
        if (enabledCallback && !enabledCallback()) {
            return;
        }
        // Дозволяємо drag головної кнопки (#etsy-ai-toggle-btn)
        const isMainButton = element.id === 'etsy-ai-toggle-btn';

        if (!isMainButton && (
            e.target.tagName === 'BUTTON' ||
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'SELECT' ||
            e.target.closest('button') ||
            e.target.closest('input') ||
            e.target.closest('select') ||
            e.target.closest('[contenteditable]') ||
            e.target.closest('svg')
        )) {
            return;
        }

        isDragging = true;

        // Конвертуємо поточну позицію в абсолютну для drag
        const rect = element.getBoundingClientRect();
        element.style.left = `${rect.left}px`;
        element.style.top = `${rect.top}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';

        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;

        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        element.style.transition = 'none';
        e.preventDefault();
    }

    function drag(e) {
        if (!isDragging) return;

        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        // Обмеження в межах вікна
        const maxX = window.innerWidth - element.offsetWidth;
        const maxY = window.innerHeight - element.offsetHeight;

        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));

        element.style.left = `${currentX}px`;
        element.style.top = `${currentY}px`;
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;

        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);

        element.style.transition = '';

        // Зберігаємо позицію як відстань від краю
        const edgePos = getEdgePosition();
        localStorage.setItem(storageKey, JSON.stringify(edgePos));

        // ❌ ПРИБРАНО: edge conversion викликав стрибок
        // Залишаємо left/top після drag
    }

    // При зміні розміру вікна - просто відновлюємо позицію від краю
    window.addEventListener('resize', () => {
        if (!isDragging) {
            restorePosition();
        }
    });
}

function initChat() {
    // ===== SAFETY WRAPPERS FOR EXTENSION CONTEXT =====
    async function safeStorageGet(keys) {
        if (!chrome.runtime?.id) {
            console.log('⛔ Extension context invalidated - storage GET blocked');
            return null;
        }
        try {
            return await chrome.storage.local.get(keys);
        } catch (e) {
            if (e.message.includes('Extension context invalidated')) {
                console.log('⛔ Storage GET failed - extension reloaded');
                return null;
            }
            throw e;
        }
    }

    async function safeStorageSet(data) {
        if (!chrome.runtime?.id) {
            console.log('⛔ Extension context invalidated - storage SET blocked');
            return false;
        }
        try {
            await chrome.storage.local.set(data);
            return true;
        } catch (e) {
            if (e.message.includes('Extension context invalidated')) {
                console.log('⛔ Storage SET failed - extension reloaded');
                return false;
            }
            throw e;
        }
    }

    const aiService = new window.AIService();

    let CONFIG = {
        apiKeys: {
            google: ""
        },
        models: [] // LoadedDynamically
    };
    let CURRENT_CONTEXT = null;
    let isProcessing = false; // Prevent multiple simultaneous messages

    const ELEMENTS = {
        statusDot: document.getElementById('connection-status'),
        pageTitle: document.getElementById('page-title'), // New element
        chatBox: document.getElementById('chat-box'),
        userInput: document.getElementById('user-input'),
        sendBtn: document.getElementById('send-btn'),
        generateBtn: document.getElementById('generate-btn'),
        modelSelect: document.getElementById('model-select'),
        // Settings
        settingsBtn: document.getElementById('settings-btn'),
        settingsOverlay: document.getElementById('settings-overlay'),
        apiKeyInput: document.getElementById('api-key-input'),
        saveSettingsBtn: document.getElementById('save-settings'),
        cancelSettingsBtn: document.getElementById('cancel-settings'),
        // History
        historyBtn: document.getElementById('history-btn'),
        newChatBtn: document.getElementById('new-chat-btn'),
        historyOverlay: document.getElementById('history-overlay'),
        historyList: document.getElementById('history-list'),
        closeHistoryBtn: document.getElementById('close-history')
    };

    // --- INITIALIZATION ---
    // DOM is already ready, call init functions directly
    (async () => {
        await loadConfiguration();
        restoreState();
        setupListeners();

        // Request context from current page
        chrome.storage.local.get(['current_context'], (result) => {
            if (result.current_context) {
                updateContext(result.current_context);
            }
        });
    })();

    // --- CONFIGURATION ---
    async function loadConfiguration() {
        // 1. Load models from config.js (window.ETSY_AI_CONFIG)
        if (window.ETSY_AI_CONFIG && window.ETSY_AI_CONFIG.models) {
            CONFIG.models = window.ETSY_AI_CONFIG.models;
            populateModelDropdown();
            console.log("✅ Loaded", CONFIG.models.length, "models from config.js");
        } else {
            // Fallback if config.js не завантажився
            console.warn("⚠️ config.js not loaded, using fallback model");
            CONFIG.models = [
                { id: "gemini-3-flash-preview", name: "Gemini 3.0 Flash (Preview)", provider: "google" }
            ];
            populateModelDropdown();
        }

        // 2. Load API keys from Storage
        const result = await safeStorageGet(['custom_api_keys', 'preferred_model']);
        if (!result) return; // Extension context invalidated

        if (result.custom_api_keys) {
            CONFIG.apiKeys = { ...CONFIG.apiKeys, ...result.custom_api_keys };
        }

        // 3. Set default model if not already selected
        if (!result.preferred_model && window.ETSY_AI_CONFIG?.defaultModel) {
            ELEMENTS.modelSelect.value = window.ETSY_AI_CONFIG.defaultModel;
            await safeStorageSet({ 'preferred_model': window.ETSY_AI_CONFIG.defaultModel });
            console.log("✅ Set default model:", window.ETSY_AI_CONFIG.defaultModel);
        }

        // 4. Check if API key is configured
        if (!CONFIG.apiKeys.google || CONFIG.apiKeys.google === "YOUR_Google_API_KEY") {
            addMessage("⚠️ Please configure your Google API Key in Settings.", "system");
            openSettings();
        }
    }

    function populateModelDropdown() {
        ELEMENTS.modelSelect.innerHTML = "";
        CONFIG.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.dataset.provider = model.provider;
            option.textContent = model.name;
            ELEMENTS.modelSelect.appendChild(option);
        });
    }

    // --- LISTENERS ---
    function setupListeners() {
        // Auto-resize contenteditable div
        ELEMENTS.userInput.addEventListener('input', function () {
            // Contenteditable автоматично розширюється, додаткова логіка не потрібна
        });

        // Strip formatting from pasted content
        ELEMENTS.userInput.addEventListener('paste', (e) => {
            e.preventDefault();

            // Get plain text from clipboard
            const text = e.clipboardData.getData('text/plain');

            // Insert as plain text at cursor position
            document.execCommand('insertText', false, text);
        });

        ELEMENTS.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        ELEMENTS.sendBtn.addEventListener('click', sendMessage);

        // "Generate Draft" shortcut
        ELEMENTS.generateBtn.addEventListener('click', () => {
            handleChatInteraction("Please draft a polite professional reply to this client based on our history and context.", true);
        });

        // Settings
        ELEMENTS.settingsBtn.addEventListener('click', openSettings);
        ELEMENTS.saveSettingsBtn.addEventListener('click', saveSettings);
        document.getElementById('cancel-settings').addEventListener('click', closeSettings);

        // Close on overlay click (mousedown для точності)
        ELEMENTS.settingsOverlay.addEventListener('mousedown', (e) => {
            if (e.target === ELEMENTS.settingsOverlay) {
                closeSettings();
            }
        });
        ELEMENTS.historyOverlay.addEventListener('mousedown', (e) => {
            if (e.target === ELEMENTS.historyOverlay) {
                closeHistory();
            }
        });

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.current_context) {
                updateContext(changes.current_context.newValue);
            }
        });

        ELEMENTS.modelSelect.addEventListener('change', () => {
            safeStorageSet({ 'preferred_model': ELEMENTS.modelSelect.value });
        });

        // History and New Chat
        ELEMENTS.historyBtn.addEventListener('click', openHistory);
        ELEMENTS.closeHistoryBtn.addEventListener('click', closeHistory);
        ELEMENTS.newChatBtn.addEventListener('click', startNewChat);

        // Close history on overlay click (mousedown)
        ELEMENTS.historyOverlay.addEventListener('mousedown', (e) => {
            if (e.target === ELEMENTS.historyOverlay) {
                closeHistory();
            }
        });
    }

    // --- SETTINGS LOGIC ---
    function openSettings() {
        // Determine which key to show. For now simple UI only shows Google.
        // Future: Dynamic UI based on needed providers.
        ELEMENTS.apiKeyInput.value = CONFIG.apiKeys.google || "";
        ELEMENTS.settingsOverlay.classList.add('visible');
        ELEMENTS.apiKeyInput.focus();
    }

    function closeSettings() {
        ELEMENTS.settingsOverlay.classList.remove('visible');
    }

    async function saveSettings() {
        const key = ELEMENTS.apiKeyInput.value.trim();
        if (key) {
            CONFIG.apiKeys.google = key;

            // Save entire keys object
            await safeStorageSet({ 'custom_api_keys': CONFIG.apiKeys });

            closeSettings();
            addMessage("✅ API Key Saved", "system");
        } else {
            alert("Please enter a valid Google API Key");
        }
    }

    // --- APP LOGIC ---
    async function updateContext(data) {
        if (!data) return;

        // Check if URL changed
        const prevUrl = CURRENT_CONTEXT?.page_url;
        const newUrl = data.page_url;

        // Don't clear chat when navigating - keep conversation context
        // if (newUrl && prevUrl !== newUrl) {
        //     ELEMENTS.chatBox.innerHTML = '';
        //     await loadHistory(newUrl);
        // }

        CURRENT_CONTEXT = data;

        // UI Updates
        if (data.page_content || data.metadata) {
            const pageTitle = data.page_content?.title || data.metadata?.title || 'Etsy Page';

            // Update page title in header if element exists
            if (ELEMENTS.pageTitle) {
                ELEMENTS.pageTitle.textContent = pageTitle;
                ELEMENTS.pageTitle.title = data.metadata?.url || '';
            }

            ELEMENTS.statusDot.style.background = "#00C853";
            ELEMENTS.statusDot.title = "Connected to Etsy Page";
        }
    }

    async function loadHistory(pageUrl) {
        // Use URL-based history instead of buyer ID
        const urlHash = simpleHash(pageUrl);
        const key = `history_${urlHash}`;
        const result = await safeStorageGet([key]);
        if (!result) return; // Extension context invalidated
        const history = result[key] || [];

        if (history.length > 0) {
            history.forEach(msg => {
                renderMessage(msg.text, msg.type, msg.timestamp);
            });
        }
    }

    // Simple hash function for URLs
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    async function saveChatToStorage(pageUrl, text, type) {
        if (!pageUrl) return;
        const urlHash = simpleHash(pageUrl);
        const key = `history_${urlHash}`;

        // Use a function to ensure we get fresh data
        try {
            const result = await safeStorageGet([key]);
            if (!result) return; // Extension context invalidated
            const history = result[key] || [];

            const newMsg = {
                text,
                type,
                timestamp: new Date().toISOString()
            };

            history.push(newMsg);
            if (history.length > 50) history.shift();

            await safeStorageSet({ [key]: history });
        } catch (e) {
            console.error("Failed to save history:", e);
        }
    }

    // Core Chat Interaction Flow
    async function handleChatInteraction(userMessageText, isSystemAction = false) {
        // Prevent sending while processing
        if (isProcessing) {
            return;
        }

        // 1. Check Config
        const modelId = ELEMENTS.modelSelect.value;
        const selectedOption = ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex];
        const provider = selectedOption ? selectedOption.dataset.provider : "google";
        const apiKey = CONFIG.apiKeys[provider];

        if (!apiKey) {
            addMessage(`⚠️ Missing API Key for ${provider}.`, "system");
            openSettings();
            return;
        }

        // Set processing state
        isProcessing = true;
        ELEMENTS.sendBtn.disabled = true;
        ELEMENTS.sendBtn.style.opacity = '0.5';
        ELEMENTS.sendBtn.style.cursor = 'not-allowed';
        ELEMENTS.generateBtn.disabled = true;
        ELEMENTS.generateBtn.style.opacity = '0.5';

        // 2. Show User Message
        renderMessage(userMessageText, "user");

        // 3. Save User Msg
        if (CURRENT_CONTEXT?.page_url) {
            await saveChatToStorage(CURRENT_CONTEXT.page_url, userMessageText, "user");
        }

        // Show animated loading
        const loadingMsgId = showLoadingDots();

        try {
            // Build conversation history for multi-turn chat
            const pageUrl = CURRENT_CONTEXT?.page_url;
            const urlHash = pageUrl ? simpleHash(pageUrl) : null;
            const conversationHistory = await aiService.buildConversationHistory(urlHash, userMessageText);
            const { systemInstruction } = aiService.constructPromptData(CURRENT_CONTEXT, userMessageText);

            // Call streaming API з callbacks
            await streamAIResponse(modelId, apiKey, conversationHistory, systemInstruction);

        } catch (e) {
            removeLoadingMessage();
            addMessage(`Error: ${e.message}`, "system");
        } finally {
            // Re-enable sending
            isProcessing = false;
            ELEMENTS.sendBtn.disabled = false;
            ELEMENTS.sendBtn.style.opacity = '1';
            ELEMENTS.sendBtn.style.cursor = 'pointer';
            ELEMENTS.generateBtn.disabled = false;
            ELEMENTS.generateBtn.style.opacity = '1';
        }
    }

    function sendMessage() {
        const text = ELEMENTS.userInput.innerText.trim();
        if (!text) return;

        // Don't send if already processing
        if (isProcessing) {
            return; // Keep text in input, don't clear
        }

        ELEMENTS.userInput.innerText = "";

        handleChatInteraction(text);
    }

    // --- UTILS ---
    function parseMarkdown(text) {
        if (!text) return "";

        let html = text;

        // Спочатку зберігаємо code blocks щоб вони не конфліктували з іншими правилами
        const codeBlocks = [];
        const inlineCodes = [];

        // 1. Зберігаємо багаторядкові code blocks з кнопкою копіювання
        html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
            const index = codeBlocks.length;
            const escapedCode = escapeHtml(code);
            codeBlocks.push(`<pre class="code-block-wrapper"><code>${escapedCode}</code><button class="copy-code-btn" data-code="${escapeHtml(escapedCode)}" title="Copy">📋</button></pre>`);
            return `🔸CODEBLOCK◆${index}◆`;
        });

        // 2. Зберігаємо inline code з кнопкою копіювання
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const index = inlineCodes.length;
            const escapedCode = escapeHtml(code);
            inlineCodes.push(`<code class="inline-code-wrapper">${escapedCode}<button class="copy-inline-btn" data-code="${escapedCode}" title="Copy">📋</button></code>`);
            return `🔹INLINECODE◆${index}◆`;
        });

        // 3. Tables (markdown tables)
        html = html.replace(/^\|(.+)\|$/gm, function (match) {
            const cells = match.split('|').filter(c => c.trim()).map(c => c.trim());

            // Check if this is a header separator line (e.g., |---|---|)
            if (cells.every(c => /^-+$/.test(c.trim()))) {
                return '___TABLE_SEP___';
            }

            // Regular table row
            return '|' + cells.join('|') + '|';
        });

        // Convert table blocks to HTML
        html = html.replace(/(^\|.+\|$\n___TABLE_SEP___\n(?:^\|.+\|$\n?)+)/gm, function (tableBlock) {
            const lines = tableBlock.trim().split('\n').filter(l => l !== '___TABLE_SEP___');
            if (lines.length < 2) return tableBlock;

            let tableHtml = '<table>';

            // Header
            const headerCells = lines[0].split('|').filter(c => c.trim()).map(c => c.trim());
            tableHtml += '<thead><tr>';
            headerCells.forEach(cell => {
                tableHtml += `<th>${cell}</th>`;
            });
            tableHtml += '</tr></thead>';

            // Body
            if (lines.length > 1) {
                tableHtml += '<tbody>';
                for (let i = 1; i < lines.length; i++) {
                    const rowCells = lines[i].split('|').filter(c => c.trim()).map(c => c.trim());
                    tableHtml += '<tr>';
                    rowCells.forEach(cell => {
                        tableHtml += `<td>${cell}</td>`;
                    });
                    tableHtml += '</tr>';
                }
                tableHtml += '</tbody>';
            }

            tableHtml += '</table>';
            return tableHtml;
        });

        // 4. Headers (multiline режим)
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // 4. Bold (non-greedy)
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/__(.+?)__/g, '<b>$1</b>');

        // 5. Italic (non-greedy, уникаємо конфлікту з bold)
        html = html.replace(/\*(?!\*)(.+?)\*(?!\*)/g, '<i>$1</i>');
        html = html.replace(/_(?!_)(.+?)_(?!_)/g, '<i>$1</i>');

        // 6. Lists
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

        // Обгортаємо послідовні <li> в <ul>
        html = html.replace(/(<li>.*?<\/li>\s*)+/g, (match) => {
            return '<ul>' + match + '</ul>';
        });

        // 7. Прибираємо зайві переноси рядків ПІСЛЯ списків
        html = html.replace(/<\/ul>\s*\n+/g, '</ul>');
        html = html.replace(/<\/li>\s*\n+/g, '</li>');

        // 8. Line breaks (звичайні)
        html = html.replace(/\n/g, '<br>');

        // 8. Відновлюємо code blocks
        html = html.replace(/🔸CODEBLOCK◆(\d+)◆/g, (match, index) => {
            return codeBlocks[parseInt(index)];
        });

        // 9. Відновлюємо inline code
        html = html.replace(/🔹INLINECODE◆(\d+)◆/g, (match, index) => {
            return inlineCodes[parseInt(index)];
        });

        return html;
    }

    // Допоміжна функція для екранування HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Attach copy button listeners to code blocks
    function attachCopyButtonListeners(container) {
        // Handle copy buttons for code blocks
        container.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const code = btn.dataset.code;
                await copyToClipboard(code, btn);
            };
        });

        // Handle copy buttons for inline code
        container.querySelectorAll('.copy-inline-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const code = btn.dataset.code;
                await copyToClipboard(code, btn);
            };
        });
    }

    // Copy text to clipboard with visual feedback
    async function copyToClipboard(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            const originalText = button.textContent;
            button.textContent = '✓';
            button.style.color = '#10B981';
            setTimeout(() => {
                button.textContent = originalText;
                button.style.color = '';
            }, 1500);
        } catch (err) {
            console.error('Failed to copy:', err);
            button.textContent = '✗';
            button.style.color = '#EF4444';
            setTimeout(() => {
                button.textContent = '📋';
                button.style.color = '';
            }, 1500);
        }
    }


    function renderMessage(text, type, timestampStr = null) {
        const div = document.createElement('div');
        div.className = `etsy-ai-msg ${type}`;
        if (type === 'ai' && !timestampStr) div.id = "loading-msg";

        // Apply Markdown for AI messages (not for loading state)
        if (type === 'ai' && text !== "Thinking...") {
            div.innerHTML = parseMarkdown(text);
            attachCopyButtonListeners(div);
        } else {
            div.innerText = text;
        }

        if (type !== 'ai' || timestampStr) {
            const time = document.createElement('span');
            time.className = 'etsy-ai-timestamp';
            const date = timestampStr ? new Date(timestampStr) : new Date();
            time.innerText = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            div.appendChild(time);
        }

        ELEMENTS.chatBox.appendChild(div);
        ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
    }

    function addMessage(text, type, isLoading = false) {
        if (isLoading) {
            renderMessage(text, type);
        } else {
            renderMessage(text, type, new Date().toISOString());
        }
    }

    let loadingInterval = null;

    function showLoadingDots() {
        // Remove any existing loading message first
        removeLoadingMessage();

        const div = document.createElement('div');
        div.className = 'etsy-ai-msg ai';
        div.id = "loading-msg";
        div.innerHTML = '<span class="etsy-ai-loading-dots"><span></span><span></span><span></span></span>';

        ELEMENTS.chatBox.appendChild(div);
        ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
    }

    function removeLoadingMessage() {
        if (loadingInterval) {
            clearInterval(loadingInterval);
            loadingInterval = null;
        }
        const loader = document.getElementById('loading-msg');
        if (loader) loader.remove();
    }

    function addSystemDivider(text) {
        const div = document.createElement('div');
        div.className = 'context-divider';
        div.innerHTML = `<span>${text}</span>`;
        ELEMENTS.chatBox.appendChild(div);
    }

    async function restoreState() {
        const result = await safeStorageGet(['current_context', 'preferred_model']);
        if (!result) return; // Extension context invalidated

        if (result.preferred_model) {
            setTimeout(() => {
                if (document.querySelector(`option[value="${result.preferred_model}"]`)) {
                    ELEMENTS.modelSelect.value = result.preferred_model;
                }
            }, 100);
        }
        if (result.current_context) {
            updateContext(result.current_context);
        }
    }

    // Обгортка для streaming AI відповіді з UI оновленнями
    async function streamAIResponse(modelId, apiKey, conversationHistory, systemInstruction) {
        // Create AI message div for streaming
        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.className = 'etsy-ai-msg ai';
        aiMsgDiv.id = 'streaming-msg';
        aiMsgDiv.style.display = 'none'; // Спочатку приховано
        ELEMENTS.chatBox.appendChild(aiMsgDiv);
        ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;

        // Callbacks для обробки streaming
        let firstChunk = true;
        const onChunk = (chunkText, fullText) => {
            if (firstChunk) {
                // Прибираємо loading (той, що був створений в handleChatInteraction), показуємо реальний div
                removeLoadingMessage();

                aiMsgDiv.style.display = 'block';
                firstChunk = false;
            }
            aiMsgDiv.innerHTML = parseMarkdown(fullText);
            attachCopyButtonListeners(aiMsgDiv);
            ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
        };

        const onComplete = async (fullText) => {
            // Finalize message
            aiMsgDiv.id = ''; // Remove streaming ID
            const timestamp = document.createElement('span');
            timestamp.className = 'etsy-ai-timestamp';
            timestamp.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            aiMsgDiv.appendChild(timestamp);

            // Save to storage
            if (CURRENT_CONTEXT?.page_url) {
                await saveChatToStorage(CURRENT_CONTEXT.page_url, fullText, "ai");
            }
        };

        const onError = (error) => {
            aiMsgDiv.remove();
            throw error;
        };

        // Викликаємо AI Service
        await aiService.streamMessage({
            modelId,
            apiKey,
            contents: conversationHistory,
            systemInstruction,
            onChunk,
            onComplete,
            onError
        });
    }

    // ===== CHAT HISTORY MANAGEMENT =====

    let currentSessionId = null;

    // Get or create session ID for current page
    function getSessionId(pageUrl) {
        if (!currentSessionId && pageUrl) {
            const urlHash = simpleHash(pageUrl);
            currentSessionId = `session_${urlHash}_${Date.now()}`;
        }
        return currentSessionId;
    }

    // Save current chat session
    async function saveCurrentSession() {
        if (!CURRENT_CONTEXT?.page_url) return;

        const pageUrl = CURRENT_CONTEXT.page_url;
        const urlHash = simpleHash(pageUrl);
        const sessionId = getSessionId(pageUrl);
        const key = `history_${urlHash}`;

        try {
            // Get current messages
            const result = await safeStorageGet([key]);
            if (!result) return; // Extension context invalidated
            const history = result[key] || [];

            if (history.length === 0) return; // Nothing to save

            // Generate session name from page title + time
            const pageTitle = CURRENT_CONTEXT.page_content?.title || CURRENT_CONTEXT.metadata?.title || 'Etsy Page';
            const timestamp = new Date().toLocaleString('uk-UA', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            const sessionName = `${pageTitle} - ${timestamp}`;

            // Get sessions index
            const indexKey = 'sessions_index_all';
            const indexResult = await safeStorageGet([indexKey]);
            if (!indexResult) return; // Extension context invalidated
            const sessionsIndex = indexResult[indexKey] || [];

            // Add session to index
            const sessionData = {
                id: sessionId,
                name: sessionName,
                pageTitle: pageTitle,
                pageUrl: pageUrl,
                timestamp: new Date().toISOString(),
                messageCount: history.length,
                messages: history
            };

            sessionsIndex.push(sessionData);

            // Save index
            await safeStorageSet({ [indexKey]: sessionsIndex });

            console.log('Session saved:', sessionName);
        } catch (e) {
            console.error('Failed to save session:', e);
        }
    }

    // Open history modal
    async function openHistory() {
        if (!CURRENT_CONTEXT?.page_url) {
            addMessage("⚠️ No page detected. Open an Etsy page first.", "system");
            return;
        }

        const indexKey = 'sessions_index_all';
        const indexResult = await safeStorageGet([indexKey]);
        if (!indexResult) return; // Extension context invalidated
        const sessionsIndex = indexResult[indexKey] || [];

        // Clear and populate history list
        ELEMENTS.historyList.innerHTML = '';

        if (sessionsIndex.length === 0) {
            ELEMENTS.historyList.innerHTML = '<div class="history-empty">No chat history yet.<br>Start a conversation to create history.</div>';
        } else {
            // Sort by timestamp (newest first)
            sessionsIndex.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            sessionsIndex.forEach(session => {
                const item = document.createElement('div');
                item.className = 'history-item';

                const titleRow = document.createElement('div');
                titleRow.className = 'history-item-title-row';

                const title = document.createElement('div');
                title.className = 'history-item-title';
                title.textContent = session.name;

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'history-item-delete';
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = 'Delete this chat';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteHistorySession(session.id);
                });

                titleRow.appendChild(title);
                titleRow.appendChild(deleteBtn);

                const meta = document.createElement('div');
                meta.className = 'history-item-meta';
                const date = new Date(session.timestamp);
                meta.innerHTML = `
                <span>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>${session.messageCount} messages</span>
            `;

                item.appendChild(titleRow);
                item.appendChild(meta);

                item.addEventListener('click', () => {
                    loadChatSession(session);
                    closeHistory();
                });

                ELEMENTS.historyList.appendChild(item);
            });
        }

        ELEMENTS.historyOverlay.classList.add('visible');
    }

    // Close history modal
    function closeHistory() {
        ELEMENTS.historyOverlay.classList.remove('visible');
    }

    // Delete a history session
    async function deleteHistorySession(sessionId) {
        const indexKey = 'sessions_index_all';
        const indexResult = await safeStorageGet([indexKey]);
        if (!indexResult) return; // Extension context invalidated
        const sessionsIndex = indexResult[indexKey] || [];

        // Remove session from index
        const updatedIndex = sessionsIndex.filter(s => s.id !== sessionId);
        await safeStorageSet({ [indexKey]: updatedIndex });

        // Refresh history display
        openHistory();
    }

    // Load a specific chat session
    function loadChatSession(session) {
        // Clear current chat
        ELEMENTS.chatBox.innerHTML = '';

        // Load messages
        addSystemDivider(`Session: ${session.name}`);
        session.messages.forEach(msg => {
            renderMessage(msg.text, msg.type, msg.timestamp);
        });

        addSystemDivider('Session Loaded - Continue Chatting');
    }

    // Start new chat (clear current, save to history)
    async function startNewChat() {
        if (!CURRENT_CONTEXT?.page_url) {
            addMessage("⚠️ No page detected. Navigate to an Etsy page first.", "system");
            return;
        }

        // Check if there are any messages to save
        const pageUrl = CURRENT_CONTEXT.page_url;
        const urlHash = simpleHash(pageUrl);
        const key = `history_${urlHash}`;
        const result = await safeStorageGet([key]);
        if (!result) return; // Extension context invalidated
        const currentMessages = result[key] || [];

        // Only save if there are actual user/AI messages (not just system messages)
        const realMessages = currentMessages.filter(m => m.type === 'user' || m.type === 'ai');
        if (realMessages.length > 0) {
            await saveCurrentSession();
        }

        // Clear current session
        currentSessionId = null;

        // Clear storage for current session
        await safeStorageSet({ [key]: [] });

        // Clear UI
        ELEMENTS.chatBox.innerHTML = '';
    }

    // Update the existing updateContext function to handle session management
    const originalUpdateContext = updateContext;
    updateContext = async function (data) {
        if (!data) return;

        const prevUrl = CURRENT_CONTEXT?.page_url;
        const newUrl = data.page_url;

        // If switching to a different page, save current session first
        if (newUrl && prevUrl && prevUrl !== newUrl) {
            await saveCurrentSession();
            currentSessionId = null; // Reset for new page
        }

        // Call original function
        await originalUpdateContext.call(this, data);
    };
}
console.log('🍬 Etsy AI: Chat Ready');
