// chat_ui.js - Floating Chat UI

// ============================================
// Early Extension Context Check
// ============================================
// This must run FIRST before any chrome.* API calls
if (!chrome.runtime?.id) {
    console.error('🔴 Extension context is invalid - cannot initialize chat UI');
    // We can't inject CSS or UI, so we're done here
    // The interval check in initChat will catch this if context becomes invalid later
} else {
    // Inject CSS
    try {
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = chrome.runtime.getURL('content/chat_ui.css');
        document.head.appendChild(cssLink);
    } catch (e) {
        console.error('⚠️ Failed to inject CSS:', e);
    }

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

    async function appendAiDiagnostic(entry) {
        if (!chrome.runtime?.id) return;

        try {
            const result = await chrome.storage.local.get(['AI_DIAGNOSTICS']);
            const diagnostics = Array.isArray(result.AI_DIAGNOSTICS) ? result.AI_DIAGNOSTICS : [];
            diagnostics.push({
                ts: new Date().toISOString(),
                ...entry
            });
            await chrome.storage.local.set({
                AI_DIAGNOSTICS: diagnostics.slice(-20)
            });
        } catch (error) {
            console.warn('Failed to write AI diagnostics:', error);
        }
    }

    let aiService = null; // Will be loaded dynamically via factory

    let CONFIG = {
        apiKeys: {
            google: ""
        },
        models: [] // LoadedDynamically
    };
    let CURRENT_CONTEXT = null;
    let isProcessing = false; // Prevent multiple simultaneous messages
    let currentChatId = null; // ID for current chat session
    let currentChatTitle = null; // AI-generated title (will be set after first exchange)
    let loadedSessionId = null; // ID of loaded session from history (to update instead of duplicate)
    let lastUserMessage = null; // Stores last user message context for retry functionality
    const DEFAULT_SUGGEST_RESPONSE_PROMPT = "Draft a cautious customer reply based on the Etsy conversation and page context. Do not accept custom work, promise feasibility, promise timing, or promise an exact result unless I explicitly approved it. If the customer asks for custom work, ask for needed details/references and say we will review before confirming. If the request sounds risky or unrealistic, politely decline or explain that we need to check first.";

    const ELEMENTS = {
        statusDot: document.getElementById('connection-status'),
        versionLabel: document.getElementById('extension-version'),
        pageTitle: document.getElementById('page-title'), // New element
        chatBox: document.getElementById('chat-box'),
        userInput: document.getElementById('user-input'),
        sendBtn: document.getElementById('send-btn'),
        generateBtn: document.getElementById('generate-btn'),
        modelSelect: document.getElementById('model-select'),
        // Settings
        settingsBtn: document.getElementById('settings-btn'),
        settingsOverlay: document.getElementById('settings-overlay'),
        geminiApiKeyInput: document.getElementById('gemini-api-key-input'),
        deepseekApiKeyInput: document.getElementById('deepseek-api-key-input'),
        grokApiKeyInput: document.getElementById('grok-api-key-input'),
        saveSettingsBtn: document.getElementById('save-settings'),
        cancelSettingsBtn: document.getElementById('cancel-settings'),
        copyDiagnosticsBtn: document.getElementById('copy-diagnostics'),
        clearDiagnosticsBtn: document.getElementById('clear-diagnostics'),
        diagnosticsCount: document.getElementById('diagnostics-count'),
        customInstructionsWarning: document.getElementById('custom-instructions-warning'),
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
        // Immediate page-title fallback so the header never stays blank while we wait
        // for content.js to broadcast parsed context.
        if (ELEMENTS.pageTitle && !ELEMENTS.pageTitle.textContent.trim()) {
            ELEMENTS.pageTitle.textContent = document.title || 'Etsy';
            ELEMENTS.pageTitle.title = location.href;
        }

        if (ELEMENTS.versionLabel) {
            ELEMENTS.versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
        }

        // Check if extension context is valid BEFORE doing anything
        if (!chrome.runtime?.id) {
            console.error('🔴 Extension context invalidated - extension was reloaded/updated');
            showExtensionReloadedBanner();
            return; // Don't initialize anything
        }

        await handleBrowserRestart(); // Auto-save previous chat if exists
        await loadConfiguration();
        window.ShopIntelligenceManager?.maybeBootstrap('startup');
        restoreState();
        setupListeners();
        await loadCurrentChat(); // Load or start fresh chat

        // Request context from current page
        chrome.storage.local.get(['current_context'], (result) => {
            if (result.current_context) {
                updateContext(result.current_context);
            }
        });

        // Extension reload detection is handled by safeStorageGet/Set wrappers
        // No need for periodic polling - errors will be caught on-demand
    })();

    // --- CONFIGURATION ---
    async function loadConfiguration() {
        // 1. Load models from config.js (window.ETSY_AI_CONFIG) - now using providers
        // Drop the early populate — will be called after keys are loaded (see step 2)
        if (!window.ETSY_AI_CONFIG?.providers) {
            // Fallback if config.js not loaded
            CONFIG.models = [
                { id: "gemini-3-flash-preview", name: "Gemini 3.0 Flash", provider: "gemini" }
            ];
            ELEMENTS.modelSelect.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = CONFIG.models[0].id;
            opt.dataset.provider = 'gemini';
            opt.textContent = CONFIG.models[0].name;
            ELEMENTS.modelSelect.appendChild(opt);
        }

        // 2. Load API keys from Storage - now checking all providers
        const result = await safeStorageGet(['selected_provider', 'gemini_api_key', 'deepseek_api_key', 'grok_api_key', 'openrouter_api_key', 'preferred_model']);
        if (!result) {
            // Extension context invalidated - storage unavailable
            console.error('⚠️ Storage unavailable - extension context may be invalid');
            addMessage("⚠️ Extension is initializing. If this persists, please reload the page (F5).", "system");
            return; // Don't proceed, don't open settings
        }

        // Load API keys for all providers
        const availableKeys = {
            gemini: result.gemini_api_key || null,
            deepseek: result.deepseek_api_key || null,
            grok: result.grok_api_key || null,
            openrouter: result.openrouter_api_key || null
        };

        if (result.gemini_api_key) {
            CONFIG.apiKeys.google = result.gemini_api_key;
        }

        // OpenRouter always has a built-in key — always counts as having an available provider
        const hasAnyKey = PROVIDERS_WITH_BUILTIN_KEY.size > 0 ||
            Object.values(availableKeys).some(key => key && key.trim());

        // Repopulate with key info available (to filter out providers without keys)
        populateModelDropdown(availableKeys);

        // Restore previously selected model if it exists in the current dropdown
        if (result.preferred_model) {
            ELEMENTS.modelSelect.value = result.preferred_model;
            // If value didn't match any option, fall through to detection below
            if (ELEMENTS.modelSelect.value !== result.preferred_model) {
                // Stored model not in dropdown (provider removed/no key) — pick a default
                result.preferred_model = null;
            }
        }

        // 3. Set default model - prefer one with available API key
        if (!result.preferred_model) {
            let selectedModel = null;

            // Try to find a model with an available API key
            if (window.ETSY_AI_CONFIG?.defaultProvider &&
                (availableKeys[window.ETSY_AI_CONFIG.defaultProvider] || window.ETSY_AI_CONFIG.defaultProvider === 'openrouter')) {
                const defaultProvider = window.ETSY_AI_CONFIG.providers.find(p => p.id === window.ETSY_AI_CONFIG.defaultProvider);
                if (defaultProvider && defaultProvider.defaultModel) {
                    selectedModel = defaultProvider.defaultModel;
                }
            } else {
                // Find first provider with an available key
                for (const provider of window.ETSY_AI_CONFIG.providers) {
                    if (availableKeys[provider.id] || provider.id === 'openrouter') {
                        selectedModel = provider.defaultModel;
                        break;
                    }
                }
            }

            // Fallback to default provider's model if none found
            if (!selectedModel && window.ETSY_AI_CONFIG?.defaultProvider) {
                const defaultProvider = window.ETSY_AI_CONFIG.providers.find(p => p.id === window.ETSY_AI_CONFIG.defaultProvider);
                if (defaultProvider) {
                    selectedModel = defaultProvider.defaultModel;
                }
            }

            if (selectedModel) {
                ELEMENTS.modelSelect.value = selectedModel;
                await safeStorageSet({ 'preferred_model': selectedModel });
            }
        }

        // 4. Show settings only if NO API keys configured at all
        if (!hasAnyKey) {
            addMessage("⚠️ Please configure at least one API Key in Settings.", "system");
            openSettings();
        }
    }

    // Providers that always work without a user-supplied key (have a built-in key)
    const PROVIDERS_WITH_BUILTIN_KEY = new Set(['openrouter']);

    function populateModelDropdown(availableKeys = {}) {
        ELEMENTS.modelSelect.innerHTML = "";

        if (!window.ETSY_AI_CONFIG?.providers) return;

        window.ETSY_AI_CONFIG.providers.forEach(provider => {
            // Skip providers without a key and without a built-in key
            const hasKey = availableKeys[provider.id] ||
                PROVIDERS_WITH_BUILTIN_KEY.has(provider.id);
            if (!hasKey) return;

            if (provider.models.length === 1) {
                // Single-model provider → flat option
                const model = provider.models[0];
                const option = document.createElement('option');
                option.value = model.id;
                option.dataset.provider = provider.id;
                option.textContent = `${provider.name} — ${model.name}`;
                ELEMENTS.modelSelect.appendChild(option);
            } else {
                // Multi-model provider → optgroup
                const group = document.createElement('optgroup');
                group.label = provider.name;
                provider.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.dataset.provider = provider.id;
                    option.textContent = model.name;
                    group.appendChild(option);
                });
                ELEMENTS.modelSelect.appendChild(group);
            }
        });

        // Sync CONFIG.models for backward compat (used elsewhere)
        CONFIG.models = [];
        window.ETSY_AI_CONFIG.providers.forEach(provider => {
            provider.models.forEach(model => {
                CONFIG.models.push({ id: model.id, name: model.name, provider: provider.id });
            });
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
        ELEMENTS.generateBtn.addEventListener('click', async () => {
            const prompt = window.AgentPolicyManager
                ? await window.AgentPolicyManager.getSuggestResponsePrompt(DEFAULT_SUGGEST_RESPONSE_PROMPT)
                : DEFAULT_SUGGEST_RESPONSE_PROMPT;
            handleChatInteraction(prompt, true);
        });

        // Settings
        ELEMENTS.settingsBtn.addEventListener('click', openSettings);
        ELEMENTS.saveSettingsBtn.addEventListener('click', saveSettings);
        ELEMENTS.copyDiagnosticsBtn?.addEventListener('click', copyDiagnosticsToClipboard);
        ELEMENTS.clearDiagnosticsBtn?.addEventListener('click', clearDiagnostics);
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
                window.ShopIntelligenceManager?.maybeBootstrap('context_changed');
            }
            if (namespace === 'local' && changes.custom_instructions) {
                updateCustomInstructionsWarning(changes.custom_instructions.newValue);
            }
        });

        ELEMENTS.modelSelect.addEventListener('change', async () => {
            const selectedModelId = ELEMENTS.modelSelect.value;
            await safeStorageSet({ 'preferred_model': selectedModelId });

            // Check if selected model has API key — skip for providers with built-in key
            const selectedOption = ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex];
            const providerId = selectedOption ? selectedOption.dataset.provider : null;

            if (providerId && !PROVIDERS_WITH_BUILTIN_KEY.has(providerId)) {
                const apiKey = await window.AIServiceFactory.getApiKey(providerId);

                if (!apiKey || !apiKey.trim()) {
                    // Show settings with focus on the appropriate field
                    openSettingsForProvider(providerId);
                }
            }
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
    async function openSettings() {
        // Load all API keys
        const result = await safeStorageGet(['gemini_api_key', 'deepseek_api_key', 'grok_api_key', 'custom_instructions']);

        if (!result) {
            // Storage unavailable - don't open settings with empty fields
            addMessage("❌ Cannot open settings - extension is reloading. Please reload this page (F5) and try again.", "system");
            console.error('⚠️ Cannot open settings - storage unavailable');
            return;
        }

        ELEMENTS.geminiApiKeyInput.value = result.gemini_api_key || '';
        ELEMENTS.deepseekApiKeyInput.value = result.deepseek_api_key || '';
        ELEMENTS.grokApiKeyInput.value = result.grok_api_key || '';
        updateCustomInstructionsWarning(result.custom_instructions || '');
        await updateDiagnosticsCount();

        ELEMENTS.settingsOverlay.classList.add('visible');
        ELEMENTS.geminiApiKeyInput.focus();
    }

    async function openSettingsForProvider(providerId) {
        // Load all API keys
        const result = await safeStorageGet(['gemini_api_key', 'deepseek_api_key', 'grok_api_key', 'custom_instructions']);

        if (!result) {
            // Storage unavailable - don't open settings with empty fields
            addMessage("❌ Cannot open settings - extension is reloading. Please reload this page (F5) and try again.", "system");
            console.error('⚠️ Cannot open settings - storage unavailable');
            return;
        }

        ELEMENTS.geminiApiKeyInput.value = result.gemini_api_key || '';
        ELEMENTS.deepseekApiKeyInput.value = result.deepseek_api_key || '';
        ELEMENTS.grokApiKeyInput.value = result.grok_api_key || '';
        updateCustomInstructionsWarning(result.custom_instructions || '');

        // Focus on the specific provider's input
        setTimeout(() => {
            switch (providerId) {
                case 'gemini':
                    ELEMENTS.geminiApiKeyInput.focus();
                    break;
                case 'deepseek':
                    ELEMENTS.deepseekApiKeyInput.focus();
                    break;
                case 'grok':
                    ELEMENTS.grokApiKeyInput.focus();
                    break;
                default:
                    ELEMENTS.geminiApiKeyInput.focus();
            }
        }, 100);

        ELEMENTS.settingsOverlay.classList.add('visible');

        // Show message about missing API key
        const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
        addMessage(`⚠️ Please configure your ${providerName} API Key to use this model.`, "system");
    }

    function updateCustomInstructionsWarning(customInstructions) {
        if (!ELEMENTS.customInstructionsWarning) return;
        ELEMENTS.customInstructionsWarning.style.display = customInstructions?.trim() ? 'block' : 'none';
    }

    function closeSettings() {
        ELEMENTS.settingsOverlay.classList.remove('visible');
    }

    async function saveSettings() {
        const geminiKey = ELEMENTS.geminiApiKeyInput.value.trim();
        const deepseekKey = ELEMENTS.deepseekApiKeyInput.value.trim();
        const grokKey = ELEMENTS.grokApiKeyInput.value.trim();

        // First, load existing keys to avoid overwriting with empty values
        const existingKeys = await safeStorageGet(['gemini_api_key', 'deepseek_api_key', 'grok_api_key']);

        if (!existingKeys) {
            // Extension context is invalid
            addMessage("❌ Failed to load existing keys. Please reload this page (F5) and try again.", "system");
            console.error('⚠️ Cannot load existing keys - extension context invalid.');
            return; // Don't close settings
        }

        // Build update object - only include keys that were actually changed
        const updates = {};

        // Only update if value is provided (non-empty)
        // If field is empty, keep existing value
        if (geminiKey) {
            updates.gemini_api_key = geminiKey;
        } else if (existingKeys.gemini_api_key) {
            updates.gemini_api_key = existingKeys.gemini_api_key; // Preserve existing
        }

        if (deepseekKey) {
            updates.deepseek_api_key = deepseekKey;
        } else if (existingKeys.deepseek_api_key) {
            updates.deepseek_api_key = existingKeys.deepseek_api_key; // Preserve existing
        }

        if (grokKey) {
            updates.grok_api_key = grokKey;
        } else if (existingKeys.grok_api_key) {
            updates.grok_api_key = existingKeys.grok_api_key; // Preserve existing
        }

        // Save all keys
        const saveSuccess = await safeStorageSet(updates);

        // Check if save was successful
        if (!saveSuccess) {
            // Extension context is invalid, show error and keep settings open
            addMessage("❌ Failed to save API keys. Please reload this page (F5) and try again.", "system");
            console.error('⚠️ Cannot save API keys - extension context invalid. User should reload the page.');
            return; // Don't close settings
        }

        // Update in-memory config for backward compatibility
        if (geminiKey) CONFIG.apiKeys.google = geminiKey;
        else if (existingKeys.gemini_api_key) CONFIG.apiKeys.google = existingKeys.gemini_api_key;

        console.log('✅ API Keys saved successfully');
        closeSettings();
        addMessage("✅ API Keys Saved", "system");
    }

    async function copyDiagnosticsToClipboard() {
        const result = await safeStorageGet(['AI_DIAGNOSTICS']);
        if (!result) return;

        const diagnostics = Array.isArray(result.AI_DIAGNOSTICS) ? result.AI_DIAGNOSTICS : [];
        if (diagnostics.length === 0) {
            addMessage('No AI diagnostics recorded yet.', 'system');
            return;
        }

        const payload = JSON.stringify({
            exported_at: new Date().toISOString(),
            app: 'Etsy AI Assistant',
            diagnostics
        }, null, 2);

        try {
            await navigator.clipboard.writeText(payload);
            addMessage(`Copied ${diagnostics.length} AI diagnostic record(s).`, 'system');
            updateDiagnosticsCount(diagnostics.length);
        } catch (error) {
            console.error('Failed to copy AI diagnostics:', error);
            addMessage('Failed to copy diagnostics. Open DevTools and inspect AI_DIAGNOSTICS in chrome.storage.local.', 'system');
        }
    }

    async function clearDiagnostics() {
        const ok = await safeStorageSet({ AI_DIAGNOSTICS: [] });
        if (!ok) return;
        updateDiagnosticsCount(0);
        addMessage('AI diagnostics cleared.', 'system');
    }

    async function updateDiagnosticsCount(knownCount = null) {
        if (!ELEMENTS.diagnosticsCount) return;
        let count = knownCount;
        if (count === null) {
            const result = await safeStorageGet(['AI_DIAGNOSTICS']);
            if (!result) return;
            count = Array.isArray(result.AI_DIAGNOSTICS) ? result.AI_DIAGNOSTICS.length : 0;
        }
        ELEMENTS.diagnosticsCount.textContent = `${count} record${count === 1 ? '' : 's'}`;
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

    // Handle browser/extension restart: auto-save old chat
    async function handleBrowserRestart() {
        const result = await safeStorageGet(['current_chat_messages', 'current_chat_metadata']);
        if (!result) return;

        const messages = result.current_chat_messages || [];
        const metadata = result.current_chat_metadata || {};

        // If there are messages from previous session, save them to history
        const realMessages = messages.filter(m => m.type === 'user' || m.type === 'ai');
        if (realMessages.length > 0) {
            // Check if this is a loaded session (stored in metadata)
            if (metadata.loaded_session_id) {
                console.log('� Chat was loaded from history, updating existing session:', metadata.loaded_session_id);
                // Set loadedSessionId so it updates instead of creating duplicate
                loadedSessionId = metadata.loaded_session_id;
            } else {
                console.log('📦 Auto-saving new chat to history...');
                loadedSessionId = null; // Ensure it's treated as new
            }

            await saveGlobalChatToHistory(messages, metadata);

            // Clear the global chat for fresh start
            await safeStorageSet({
                current_chat_messages: [],
                current_chat_metadata: {}
            });
        }

        // Reset loaded session ID after saving
        loadedSessionId = null;
    }

    // Load current global chat on initialization
    async function loadCurrentChat() {
        const result = await safeStorageGet(['current_chat_messages']);
        if (!result) return;

        const messages = (result.current_chat_messages || []).filter(msg => !isTransientSystemMessage(msg));

        if (messages.length > 0) {
            messages.forEach(msg => {
                renderMessage(msg.text, msg.type, msg.timestamp);
            });
        }
    }

    // Simple hash function for generating IDs
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    function isTransientSystemMessage(msg) {
        if (!msg || msg.type !== 'system') return false;

        const text = String(msg.text || '').trim();
        return text === '✅ API Keys Saved'
            || /^⚠️ Please configure your .+ API Key to use this model\.$/.test(text)
            || text === '⚠️ Please configure at least one API Key in Settings.'
            || text === 'No AI diagnostics recorded yet.'
            || /^Copied \d+ AI diagnostic record\(s\)\.$/.test(text)
            || text === 'AI diagnostics cleared.';
    }

    function removeTransientSystemMessagesFromUi() {
        const messages = ELEMENTS.chatBox?.querySelectorAll('.etsy-ai-msg.system');
        if (!messages) return;

        messages.forEach(messageEl => {
            const clone = messageEl.cloneNode(true);
            clone.querySelectorAll('.etsy-ai-timestamp, button').forEach(el => el.remove());
            const text = clone.textContent.trim();
            if (isTransientSystemMessage({ text, type: 'system' })) {
                messageEl.remove();
            }
        });
    }

    async function clearTransientSystemMessagesBeforeRealChat() {
        const result = await safeStorageGet(['current_chat_messages']);
        if (!result) return;

        const messages = result.current_chat_messages || [];
        const hasRealMessages = messages.some(msg => msg.type === 'user' || msg.type === 'ai');
        if (hasRealMessages) return;

        const cleanedMessages = messages.filter(msg => !isTransientSystemMessage(msg));
        if (cleanedMessages.length !== messages.length) {
            await safeStorageSet({ current_chat_messages: cleanedMessages });
        }

        removeTransientSystemMessagesFromUi();
    }

    // Save message to global chat storage
    async function saveChatToStorage(text, type) {
        const key = 'current_chat_messages';

        try {
            const result = await safeStorageGet([key, 'current_chat_metadata']);
            if (!result) return;

            const messages = result[key] || [];
            const metadata = result.current_chat_metadata || {};

            const newMsg = {
                text,
                type,
                timestamp: new Date().toISOString()
            };

            messages.push(newMsg);
            if (messages.length > 100) messages.shift(); // Increased limit for global chat

            // Update metadata
            const now = new Date().toISOString();
            if (!metadata.created_at) {
                metadata.created_at = now;
            }
            metadata.updated_at = now;

            await safeStorageSet({
                [key]: messages,
                current_chat_metadata: metadata
            });
        } catch (e) {
            console.error("Failed to save to global chat:", e);
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
        const provider = selectedOption ? selectedOption.dataset.provider : "gemini";

        // Get API key for the provider (skip check for providers with built-in key)
        if (!PROVIDERS_WITH_BUILTIN_KEY.has(provider)) {
            try {
                const apiKey = await window.AIServiceFactory.getApiKey(provider);

                if (!apiKey || !apiKey.trim()) {
                    console.warn('⚠️ No API key found for provider:', provider);
                    ELEMENTS.sendBtn.disabled = false;
                    ELEMENTS.sendBtn.style.opacity = '1';
                    ELEMENTS.sendBtn.style.cursor = 'pointer';
                    ELEMENTS.sendBtn.style.pointerEvents = 'auto';
                    ELEMENTS.generateBtn.disabled = false;
                    ELEMENTS.generateBtn.style.opacity = '1';
                    ELEMENTS.generateBtn.style.pointerEvents = 'auto';
                    openSettingsForProvider(provider);
                    return;
                }
            } catch (e) {
                console.error('Failed to get API key:', e);
                ELEMENTS.sendBtn.disabled = false;
                ELEMENTS.sendBtn.style.opacity = '1';
                ELEMENTS.sendBtn.style.cursor = 'pointer';
                ELEMENTS.sendBtn.style.pointerEvents = 'auto';
                ELEMENTS.generateBtn.disabled = false;
                ELEMENTS.generateBtn.style.opacity = '1';
                ELEMENTS.generateBtn.style.pointerEvents = 'auto';
                addMessage("⚠️ Extension error. Please refresh the page.", "system");
                return;
            }
        }

        // Clear input only after validation passes
        ELEMENTS.userInput.innerText = "";

        // Set processing state
        isProcessing = true;
        ELEMENTS.sendBtn.disabled = true;
        ELEMENTS.sendBtn.style.opacity = '0.5';
        ELEMENTS.sendBtn.style.cursor = 'not-allowed';
        ELEMENTS.generateBtn.disabled = true;
        ELEMENTS.generateBtn.style.opacity = '0.5';

        // 2. Show User Message
        await clearTransientSystemMessagesBeforeRealChat();
        renderMessage(userMessageText, "user");

        // 3. Save User Msg to global chat
        await saveChatToStorage(userMessageText, "user");

        // Show animated loading
        const loadingMsgId = showLoadingDots();

        try {
            // ===== REQUEST FRESH CONTEXT ON-DEMAND =====
            if (window.EtsyAI_GetFreshContext) {
                const freshContext = window.EtsyAI_GetFreshContext();
                if (freshContext) {
                    CURRENT_CONTEXT = freshContext;
                } else {
                    console.warn('⚠️ Failed to extract fresh context');
                }
            } else {
                console.error('⚠️ EtsyAI_GetFreshContext not available - content.js may not be loaded yet');
            }

            // Get AI service instance for the SPECIFIC provider of selected model
            // This ensures we use the correct API (Gemini/DeepSeek/Grok) for the selected model
            aiService = await window.AIServiceFactory.getCurrentService(provider);

            if (!aiService) {
                throw new Error('Failed to initialize AI service');
            }

            // Get API key for the current provider
            // For providers with built-in keys (e.g. OpenRouter), pass null — the service handles it internally
            let providerApiKey = null;
            if (!PROVIDERS_WITH_BUILTIN_KEY.has(provider)) {
                providerApiKey = await window.AIServiceFactory.getApiKey(provider);
                if (!providerApiKey) {
                    throw new Error(`No API key configured for provider: ${provider}`);
                }
            }

            const providerModelId = await window.AIServiceFactory.getModelId(provider);

            const imageIntelMetadata = isSystemAction && window.ImageIntelligenceManager
                ? await window.ImageIntelligenceManager.analyzeCurrentCustomerImages({ onStatus: showAiStatus })
                : (window.ImageIntelligenceManager ? window.ImageIntelligenceManager.getMetadata() : {});

            // Build conversation history for multi-turn chat from global storage
            const conversationHistory = await aiService.buildConversationHistory('global_chat', userMessageText);
            const { systemInstruction } = await aiService.constructPromptData(CURRENT_CONTEXT, userMessageText);
            const promptMetadata = BaseAIService.INSTRUCTIONS.lastBuildMetadata || {};
            const shopIntelMetadata = window.ShopIntelligenceManager
                ? await window.ShopIntelligenceManager.getMetadata()
                : {};

            // Store minimal message context for retry functionality (history will be rebuilt on retry)
            lastUserMessage = {
                text: userMessageText,
                provider: provider,
                modelId: providerModelId,
                apiKey: providerApiKey
            };

            // Pass messages instead of contents to be provider-agnostic
            await streamAIResponse(providerModelId, providerApiKey, conversationHistory, systemInstruction, {
                ...promptMetadata,
                ...shopIntelMetadata,
                ...imageIntelMetadata
            });

        } catch (e) {
            removeLoadingMessage();
            addErrorMessage(e.message, lastUserMessage);
        } finally {
            // Re-enable sending
            isProcessing = false;
            ELEMENTS.sendBtn.disabled = false;
            ELEMENTS.sendBtn.style.opacity = '1';
            ELEMENTS.sendBtn.style.cursor = 'pointer';
            ELEMENTS.sendBtn.style.pointerEvents = 'auto';
            ELEMENTS.generateBtn.disabled = false;
            ELEMENTS.generateBtn.style.opacity = '1';
            ELEMENTS.generateBtn.style.pointerEvents = 'auto';
        }
    }

    function sendMessage() {
        const text = ELEMENTS.userInput.innerText.trim();
        if (!text) return;

        // Don't send if already processing
        if (isProcessing) {
            return; // Keep text in input, don't clear
        }

        // Memory commands ("запам'ятай…", "забудь…") are handled locally — no AI call.
        if (window.MemoryManager) {
            const cmd = window.MemoryManager.detectCommand(text);
            if (cmd) {
                ELEMENTS.userInput.innerText = "";
                handleMemoryCommand(text, cmd).catch(err => {
                    console.error('MemoryManager error:', err);
                    renderMessage(`❌ Memory error: ${err.message || err}`, "system");
                });
                return;
            }
        }

        // Disable buttons IMMEDIATELY to prevent double-clicks during lag
        ELEMENTS.sendBtn.disabled = true;
        ELEMENTS.sendBtn.style.opacity = '0.5';
        ELEMENTS.sendBtn.style.cursor = 'not-allowed';
        ELEMENTS.sendBtn.style.pointerEvents = 'none';
        ELEMENTS.generateBtn.disabled = true;
        ELEMENTS.generateBtn.style.opacity = '0.5';
        ELEMENTS.generateBtn.style.pointerEvents = 'none';

        handleChatInteraction(text);
    }

    async function handleMemoryCommand(originalText, cmd) {
        await clearTransientSystemMessagesBeforeRealChat();
        addMessage(originalText, "user");
        await saveChatToStorage(originalText, "user");

        let reply = '';
        try {
            if (cmd.action === 'add') {
                const res = await window.MemoryManager.add(cmd.text);
                if (!res) reply = "⚠️ Could not save an empty memory.";
                else if (res.duplicate) reply = `ℹ️ Already remembered: "${res.entry.text}"`;
                else reply = `💾 Remembered: "${res.entry.text}"`;
            } else if (cmd.action === 'remove') {
                const res = await window.MemoryManager.removeByKeyword(cmd.keyword);
                if (res.removed === 0) {
                    reply = `🤔 I could not find any memory about "${cmd.keyword}".`;
                } else {
                    const preview = res.entries.map(e => `• ${e.text}`).join('\n');
                    reply = `🗑️ Removed (${res.removed}):\n${preview}`;
                }
            } else if (cmd.action === 'clear') {
                await window.MemoryManager.clear();
                reply = "🗑️ All memory cleared.";
            }
        } catch (e) {
            reply = `❌ Memory error: ${e.message || e}`;
        }

        addMessage(reply, "system");
        await saveChatToStorage(reply, "system");
    }

    // --- UTILS ---
    function parseMarkdown(text) {
        if (!text) return "";

        let html = text;

        // Спочатку зберігаємо code blocks щоб вони не конфліктували з іншими правилами
        const codeBlocks = [];
        const inlineCodes = [];

        // 1. Зберігаємо багаторядкові code blocks з кнопкою копіювання
        // Updated regex: ```language (optional) followed by code content
        html = html.replace(/```(?:\w+)?\s*\n?([\s\S]*?)```/g, (match, code) => {
            const index = codeBlocks.length;
            const escapedCode = escapeHtml(code.trim());
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

        // 5. Markdown Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        });

        // 6. Bold (non-greedy)
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/__(.+?)__/g, '<b>$1</b>');

        // 7. Italic (non-greedy, уникаємо конфлікту з bold)
        html = html.replace(/\*(?!\*)(.+?)\*(?!\*)/g, '<i>$1</i>');
        html = html.replace(/_(?!_)(.+?)_(?!_)/g, '<i>$1</i>');

        // 8. Lists (bullet and numbered)
        // Use unique markers to distinguish numbered vs bullet lists

        // Process numbered lists (1., 2., 3., etc.) - mark as ordered
        html = html.replace(/^(\d+)\.\s+(.+)$/gm, '🔢ORDERED_LI🔢$2🔢/ORDERED_LI🔢');

        // Process bullet lists (-, *) - mark as unordered
        html = html.replace(/^[\-\*] (.+)$/gm, '🔹UNORDERED_LI🔹$1🔹/UNORDERED_LI🔹');

        // Wrap consecutive ordered list items in <ol>
        html = html.replace(/(🔢ORDERED_LI🔢.*?🔢\/ORDERED_LI🔢\s*)+/g, (match) => {
            // Convert markers to actual HTML
            const items = match.replace(/🔢ORDERED_LI🔢/g, '<li>').replace(/🔢\/ORDERED_LI🔢/g, '</li>');
            return '<ol>' + items + '</ol>';
        });

        // Wrap consecutive unordered list items in <ul>
        html = html.replace(/(🔹UNORDERED_LI🔹.*?🔹\/UNORDERED_LI🔹\s*)+/g, (match) => {
            // Convert markers to actual HTML
            const items = match.replace(/🔹UNORDERED_LI🔹/g, '<li>').replace(/🔹\/UNORDERED_LI🔹/g, '</li>');
            return '<ul>' + items + '</ul>';
        });

        // Clean up any remaining line breaks after lists
        html = html.replace(/<\/(ul|ol)>\s*\n+/g, '</$1>');

        // 8. Replace multiple consecutive line breaks with single line break
        // This prevents double spacing (e.g., \n\n becomes single <br>)
        html = html.replace(/\n{2,}/g, '\n');

        // 9. Line breaks (звичайні)
        html = html.replace(/\n/g, '<br>');

        // 10. Відновлюємо code blocks
        html = html.replace(/🔸CODEBLOCK◆(\d+)◆/g, (match, index) => {
            return codeBlocks[parseInt(index)];
        });

        // 11. Відновлюємо inline code
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

    function getContextScopeKey(context) {
        const metadata = context?.metadata || {};
        let path = '';
        try {
            path = new URL(metadata.url || context?.page_url || location.href).pathname || '';
        } catch (_) {
            path = location.pathname || '';
        }

        let match;
        if ((match = path.match(/^\/messages\/(\d+)/))) return `messages:${match[1]}`;
        if ((match = path.match(/^\/your\/shops\/me\/listing-editor\/edit\/(\d+)/))) return `listing-editor:${match[1]}`;
        if ((match = path.match(/^\/listing\/(\d+)/))) return `public-listing:${match[1]}`;
        if (/^\/messages/.test(path)) return 'messages-inbox';
        if (/^\/your\/shops\/me\//.test(path)) return `shop-dashboard:${path.split('/').slice(0, 5).join('/')}`;
        return `other:${path || '/'}`;
    }

    function classifyAiError(errorText = '') {
        const text = String(errorText || 'Unknown error');
        const lower = text.toLowerCase();

        if (lower.includes('timed out') || lower.includes('timeout')) {
            return {
                type: 'timeout',
                title: 'AI took too long to answer.',
                action: 'Try Retry. If it repeats, send a shorter message or wait a minute.'
            };
        }
        if (text.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
            return {
                type: 'rate_limit',
                title: 'Gemini rate limit or quota was hit.',
                action: 'Wait 1-2 minutes, then retry. If this happens often, check API quota.'
            };
        }
        if (text.includes('401') || text.includes('403') || lower.includes('api key') || lower.includes('permission')) {
            return {
                type: 'auth',
                title: 'API key or model access problem.',
                action: 'Open Settings and verify the Gemini API key has access to this model.'
            };
        }
        if (text.includes('400') || lower.includes('too large') || lower.includes('token') || lower.includes('invalid argument')) {
            return {
                type: 'bad_request',
                title: 'The AI request was rejected.',
                action: 'Try a shorter request or refresh the Etsy page so context is rebuilt.'
            };
        }
        if (lower.includes('empty response') || lower.includes('no text')) {
            return {
                type: 'empty_response',
                title: 'Gemini returned no text.',
                action: 'Retry. If it repeats, try a different wording.'
            };
        }
        if (lower.includes('extension context invalidated') || lower.includes('extension error')) {
            return {
                type: 'extension_context',
                title: 'Extension context was reloaded.',
                action: 'Reload this Etsy page and try again.'
            };
        }

        return {
            type: 'unknown',
            title: 'AI request failed.',
            action: 'Retry once. If it repeats, send the latest diagnostics to support.'
        };
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async function detectOverpromiseRisk(text, pageScope = '') {
        if (!text || !String(pageScope).startsWith('messages')) return null;

        const fallbackPhrases = [
            'Yes, we can do that',
            'No problem',
            'Absolutely',
            'for sure',
            'definitely',
            'guarantee',
            'we can make anything',
            'exactly as you want',
            "I'll get started right away",
            'we will fix everything',
            'we can recreate it exactly',
            'turn out perfectly'
        ];

        const phrases = window.AgentPolicyManager
            ? await window.AgentPolicyManager.getForbiddenPhrases()
            : fallbackPhrases;

        const matches = [];
        for (const phrase of (phrases.length ? phrases : fallbackPhrases)) {
            const pattern = new RegExp(escapeRegExp(phrase), 'i');
            const match = text.match(pattern);
            if (match) matches.push(match[0]);
        }

        return matches.length ? { matches: [...new Set(matches)].slice(0, 6) } : null;
    }

    // Add error message with retry button
    function addErrorMessage(errorText, retryContext) {
        const classified = classifyAiError(errorText);
        const div = document.createElement('div');
        div.className = 'etsy-ai-msg system error';

        const errorContent = document.createElement('div');
        errorContent.className = 'error-content';
        errorContent.innerText = `${classified.title}\n${classified.action}\n\nTechnical: ${errorText}`;

        div.appendChild(errorContent);

        // Create footer container for timestamp and retry button
        const footer = document.createElement('div');
        footer.className = 'error-footer';

        const time = document.createElement('span');
        time.className = 'etsy-ai-timestamp';
        time.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        footer.appendChild(time);

        if (retryContext) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn';
            retryBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
            `;
            retryBtn.setAttribute('data-ai-tooltip', 'Retry request');
            retryBtn.onclick = (e) => handleRetry(retryContext, e);
            footer.appendChild(retryBtn);
        }

        div.appendChild(footer);

        ELEMENTS.chatBox.appendChild(div);
        ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
    }

    // Handle retry button click
    async function handleRetry(retryContext, event) {
        if (!retryContext || isProcessing) return;

        // Find the actual button element (user might click SVG inside)
        const button = event?.target?.closest('.retry-btn');

        // Disable button IMMEDIATELY to prevent double-clicks
        if (button) {
            button.disabled = true;
            button.style.opacity = '0.5';
            button.style.pointerEvents = 'none';
            button.style.cursor = 'not-allowed';
        }

        // Set processing state IMMEDIATELY to prevent race conditions
        isProcessing = true;
        ELEMENTS.sendBtn.disabled = true;
        ELEMENTS.sendBtn.style.opacity = '0.5';
        ELEMENTS.sendBtn.style.cursor = 'not-allowed';
        ELEMENTS.generateBtn.disabled = true;
        ELEMENTS.generateBtn.style.opacity = '0.5';

        // Don't re-show user message - it's already in the chat from original attempt
        // Just show loading and retry the API call
        showLoadingDots();

        try {
            // Re-initialize AI service in case it was the issue
            aiService = await window.AIServiceFactory.getCurrentService(retryContext.provider);

            if (!aiService) {
                throw new Error('Failed to initialize AI service');
            }

            // Rebuild conversation history with fresh context
            const conversationHistory = await aiService.buildConversationHistory('global_chat', retryContext.text);
            const { systemInstruction } = await aiService.constructPromptData(CURRENT_CONTEXT, retryContext.text);

            // Update lastUserMessage with minimal context for potential next retry
            lastUserMessage = {
                text: retryContext.text,
                provider: retryContext.provider,
                modelId: retryContext.modelId,
                apiKey: retryContext.apiKey
            };

            await streamAIResponse(retryContext.modelId, retryContext.apiKey, conversationHistory, systemInstruction);

        } catch (e) {
            removeLoadingMessage();
            // Use retryContext (not lastUserMessage) to maintain original retry context
            addErrorMessage(e.message, retryContext);
        } finally {
            isProcessing = false;
            ELEMENTS.sendBtn.disabled = false;
            ELEMENTS.sendBtn.style.opacity = '1';
            ELEMENTS.sendBtn.style.cursor = 'pointer';
            ELEMENTS.generateBtn.disabled = false;
            ELEMENTS.generateBtn.style.opacity = '1';
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

    function showAiStatus(message) {
        const loader = document.getElementById('loading-msg');
        if (!loader) return;
        loader.innerHTML = `<span class="etsy-ai-loading-dots"><span></span><span></span><span></span></span><span class="etsy-ai-status-text">${escapeHtml(message)}</span>`;
        ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
    }

    function showRetryCountdown(status) {
        console.debug('Gemini retry/fallback status', status);
    }

    function sanitizeAIResponse(text) {
        if (!text) return '';
        return String(text)
            .replace(/^\s*\[PAGE_SCOPE:[^\]]+\]\s*$/gmi, '')
            .replace(/\s*\[PAGE_SCOPE:[^\]]+\]\s*$/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
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

    async function resetActiveChatForNewPage(pageTitle) {
        await safeStorageSet({
            current_chat_messages: [],
            current_chat_metadata: {}
        });
        currentChatTitle = null;
        loadedSessionId = null;
        currentSessionId = null;
        ELEMENTS.chatBox.innerHTML = '';
        addSystemDivider(`New context: ${pageTitle || 'Etsy Page'}`);
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
    async function streamAIResponse(modelId, apiKey, conversationHistory, systemInstruction, promptMetadata = {}) {
        let aiMsgDiv = null;
        const startedAt = Date.now();
        let finalText = '';
        const diagnosticBase = {
            provider: aiService?.getProviderName?.() || 'unknown',
            modelId,
            pageScope: systemInstruction.match(/\[PAGE_SCOPE:([^\]]+)\]/)?.[1]?.trim() || null,
            policyVersion: promptMetadata.policyVersion || null,
            customInstructionsActive: !!promptMetadata.customInstructionsActive,
            shopIntelVersion: promptMetadata.shopIntelVersion || null,
            shopIntelAge: promptMetadata.shopIntelAge || null,
            shopIntelSources: promptMetadata.shopIntelSources || [],
            shopIntelActive: !!promptMetadata.shopIntelActive,
            shopIntelReason: promptMetadata.shopIntelReason || null,
            imageIntelCount: promptMetadata.imageIntelCount || 0,
            imageIntelAnalyzedThisRequest: promptMetadata.imageIntelAnalyzedThisRequest || 0,
            imageIntelErrors: promptMetadata.imageIntelErrors || [],
            historyMessages: conversationHistory.length,
            promptChars: systemInstruction.length + conversationHistory.reduce((sum, msg) => sum + (msg.content?.length || 0), 0)
        };

        try {
            // Create AI message div for streaming
            aiMsgDiv = document.createElement('div');
            aiMsgDiv.className = 'etsy-ai-msg ai';
            aiMsgDiv.id = 'streaming-msg';
            aiMsgDiv.style.display = 'none'; // Спочатку приховано
            ELEMENTS.chatBox.appendChild(aiMsgDiv);
            ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;

            // Callbacks для обробки streaming
            let firstChunk = true;
            const onChunk = (chunkText, fullText) => {
                finalText = sanitizeAIResponse(fullText);
                if (firstChunk) {
                    // Прибираємо loading (той, що був створений в handleChatInteraction), показуємо реальний div
                    removeLoadingMessage();

                    aiMsgDiv.style.display = 'block';
                    firstChunk = false;
                }
                aiMsgDiv.innerHTML = parseMarkdown(finalText);
                attachCopyButtonListeners(aiMsgDiv);
                ELEMENTS.chatBox.scrollTop = ELEMENTS.chatBox.scrollHeight;
            };

            const onComplete = async (fullText) => {
                finalText = sanitizeAIResponse(fullText);
                aiMsgDiv.innerHTML = parseMarkdown(finalText);
                attachCopyButtonListeners(aiMsgDiv);
                // Finalize message
                aiMsgDiv.id = ''; // Remove streaming ID
                const timestamp = document.createElement('span');
                timestamp.className = 'etsy-ai-timestamp';
                timestamp.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                aiMsgDiv.appendChild(timestamp);

                const overpromiseRisk = await detectOverpromiseRisk(finalText, diagnosticBase.pageScope || '');
                if (overpromiseRisk) {
                    addMessage(`Warning: this draft may overpromise (${overpromiseRisk.matches.join(', ')}). Review before sending or ask me to make it more cautious.`, 'system');
                }

                // Save to global chat storage
                await saveChatToStorage(finalText, "ai");

                // Generate title after first exchange (user message + AI response)
                // Cache title using first words from AI response (no API call)
                if (!currentChatTitle) {
                    const result = await safeStorageGet(['current_chat_messages']);
                    if (result) {
                        const messages = result.current_chat_messages || [];
                        // Check if this is first exchange (2 messages: 1 user + 1 AI)
                        const userMessages = messages.filter(m => m.type === 'user');
                        const aiMessages = messages.filter(m => m.type === 'ai');

                        if (userMessages.length === 1 && aiMessages.length === 1) {
                            // Use first words from AI response as title
                            currentChatTitle = createFallbackTitle(aiMessages[0].text);
                        }
                    }
                }
            };

            const onError = (error) => {
                aiMsgDiv.remove();
                throw error;
            };

            const onStatus = (status) => {
                showRetryCountdown(status);
            };

            // Викликаємо AI Service
            await aiService.streamMessage({
                modelId,
                apiKey,
                messages: conversationHistory,
                systemInstruction,
                onChunk,
                onComplete,
                onError,
                onStatus
            });

            await appendAiDiagnostic({
                ...diagnosticBase,
                durationMs: Date.now() - startedAt,
                ok: true,
                responseChars: finalText.length,
                overpromiseRisk: await detectOverpromiseRisk(finalText, diagnosticBase.pageScope || ''),
                attempts: aiService?.lastRequestDiagnostics?.attempts || null
            });
        } catch (error) {
            await appendAiDiagnostic({
                ...diagnosticBase,
                durationMs: Date.now() - startedAt,
                ok: false,
                responseChars: finalText.length,
                errorType: classifyAiError(error?.message).type,
                error: error?.message || String(error),
                attempts: aiService?.lastRequestDiagnostics?.attempts || null
            });

            // Ensure cleanup on ANY error
            removeLoadingMessage();

            // Clean up streaming message div if it exists
            if (aiMsgDiv && aiMsgDiv.parentNode) {
                aiMsgDiv.remove();
            }

            // Re-throw to be caught by handleChatInteraction
            throw error;
        }
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

    // Create fallback title from AI response
    function createFallbackTitle(aiResponseText) {
        if (!aiResponseText) return 'New chat';

        // Remove markdown formatting and extra whitespace
        let cleanText = aiResponseText
            .replace(/```[\s\S]*?```/g, '') // Remove code blocks
            .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
            .replace(/\*(.+?)\*/g, '$1')     // Remove italic
            .replace(/`(.+?)`/g, '$1')       // Remove inline code
            .replace(/[#\-\*]/g, '')         // Remove markdown symbols
            .replace(/\s+/g, ' ')            // Normalize whitespace
            .trim();

        // Take first 6-7 words or max 50 characters
        const words = cleanText.split(' ');
        let title = words.slice(0, 7).join(' ');

        if (title.length > 50) {
            title = title.substring(0, 50);
        }

        // Add ellipsis if truncated
        if (words.length > 7 || cleanText.length > title.length) {
            title += '...';
        }

        return title || 'New chat';
    }

    // Save global chat to history index
    async function saveGlobalChatToHistory(messages, metadata) {
        try {
            // Don't save if this is a loaded session (it's already in history)
            if (loadedSessionId) {
                console.log('📝 Updating existing session in history:', loadedSessionId);
                // Update the existing session instead of creating a new one
                const indexKey = 'sessions_index_all';
                const indexResult = await safeStorageGet([indexKey]);
                if (!indexResult) return;

                const sessionsIndex = indexResult[indexKey] || [];
                const existingSessionIndex = sessionsIndex.findIndex(s => s.id === loadedSessionId);

                if (existingSessionIndex !== -1) {
                    // Update existing session
                    sessionsIndex[existingSessionIndex].messages = messages;
                    sessionsIndex[existingSessionIndex].updated_at = metadata.updated_at || new Date().toISOString();
                    sessionsIndex[existingSessionIndex].messageCount = messages.length;

                    await safeStorageSet({ [indexKey]: sessionsIndex });
                    console.log('✅ Session updated in history');
                }
                return; // Don't create a new session
            }

            const indexKey = 'sessions_index_all';
            const indexResult = await safeStorageGet([indexKey]);
            if (!indexResult) return;

            const sessionsIndex = indexResult[indexKey] || [];

            // Generate session ID
            const sessionId = `session_${Date.now()}_${simpleHash(JSON.stringify(messages.slice(0, 2)))}`;

            // CHECK FOR DUPLICATES: Look for sessions with similar content
            const messagesHash = simpleHash(JSON.stringify(messages));
            const isDuplicate = sessionsIndex.some(session => {
                const existingHash = simpleHash(JSON.stringify(session.messages));
                return existingHash === messagesHash;
            });

            if (isDuplicate) {
                console.log('⚠️ Duplicate chat detected, skipping save to history');
                return; // Don't save duplicate
            }

            // Generate title if not already available
            let sessionTitle = currentChatTitle;

            // CRITICAL: For loaded sessions, use the original title from metadata
            if (metadata.session_title) {
                sessionTitle = metadata.session_title;
                console.log('📝 Using original session title:', sessionTitle);
            } else if (!sessionTitle) {
                // Check if we have first user-AI exchange to generate title
                const userMessages = messages.filter(m => m.type === 'user');
                const aiMessages = messages.filter(m => m.type === 'ai');

                if (userMessages.length > 0 && aiMessages.length > 0) {
                    // Use first words from AI response as title (no API call)
                    sessionTitle = createFallbackTitle(aiMessages[0].text);
                    // Only cache if this is the first time we're generating a title for this chat
                    // (currentChatTitle should be null for new chats)
                    if (!currentChatTitle) {
                        currentChatTitle = sessionTitle;
                    }
                    console.log('📝 Chat title from response:', sessionTitle);
                } else {
                    // No messages to generate title from, use first words or generic fallback
                    sessionTitle = aiMessages.length > 0 ? createFallbackTitle(aiMessages[0].text) : 'New chat';
                }
            }

            const sessionData = {
                id: sessionId,
                title: sessionTitle,
                created_at: metadata.created_at || new Date().toISOString(),
                updated_at: metadata.updated_at || new Date().toISOString(),
                messageCount: messages.length,
                messages: messages
            };

            sessionsIndex.push(sessionData);

            // ===== CLEANUP OLD CHATS =====
            const MAX_SAVED_CHATS = 30;
            if (sessionsIndex.length > MAX_SAVED_CHATS) {
                // Sort by updated_at to keep most recent
                sessionsIndex.sort((a, b) => {
                    const dateA = new Date(a.updated_at || a.created_at);
                    const dateB = new Date(b.updated_at || b.created_at);
                    return dateB - dateA; // Newest first
                });

                // Remove excess chats
                const removed = sessionsIndex.splice(MAX_SAVED_CHATS);
                console.log(`🧹 Cleaned up ${removed.length} old chat(s), kept ${MAX_SAVED_CHATS}`);
            }

            // Save index
            await safeStorageSet({ [indexKey]: sessionsIndex });

            console.log('✅ Session saved to history:', sessionTitle);
        } catch (e) {
            console.error('Failed to save to history:', e);
        }
    }

    // Save current global chat session to history
    async function saveCurrentSession() {
        try {
            // Get current global chat messages
            const result = await safeStorageGet(['current_chat_messages', 'current_chat_metadata']);
            if (!result) return;

            const messages = result.current_chat_messages || [];
            const metadata = result.current_chat_metadata || {};

            // Only save if there are actual messages
            const realMessages = messages.filter(m => m.type === 'user' || m.type === 'ai');
            if (realMessages.length === 0) return;

            await saveGlobalChatToHistory(messages, metadata);
        } catch (e) {
            console.error('Failed to save current session:', e);
        }
    }

    // Helper function to get date group for a chat
    function getDateGroup(timestamp) {
        const now = new Date();
        const chatDate = new Date(timestamp);

        // Reset time to midnight for accurate day comparison
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const chatDayStart = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate());

        const daysDiff = Math.floor((todayStart - chatDayStart) / (1000 * 60 * 60 * 24));

        if (daysDiff === 0) return 'today';
        if (daysDiff === 1) return 'yesterday';
        if (daysDiff <= 7) return 'week';
        if (daysDiff <= 30) return 'month';
        return 'older';
    }

    // Group chats by date periods
    function groupChatsByDate(chats) {
        const groups = {
            today: [],
            yesterday: [],
            week: [],
            month: [],
            older: []
        };

        chats.forEach(chat => {
            const group = getDateGroup(chat.updated_at || chat.timestamp);
            groups[group].push(chat);
        });

        return groups;
    }

    // Get Ukrainian label for group
    function getGroupLabel(groupKey) {
        const labels = {
            today: 'Today',
            yesterday: 'Yesterday',
            week: 'Previous 7 days',
            month: 'Previous 30 days',
            older: 'Older'
        };
        return labels[groupKey] || groupKey;
    }

    // Open history modal
    async function openHistory() {
        const indexKey = 'sessions_index_all';
        const indexResult = await safeStorageGet([indexKey]);
        if (!indexResult) return; // Extension context invalidated
        const sessionsIndex = indexResult[indexKey] || [];

        // Clear and populate history list
        ELEMENTS.historyList.innerHTML = '';

        if (sessionsIndex.length === 0) {
            ELEMENTS.historyList.innerHTML = '<div class="history-empty">No chat history yet.<br>Start a conversation to create history.</div>';
        } else {
            // Sort by updated_at (newest first)
            sessionsIndex.sort((a, b) => new Date(b.updated_at || b.timestamp) - new Date(a.updated_at || a.timestamp));

            // Group chats by date
            const groupedChats = groupChatsByDate(sessionsIndex);

            // Render each group
            const groupOrder = ['today', 'yesterday', 'week', 'month', 'older'];
            groupOrder.forEach(groupKey => {
                const chatsInGroup = groupedChats[groupKey];
                if (chatsInGroup.length === 0) return; // Skip empty groups

                // Add group header
                const groupHeader = document.createElement('div');
                groupHeader.className = 'history-group-header';
                groupHeader.textContent = getGroupLabel(groupKey);
                ELEMENTS.historyList.appendChild(groupHeader);

                // Add chats in this group
                chatsInGroup.forEach(session => {
                    const item = document.createElement('div');
                    item.className = 'history-item';

                    const titleRow = document.createElement('div');
                    titleRow.className = 'history-item-title-row';

                    const title = document.createElement('div');
                    title.className = 'history-item-title';
                    title.textContent = session.title || session.name || 'Untitled Chat';

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
                    const date = new Date(session.updated_at || session.timestamp);
                    meta.innerHTML = `
                    <span>${date.toLocaleDateString('uk-UA')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
    async function loadChatSession(session) {
        // Save current session before loading another
        const currentMessages = await safeStorageGet(['current_chat_messages']);
        if (currentMessages && currentMessages.current_chat_messages?.length > 0) {
            await saveCurrentSession();
        }

        // Clear current chat UI
        ELEMENTS.chatBox.innerHTML = '';

        // Track that this is a loaded session (not a new one)
        loadedSessionId = session.id;
        currentChatTitle = session.title || session.name;
        currentChatId = session.id;

        // Load session messages into global storage
        await safeStorageSet({
            current_chat_messages: session.messages || [],
            current_chat_metadata: {
                created_at: session.created_at || session.timestamp,
                updated_at: session.updated_at || session.timestamp,
                loaded_session_id: session.id,  // CRITICAL: Mark this as loaded from history
                session_title: session.title || session.name  // Store original title
            }
        });

        // Render messages
        addSystemDivider(`Loaded: ${session.title || session.name}`);
        session.messages.forEach(msg => {
            renderMessage(msg.text, msg.type, msg.timestamp);
        });

        addSystemDivider('Continue the conversation');
        console.log('📂 Loaded session:', session.title || session.name);
    }

    // Start new chat (clear current, save to history)
    async function startNewChat() {
        // Check if there are any messages to save
        const result = await safeStorageGet(['current_chat_messages', 'current_chat_metadata']);
        if (!result) return; // Extension context invalidated

        const currentMessages = result.current_chat_messages || [];
        const metadata = result.current_chat_metadata || {};

        // Only save if there are actual user/AI messages (not just system messages)
        const realMessages = currentMessages.filter(m => m.type === 'user' || m.type === 'ai');
        if (realMessages.length > 0) {
            await saveCurrentSession();
        }

        // Clear global chat storage
        await safeStorageSet({
            current_chat_messages: [],
            current_chat_metadata: {}
        });

        // Reset chat title and loaded session ID
        currentChatTitle = null;
        loadedSessionId = null;

        // Clear UI
        ELEMENTS.chatBox.innerHTML = '';

        console.log('🆕 New chat started');
    }

    // Update the existing updateContext function to handle session management
    const originalUpdateContext = updateContext;
    updateContext = async function (data) {
        if (!data) return;

        const prevScopeKey = getContextScopeKey(CURRENT_CONTEXT);
        const nextScopeKey = getContextScopeKey(data);

        // If switching to a different Etsy object/page mode, save current session first.
        if (CURRENT_CONTEXT && prevScopeKey !== nextScopeKey) {
            await saveCurrentSession();
            const nextTitle = data.page_content?.title || data.metadata?.title || 'Etsy Page';
            await resetActiveChatForNewPage(nextTitle);
        }

        // Call original function
        await originalUpdateContext.call(this, data);
    };
}

// ============================================
// Extension Context Invalidation Handler
// ============================================

/**
 * Shows a banner inside the chat window when extension is reloaded/updated
 * Instructs user to reload the page to restore functionality
 */
function showExtensionReloadedBanner() {
    // Check if banner already exists
    if (document.getElementById('etsy-ai-reload-banner')) return;

    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return; // Chat container doesn't exist yet

    // Clear chat box and show reload banner
    chatBox.innerHTML = '';

    const banner = document.createElement('div');
    banner.id = 'etsy-ai-reload-banner';
    banner.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 30px;
        text-align: center;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    banner.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px 40px;
            border-radius: 16px;
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
            max-width: 100%;
        ">
            <div style="font-size: 48px; margin-bottom: 15px;">🔄</div>
            <h2 style="
                color: white;
                font-size: 22px;
                font-weight: 700;
                margin: 0 0 12px 0;
            ">Extension Updated</h2>
            <p style="
                color: rgba(255,255,255,0.95);
                font-size: 14px;
                line-height: 1.5;
                margin: 0 0 20px 0;
            ">
                The extension has been updated.<br>
                Please reload this page to continue.
            </p>
            <button onclick="location.reload()" style="
                background: white;
                color: #667eea;
                border: none;
                padding: 12px 30px;
                font-size: 15px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                font-family: 'Inter', sans-serif;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'">
                🔄 Reload Page
            </button>
        </div>
    `;

    chatBox.appendChild(banner);

    // Disable input and buttons
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const generateBtn = document.getElementById('generate-btn');
    const modelSelect = document.getElementById('model-select');
    const historyBtn = document.getElementById('history-btn');
    const newChatBtn = document.getElementById('new-chat-btn');

    if (userInput) {
        userInput.contentEditable = 'false';
        userInput.style.opacity = '0.5';
    }
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.3';
    }
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.3';
    }
    if (modelSelect) {
        modelSelect.disabled = true;
        modelSelect.style.opacity = '0.5';
    }
    if (historyBtn) {
        historyBtn.disabled = true;
        historyBtn.style.opacity = '0.3';
    }
    if (newChatBtn) {
        newChatBtn.disabled = true;
        newChatBtn.style.opacity = '0.3';
    }
}

// ============================================
// Обробник повідомлень для автооновлення
// ============================================

try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CHECK_CHAT_WINDOW') {
            // Перевіряємо чи вікно чату відкрите
            const chatContainer = document.getElementById('etsy-ai-chat-container');
            const isOpen = chatContainer && chatContainer.classList.contains('visible');

            sendResponse({ isOpen: isOpen });
            return true; // Keep message channel open for async response
        }
    });
} catch (e) {
    // Extension context may be invalid
    console.error('⚠️ Failed to register message listener - extension context may be invalid', e);
}
