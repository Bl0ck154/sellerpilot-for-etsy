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
        max-width: min(260px, calc(100vw - 16px));
        white-space: normal;
        overflow-wrap: anywhere;
        text-align: center;
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

        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltipDiv.getBoundingClientRect();

        let top = rect.bottom + 8;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        if (top + tooltipRect.height > window.innerHeight - 8) {
            top = rect.top - tooltipRect.height - 8;
        }

        if (top < 8) top = 8;
        if (left < 8) left = 8;
        if (left + tooltipRect.width > window.innerWidth - 8) {
            left = window.innerWidth - tooltipRect.width - 8;
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
    let activeAbortController = null;
    let activeAiScopeKey = null;
    let contextTransitionId = 0;
    let viewingLegacySession = false;
    let pendingMemorySuggestion = null;
    let isAnalyzingMemoryIntent = false;
    let isAnalyzingQuickReplyIntent = false;
    const MEMORY_ANALYSIS_TIMEOUT_MS = 3000;
    const MEMORY_ANALYSIS_SYSTEM_PROMPT = `You classify whether the Owner is asking to use persistent assistant memory.
Return ONLY compact JSON with this shape:
{"action":"none|add|remove|clear|offer","text":"","keyword":"","confidence":0}

Meanings:
- add: the Owner clearly asks to save/remember a durable fact, shop policy, writing preference, workflow preference, or voice rule.
- remove: the Owner clearly asks to forget/remove a memory.
- clear: the Owner clearly asks to clear all memory.
- offer: the Owner mentions a durable preference/policy that would be useful later, but does not clearly ask to save it. Ask for confirmation instead of saving automatically.
- none: normal drafting/chat request, temporary instruction, one-off customer detail, or ambiguous.

Rules:
- Do not save one-off customer/order details as memory.
- Do not save sensitive private data.
- Prefer none when unsure.
- For add/offer, put the memory-ready fact in text, written as a stable preference/policy.
- For remove, put the smallest useful search phrase in keyword.`;
    const MEMORY_DECISION_SYSTEM_PROMPT = `You classify the Owner's reply to a pending memory confirmation.
Return ONLY compact JSON with this shape:
{"decision":"accept|reject|unclear","confidence":0}

The Owner was asked whether to save, replace, remove, or clear persistent memory.
Classify the Owner's latest message by meaning, not by exact words.
- accept: they agree, approve, confirm, or ask to proceed.
- reject: they decline, cancel, say not to do it, or ask to keep memory unchanged.
- unclear: anything else, including a new unrelated request or a question.
Prefer unclear when unsure.`;
    const QUICK_REPLY_ANALYSIS_SYSTEM_PROMPT = `You classify whether the Owner is asking to manage reusable Etsy quick replies.
Return ONLY compact JSON with this shape:
{"action":"none|list|add|update|remove","target":"","label":"","text":"","confidence":0}

Meanings:
- list: show the saved quick replies.
- add: create a new quick reply. Put its short human-readable name in label and complete customer-facing reply in text.
- update: edit or rename an existing quick reply. Put its current name/search phrase in target, its new name in label only if requested, and its complete new reply in text only if requested.
- remove: delete one quick reply. Put its name/search phrase in target.
- none: normal customer-reply drafting, translation, rewriting, chat, or anything not explicitly about managing saved quick replies.

Rules:
- A request to draft, suggest, write, improve, or translate a reply is NOT quick-reply management unless the Owner explicitly says to save/add/update/remove a reusable quick reply or template.
- Never infer missing reply text for add/update.
- Preserve the requested customer-facing language and wording.
- Prefer none when unsure.`;
    const DEFAULT_SUGGEST_RESPONSE_PROMPT = "Draft a customer reply based on the current Etsy conversation and page context. Write in the customer's language. Preserve my intended meaning and point of view: if I write as one person, draft as one person; if I write as a team/shop, draft as a team/shop. Use context to understand the situation, but do not add new facts, claims, next steps, or reassurance I did not ask for. Keep broad confirmations broad; be specific only when useful for the reply I requested. Never ask for photos/details already provided. Avoid unsupported promises about exact results, timing, price, refunds, or outcomes. If I ask for a beautiful, polite, warm, or more detailed reply, make it naturally fuller instead of overly short.";
    const QUICK_ACTIONS = [
        {
            id: 'suggest-reply',
            label: 'Suggest reply',
            prompt: DEFAULT_SUGGEST_RESPONSE_PROMPT,
            systemAction: true
        },
        {
            id: 'rewrite-shorter',
            label: 'Rewrite shorter',
            prompt: 'Rewrite my current draft or latest customer reply draft to be shorter and clearer. Preserve the customer-facing language and do not add promises or new facts. Return only the rewritten draft in triple backticks.',
            systemAction: false
        },
        {
            id: 'rewrite-warmer',
            label: 'Rewrite warmer',
            prompt: 'Rewrite my current draft or latest customer reply draft to sound warmer and more human while staying concise. Preserve the customer-facing language and do not add promises or new facts. Return only the rewritten draft in triple backticks.',
            systemAction: false
        },
        {
            id: 'rewrite-firmer',
            label: 'Rewrite firmer',
            prompt: 'Rewrite my current draft or latest customer reply draft to be firmer, calm, and professional. Preserve the customer-facing language. Do not apologize excessively, admit fault, promise refunds, or add new facts. Return only the rewritten draft in triple backticks.',
            systemAction: false
        },
        {
            id: 'translate-english',
            label: 'Translate to English',
            prompt: 'Translate my current draft or latest customer reply draft into natural customer-facing English. Preserve meaning, tone, names, order details, and all constraints. Return only the translated draft in triple backticks.',
            systemAction: false
        },
        {
            id: 'summarize-thread',
            label: 'Summarize thread',
            prompt: 'Summarize the current Etsy conversation for the Owner. Include: customer wants, what has already been said or promised, open questions, recommended next action. Do not draft a customer reply unless needed.',
            systemAction: true
        },
        {
            id: 'risk-check',
            label: 'Check risks',
            prompt: 'Review the current Etsy conversation and my latest draft for seller risks. Flag refund/custom-work/overpromise/timing/policy risks. Then give a safer response strategy and, if useful, one cautious customer reply draft in the customer language.',
            systemAction: true
        }
    ];

    const ELEMENTS = {
        statusDot: document.getElementById('connection-status'),
        versionLabel: document.getElementById('extension-version'),
        pageTitle: document.getElementById('page-title'), // New element
        chatBox: document.getElementById('chat-box'),
        userInput: document.getElementById('user-input'),
        sendBtn: document.getElementById('send-btn'),
        stopBtn: document.getElementById('stop-btn'),
        generateBtn: document.getElementById('generate-btn'),
        quickActionsBtn: document.getElementById('quick-actions-btn'),
        quickActionsMenu: document.getElementById('quick-actions-menu'),
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
        await restoreState();
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
                { id: "gemini-flash-latest", name: "gemini-flash-latest", provider: "gemini" }
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
        ELEMENTS.stopBtn?.addEventListener('click', stopActiveRequest);

        setupQuickActionsMenu();

        // "Suggest Reply" shortcut (currently hidden from UI; keep handler safe)
        ELEMENTS.generateBtn?.addEventListener('click', async () => {
            if (ELEMENTS.generateBtn?.classList.contains('etsy-ai-hidden-action')) return;
            const prompt = window.AgentPolicyManager
                ? await window.AgentPolicyManager.getSuggestResponsePrompt(DEFAULT_SUGGEST_RESPONSE_PROMPT)
                : DEFAULT_SUGGEST_RESPONSE_PROMPT;
            handleChatInteraction(prompt, true);
        });

        ELEMENTS.quickActionsBtn?.addEventListener('click', toggleQuickActionsMenu);
        document.addEventListener('mousedown', (e) => {
            if (!ELEMENTS.quickActionsMenu?.classList.contains('visible')) return;
            if (e.target.closest('.etsy-ai-actions-menu-wrap')) return;
            closeQuickActionsMenu();
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

    function setupQuickActionsMenu() {
        if (!ELEMENTS.quickActionsMenu) return;

        ELEMENTS.quickActionsMenu.innerHTML = QUICK_ACTIONS.map(action => (
            `<button type="button" role="menuitem" class="etsy-ai-actions-menu-item" data-action-id="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
        )).join('');

        ELEMENTS.quickActionsMenu.addEventListener('click', async (e) => {
            const item = e.target.closest('[data-action-id]');
            if (!item) return;

            const action = QUICK_ACTIONS.find(entry => entry.id === item.dataset.actionId);
            if (!action || isProcessing) return;

            closeQuickActionsMenu();
            const prompt = action.id === 'suggest-reply' && window.AgentPolicyManager
                ? await window.AgentPolicyManager.getSuggestResponsePrompt(action.prompt)
                : action.prompt;
            handleChatInteraction(prompt, action.systemAction);
        });
    }

    function toggleQuickActionsMenu() {
        if (!ELEMENTS.quickActionsMenu || !ELEMENTS.quickActionsBtn || isProcessing) return;
        const shouldOpen = !ELEMENTS.quickActionsMenu.classList.contains('visible');
        ELEMENTS.quickActionsMenu.classList.toggle('visible', shouldOpen);
        ELEMENTS.quickActionsBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }

    function closeQuickActionsMenu() {
        ELEMENTS.quickActionsMenu?.classList.remove('visible');
        ELEMENTS.quickActionsBtn?.setAttribute('aria-expanded', 'false');
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

    // Migrate the pre-scoped active chat once so upgrades do not hide existing data.
    async function handleBrowserRestart() {
        const result = await safeStorageGet(['current_chat_messages', 'current_chat_metadata']);
        if (!result) return;

        const messages = result.current_chat_messages || [];
        const metadata = result.current_chat_metadata || {};
        const realMessages = messages.filter(m => m.type === 'user' || m.type === 'ai');
        if (realMessages.length === 0 || metadata.scope_key) return;

        const storageKeys = getActiveChatStorageKeys(getContextScopeKey({ page_url: location.href }));
        const scopedResult = await safeStorageGet([storageKeys.messagesKey]);
        if (!scopedResult || scopedResult[storageKeys.messagesKey]?.length > 0) return;

        await safeStorageSet({
            [storageKeys.messagesKey]: messages,
            [storageKeys.metadataKey]: { ...metadata, scope_key: storageKeys.scopeKey }
        });
        await syncLegacyActiveChatMirror(messages, { ...metadata, scope_key: storageKeys.scopeKey });
    }

    // Load current global chat on initialization
    async function loadCurrentChat(scopeKeyOverride = null, transitionId = contextTransitionId) {
        const { messagesKey, metadataKey, scopeKey } = getActiveChatStorageKeys(scopeKeyOverride || getActiveAiScopeKey());
        const result = await safeStorageGet([messagesKey, metadataKey]);
        if (!result) return;
        if (transitionId !== contextTransitionId || (activeAiScopeKey && activeAiScopeKey !== scopeKey)) return;

        activeAiScopeKey = scopeKey;
        const messages = (result[messagesKey] || []).filter(msg => !isTransientSystemMessage(msg));
        const metadata = result[metadataKey] || {};
        loadedSessionId = metadata.loaded_session_id || null;
        currentChatTitle = metadata.session_title || null;

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

    function getActiveAiScopeKey(context = CURRENT_CONTEXT) {
        return activeAiScopeKey || getContextScopeKey(context || { metadata: { url: location.href } });
    }

    function getActiveChatStorageKeys(scopeKey = getActiveAiScopeKey()) {
        const suffix = simpleHash(scopeKey || 'global');
        return {
            messagesKey: `current_chat_messages_${suffix}`,
            metadataKey: `current_chat_metadata_${suffix}`,
            scopeKey
        };
    }

    async function syncLegacyActiveChatMirror(messages, metadata) {
        await safeStorageSet({
            current_chat_messages: messages || [],
            current_chat_metadata: metadata || {}
        });
    }

    function getCustomerDisplayNameFromHistory(chatHistory) {
        const storedName = String(chatHistory?.customer_display_name || chatHistory?.other_user?.display_name || '').trim();
        if (storedName) return storedName;

        const messages = chatHistory?.messages || [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const roleText = `${msg.sender_type || ''} ${msg.role || ''} ${msg.author_role || ''}`.toLowerCase();
            if (/seller|shop|owner/.test(roleText)) continue;
            const name = String(msg.sender_display_name || msg.sender_name || '').trim();
            if (name) return name;
        }
        return 'customer';
    }

    function getCustomerDisplayNameFromEtsyContext(convoId = null) {
        try {
            const scripts = document.querySelectorAll('script[type="text/javascript"], script:not([src])');
            for (const script of scripts) {
                const content = script.textContent || '';
                if (!content.includes('Etsy.Context') || !content.includes('other_user')) continue;

                const match = content.match(/Etsy\.Context\s*=\s*(\{[\s\S]*?\});/);
                if (!match) continue;

                const context = JSON.parse(match[1]);
                const detail = context?.data?.initial_data?.detail;
                if (!detail) continue;
                if (convoId && detail.conversation_id && String(detail.conversation_id) !== String(convoId)) continue;

                const name = String(detail.other_user?.display_name || '').trim();
                if (name) return name;
            }
        } catch (error) {
            console.warn('⚠️ Failed to parse Etsy customer name from page context:', error);
        }

        return '';
    }

    async function getCurrentCustomerDisplayName(convoId = null) {
        try {
            const result = await safeStorageGet(['ETSY_CHAT_HISTORY']);
            const chatHistory = result?.ETSY_CHAT_HISTORY;
            if (convoId && chatHistory?.convo_id && String(chatHistory.convo_id) !== String(convoId)) {
                return getCustomerDisplayNameFromEtsyContext(convoId) || 'customer';
            }
            const storageName = getCustomerDisplayNameFromHistory(chatHistory);
            if (storageName && storageName !== 'customer') return storageName;
            return getCustomerDisplayNameFromEtsyContext(convoId) || 'customer';
        } catch (_) {
            return getCustomerDisplayNameFromEtsyContext(convoId) || 'customer';
        }
    }

    async function scopeHasRealChatMessages(scopeKey) {
        const { messagesKey } = getActiveChatStorageKeys(scopeKey);
        const result = await safeStorageGet([messagesKey]);
        if (!result) return false;

        return (result[messagesKey] || []).some(msg => msg.type === 'user' || msg.type === 'ai');
    }

    async function getMessageScopeDisplayLabel(scopeKey, context) {
        const convoId = scopeKey?.match(/^messages:(\d+)$/)?.[1] || null;
        const customerName = await getCurrentCustomerDisplayName(convoId);
        if (customerName && customerName !== 'customer') return customerName;

        return 'customer';
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
        const { messagesKey, metadataKey } = getActiveChatStorageKeys();
        const result = await safeStorageGet([messagesKey, metadataKey]);
        if (!result) return;

        const messages = result[messagesKey] || [];
        const hasRealMessages = messages.some(msg => msg.type === 'user' || msg.type === 'ai');
        if (hasRealMessages) return;

        const cleanedMessages = messages.filter(msg => !isTransientSystemMessage(msg));
        if (cleanedMessages.length !== messages.length) {
            const metadata = result[metadataKey] || {};
            await safeStorageSet({ [messagesKey]: cleanedMessages });
            await syncLegacyActiveChatMirror(cleanedMessages, metadata);
        }

        removeTransientSystemMessagesFromUi();
    }

    // Save message to global chat storage
    async function saveChatToStorage(text, type, storageKeys = getActiveChatStorageKeys()) {
        const { messagesKey, metadataKey, scopeKey } = storageKeys;

        try {
            const result = await safeStorageGet([messagesKey, metadataKey]);
            if (!result) return;

            const messages = result[messagesKey] || [];
            const metadata = result[metadataKey] || {};

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
            metadata.scope_key = scopeKey;

            await safeStorageSet({
                [messagesKey]: messages,
                [metadataKey]: metadata
            });
            if (activeAiScopeKey === scopeKey) {
                await syncLegacyActiveChatMirror(messages, metadata);
            }
        } catch (e) {
            console.error("Failed to save to global chat:", e);
        }
    }

    // Core Chat Interaction Flow
    async function handleChatInteraction(userMessageText, isSystemAction = false) {
        if (viewingLegacySession) {
            addMessage('This pre-upgrade chat is read-only because its Etsy customer is unknown. Start a new chat to continue safely.', 'system');
            return;
        }

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
                    setActionButtonsDisabled(false);
                    openSettingsForProvider(provider);
                    return;
                }
            } catch (e) {
                console.error('Failed to get API key:', e);
                ELEMENTS.sendBtn.disabled = false;
                ELEMENTS.sendBtn.style.opacity = '1';
                ELEMENTS.sendBtn.style.cursor = 'pointer';
                ELEMENTS.sendBtn.style.pointerEvents = 'auto';
                setActionButtonsDisabled(false);
                addMessage("⚠️ Extension error. Please refresh the page.", "system");
                return;
            }
        }

        if (window.EtsyAI_GetFreshContext) {
            const freshContext = window.EtsyAI_GetFreshContext();
            if (freshContext) {
                const freshScopeKey = getContextScopeKey(freshContext);
                const locationScopeKey = getContextScopeKey({ page_url: location.href });
                if (freshScopeKey === locationScopeKey) {
                    await updateContext(freshContext);
                } else {
                    console.warn('⚠️ Ignoring stale page context for previous Etsy scope');
                }
            } else {
                console.warn('⚠️ Failed to extract fresh context');
            }
        } else {
            console.error('⚠️ EtsyAI_GetFreshContext not available - content.js may not be loaded yet');
        }

        // Clear input only after validation and scope refresh pass.
        ELEMENTS.userInput.innerText = "";
        const requestStorageKeys = getActiveChatStorageKeys();
        const requestContext = CURRENT_CONTEXT;

        // Set processing state
        activeAbortController = new AbortController();
        setProcessingState(true);

        // 2. Show User Message
        await clearTransientSystemMessagesBeforeRealChat();
        if (activeAiScopeKey !== requestStorageKeys.scopeKey) {
            ELEMENTS.userInput.innerText = userMessageText;
            activeAbortController = null;
            setProcessingState(false);
            return;
        }
        renderMessage(userMessageText, "user");

        // 3. Save User Msg to global chat
        await saveChatToStorage(userMessageText, "user", requestStorageKeys);

        // Show animated loading
        const loadingMsgId = showLoadingDots();

        try {
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

            // Build conversation history for this Etsy conversation only.
            const conversationHistory = await aiService.buildConversationHistory(requestStorageKeys.messagesKey, userMessageText);
            const { systemInstruction } = await aiService.constructPromptData(requestContext, userMessageText);
            const promptMetadata = BaseAIService.INSTRUCTIONS.lastBuildMetadata || {};
            const shopIntelMetadata = window.ShopIntelligenceManager
                ? await window.ShopIntelligenceManager.getMetadata()
                : {};

            // Store minimal message context for retry functionality (history will be rebuilt on retry)
            lastUserMessage = {
                text: userMessageText,
                provider: provider,
                modelId: providerModelId,
                apiKey: providerApiKey,
                historyKey: requestStorageKeys.messagesKey,
                scopeKey: requestStorageKeys.scopeKey
            };

            if (activeAiScopeKey !== requestStorageKeys.scopeKey) {
                const cancelled = new Error('Request cancelled after Etsy conversation changed.');
                cancelled.cancelled = true;
                throw cancelled;
            }

            // Pass messages instead of contents to be provider-agnostic
            await streamAIResponse(providerModelId, providerApiKey, conversationHistory, systemInstruction, {
                ...promptMetadata,
                ...shopIntelMetadata,
                ...imageIntelMetadata
            }, activeAbortController.signal, requestStorageKeys);

        } catch (e) {
            removeLoadingMessage();
            if (e?.cancelled && activeAiScopeKey === requestStorageKeys.scopeKey) {
                addMessage('Request stopped.', 'system');
            } else if (!e?.cancelled && activeAiScopeKey === requestStorageKeys.scopeKey) {
                addErrorMessage(e.message, lastUserMessage);
            }
        } finally {
            activeAbortController = null;
            setProcessingState(false);
        }
    }

    function setProcessingState(processing) {
        isProcessing = processing;

        if (ELEMENTS.sendBtn) {
            ELEMENTS.sendBtn.style.display = processing ? 'none' : '';
            ELEMENTS.sendBtn.disabled = processing;
            ELEMENTS.sendBtn.style.opacity = processing ? '0.5' : '1';
            ELEMENTS.sendBtn.style.cursor = processing ? 'not-allowed' : 'pointer';
            ELEMENTS.sendBtn.style.pointerEvents = processing ? 'none' : 'auto';
        }

        if (ELEMENTS.stopBtn) {
            ELEMENTS.stopBtn.style.display = processing ? 'flex' : 'none';
            ELEMENTS.stopBtn.disabled = !processing;
            ELEMENTS.stopBtn.style.opacity = '1';
        }

        setActionButtonsDisabled(processing);
    }

    function stopActiveRequest() {
        if (!isProcessing || !activeAbortController) return;
        activeAbortController.abort();
        showAiStatus('Stopping...');
        if (ELEMENTS.stopBtn) {
            ELEMENTS.stopBtn.disabled = true;
            ELEMENTS.stopBtn.style.opacity = '0.5';
        }
    }

    function setActionButtonsDisabled(disabled) {
        [ELEMENTS.generateBtn, ELEMENTS.quickActionsBtn].forEach(btn => {
            if (!btn) return;
            btn.disabled = disabled;
            if (!btn.classList.contains('etsy-ai-hidden-action')) {
                btn.style.opacity = disabled ? '0.5' : '1';
                btn.style.pointerEvents = disabled ? 'none' : 'auto';
            }
        });
        if (disabled) closeQuickActionsMenu();
    }

    async function sendMessage() {
        const text = ELEMENTS.userInput.innerText.trim();
        if (!text) return;

        if (viewingLegacySession) {
            addMessage('This pre-upgrade chat is read-only because its Etsy customer is unknown. Start a new chat to continue safely.', 'system');
            return;
        }

        // Don't send if already processing
        if (isProcessing || isAnalyzingMemoryIntent || isAnalyzingQuickReplyIntent) {
            return; // Keep text in input, don't clear
        }

        let quickReplyIntent = null;
        isAnalyzingQuickReplyIntent = true;
        try {
            quickReplyIntent = await analyzeQuickReplyIntentIfUseful(text);
        } finally {
            isAnalyzingQuickReplyIntent = false;
        }
        if (quickReplyIntent?.action && quickReplyIntent.action !== 'none') {
            const handled = await handleQuickReplyIntent(text, quickReplyIntent);
            if (handled) {
                ELEMENTS.userInput.innerText = "";
                return;
            }
        }

        if (pendingMemorySuggestion) {
            let pendingMemoryDecision = null;
            isAnalyzingMemoryIntent = true;
            try {
                pendingMemoryDecision = await analyzePendingMemoryDecision(text);
            } finally {
                isAnalyzingMemoryIntent = false;
            }
            if (pendingMemoryDecision?.decision === 'accept' || pendingMemoryDecision?.decision === 'reject') {
                ELEMENTS.userInput.innerText = "";
                handlePendingMemoryDecision(text, { accept: pendingMemoryDecision.decision === 'accept' }).catch(err => {
                    console.error('Memory decision error:', err);
                    renderMessage(`❌ Memory error: ${err.message || err}`, "system compact");
                });
                return;
            }
        }

        let memoryIntent = null;
        isAnalyzingMemoryIntent = true;
        try {
            memoryIntent = await analyzeMemoryIntentIfUseful(text);
        } finally {
            isAnalyzingMemoryIntent = false;
        }
        if (memoryIntent?.action && memoryIntent.action !== 'none') {
            const handled = await handleMemoryIntent(text, memoryIntent);
            if (handled) {
                ELEMENTS.userInput.innerText = "";
                return;
            }
        }

        handleChatInteraction(text);
    }

    function shouldAnalyzeQuickReplyIntent(text) {
        if (!window.QuickReplyManager || !text) return false;
        return /\bquick\s*repl(?:y|ies)\b|\bcanned\s*(?:reply|response)\b|\breply\s*template\b|\btemplate\s*(?:reply|response)\b|швидк[\p{L}\p{N}_]*\s+відповід[\p{L}\p{N}_]*|шаблон[\p{L}\p{N}_]*\s+(?:відповід[\p{L}\p{N}_]*|повідомлен[\p{L}\p{N}_]*)|быстр[\p{L}\p{N}_]*\s+ответ[\p{L}\p{N}_]*|шаблон[\p{L}\p{N}_]*\s+(?:ответ[\p{L}\p{N}_]*|сообщен[\p{L}\p{N}_]*)/iu.test(text);
    }

    async function analyzeQuickReplyIntentIfUseful(text) {
        if (!shouldAnalyzeQuickReplyIntent(text)) return null;

        try {
            const selectedOption = ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex];
            const provider = selectedOption ? selectedOption.dataset.provider : 'gemini';
            let providerApiKey = null;
            if (!PROVIDERS_WITH_BUILTIN_KEY.has(provider)) {
                providerApiKey = await window.AIServiceFactory.getApiKey(provider);
                if (!providerApiKey) return null;
            }

            const service = await window.AIServiceFactory.getCurrentService(provider);
            const providerModelId = await window.AIServiceFactory.getModelId(provider);
            let raw = '';
            const controller = new AbortController();
            let timeoutId = null;
            const classificationPromise = service.streamMessage({
                modelId: providerModelId,
                apiKey: providerApiKey,
                systemInstruction: QUICK_REPLY_ANALYSIS_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: text }],
                onChunk: (_chunk, fullText) => { raw = fullText || raw; },
                onComplete: (fullText) => { raw = fullText || raw; },
                onError: () => { },
                abortSignal: controller.signal
            });

            try {
                await Promise.race([
                    classificationPromise,
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            controller.abort();
                            reject(new Error('quick reply analysis timeout'));
                        }, MEMORY_ANALYSIS_TIMEOUT_MS);
                    })
                ]);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }

            return parseQuickReplyIntentJson(raw);
        } catch (error) {
            console.debug('Quick reply intent analysis skipped:', error?.message || error);
            return null;
        }
    }

    function parseQuickReplyIntentJson(raw) {
        if (!raw) return null;
        const text = String(raw).replace(/```json|```/gi, '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            const action = String(parsed.action || 'none').toLowerCase();
            const confidence = Number(parsed.confidence) || 0;
            if (!['none', 'list', 'add', 'update', 'remove'].includes(action)) return null;
            return {
                action: confidence >= 0.6 ? action : 'none',
                target: String(parsed.target || '').trim().slice(0, 120),
                label: String(parsed.label || '').trim().slice(0, 48),
                text: String(parsed.text || '').trim().slice(0, 1500),
                confidence
            };
        } catch (_) {
            return null;
        }
    }

    function formatQuickReplyEntries(entries) {
        return (entries || []).map(entry => `• ${entry.label}: ${entry.text}`).join('\n');
    }

    async function handleQuickReplyIntent(originalText, intent) {
        if (!window.QuickReplyManager || !intent || intent.action === 'none') return false;

        if (intent.action === 'add' && (!intent.label || !intent.text)) return false;
        if (intent.action === 'update' && (!intent.target || (!intent.label && !intent.text))) return false;
        if (intent.action === 'remove' && !intent.target) return false;

        await clearTransientSystemMessagesBeforeRealChat();
        addMessage(originalText, "user");

        let reply = '';
        try {
            if (intent.action === 'list') {
                const entries = await window.QuickReplyManager.list();
                reply = entries.length
                    ? `⚡ Saved quick replies:\n${formatQuickReplyEntries(entries)}`
                    : '⚡ No quick replies saved yet.';
            } else if (intent.action === 'add') {
                const result = await window.QuickReplyManager.add(intent.label, intent.text);
                if (result?.duplicate) {
                    reply = `ℹ️ A quick reply named "${result.entry.label}" already exists. Ask me to update it instead.`;
                } else if (result?.limitReached) {
                    reply = `⚠️ The ${result.maxEntries}-reply limit is reached. Remove an old quick reply first.`;
                } else if (result?.entry) {
                    reply = `⚡ Quick reply added: "${result.entry.label}"\n${result.entry.text}`;
                } else {
                    reply = '⚠️ I could not add that quick reply.';
                }
            } else if (intent.action === 'update') {
                const changes = {};
                if (intent.label) changes.label = intent.label;
                if (intent.text) changes.text = intent.text;
                const result = await window.QuickReplyManager.updateByQuery(intent.target, changes);
                if (result.ambiguous) {
                    reply = `I found several possible quick replies:\n${formatQuickReplyEntries(result.matches)}\n\nPlease use the exact label.`;
                } else if (result.result?.duplicate) {
                    reply = `⚠️ A quick reply named "${result.result.entry.label}" already exists.`;
                } else if (result.updated) {
                    reply = `✏️ Quick reply updated: "${result.result.entry.label}"\n${result.result.entry.text}`;
                } else {
                    reply = `🤔 I could not find a quick reply matching "${intent.target}".`;
                }
            } else if (intent.action === 'remove') {
                const result = await window.QuickReplyManager.removeByQuery(intent.target);
                if (result.ambiguous) {
                    reply = `I found several possible quick replies:\n${formatQuickReplyEntries(result.matches)}\n\nPlease use the exact label.`;
                } else if (result.removed) {
                    reply = `🗑️ Quick reply removed: "${result.removed.label}"`;
                } else {
                    reply = `🤔 I could not find a quick reply matching "${intent.target}".`;
                }
            }
        } catch (error) {
            reply = `❌ Quick reply error: ${error.message || error}`;
        }

        renderMessage(reply, "system compact");
        return true;
    }

    function shouldAnalyzeMemoryIntent(text) {
        if (!window.MemoryManager || !text) return false;
        const normalized = String(text).toLowerCase();
        if (normalized.length < 8) return false;
        return true;
    }

    async function analyzeMemoryIntentIfUseful(text) {
        if (!shouldAnalyzeMemoryIntent(text)) return null;

        try {
            const selectedOption = ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex];
            const provider = selectedOption ? selectedOption.dataset.provider : 'gemini';
            let providerApiKey = null;
            if (!PROVIDERS_WITH_BUILTIN_KEY.has(provider)) {
                providerApiKey = await window.AIServiceFactory.getApiKey(provider);
                if (!providerApiKey) return null;
            }

            const service = await window.AIServiceFactory.getCurrentService(provider);
            const providerModelId = await window.AIServiceFactory.getModelId(provider);
            let raw = '';
            const controller = new AbortController();
            let timeoutId = null;
            const classificationPromise = service.streamMessage({
                modelId: providerModelId,
                apiKey: providerApiKey,
                systemInstruction: MEMORY_ANALYSIS_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: text }],
                onChunk: (_chunk, fullText) => { raw = fullText || raw; },
                onComplete: (fullText) => { raw = fullText || raw; },
                onError: () => { },
                abortSignal: controller.signal
            });

            try {
                await Promise.race([
                    classificationPromise,
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            controller.abort();
                            reject(new Error('memory analysis timeout'));
                        }, MEMORY_ANALYSIS_TIMEOUT_MS);
                    })
                ]);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }

            return parseMemoryIntentJson(raw);
        } catch (error) {
            console.debug('Memory intent analysis skipped:', error?.message || error);
            return null;
        }
    }

    async function analyzePendingMemoryDecision(text) {
        if (!pendingMemorySuggestion || !text || !window.MemoryManager) return null;

        try {
            const selectedOption = ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex];
            const provider = selectedOption ? selectedOption.dataset.provider : 'gemini';
            let providerApiKey = null;
            if (!PROVIDERS_WITH_BUILTIN_KEY.has(provider)) {
                providerApiKey = await window.AIServiceFactory.getApiKey(provider);
                if (!providerApiKey) return null;
            }

            const service = await window.AIServiceFactory.getCurrentService(provider);
            const providerModelId = await window.AIServiceFactory.getModelId(provider);
            let raw = '';
            const controller = new AbortController();
            let timeoutId = null;
            const pendingSummary = JSON.stringify({
                pending: pendingMemorySuggestion,
                ownerReply: text
            });

            const classificationPromise = service.streamMessage({
                modelId: providerModelId,
                apiKey: providerApiKey,
                systemInstruction: MEMORY_DECISION_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: pendingSummary }],
                onChunk: (_chunk, fullText) => { raw = fullText || raw; },
                onComplete: (fullText) => { raw = fullText || raw; },
                onError: () => { },
                abortSignal: controller.signal
            });

            try {
                await Promise.race([
                    classificationPromise,
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            controller.abort();
                            reject(new Error('memory decision timeout'));
                        }, MEMORY_ANALYSIS_TIMEOUT_MS);
                    })
                ]);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }

            return parseMemoryDecisionJson(raw);
        } catch (error) {
            console.debug('Memory decision analysis skipped:', error?.message || error);
            return null;
        }
    }

    function parseMemoryIntentJson(raw) {
        if (!raw) return null;
        const text = String(raw).replace(/```json|```/gi, '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            const action = String(parsed.action || 'none').toLowerCase();
            if (!['none', 'add', 'remove', 'clear', 'offer'].includes(action)) return null;
            return {
                action,
                text: String(parsed.text || '').trim().slice(0, 500),
                keyword: String(parsed.keyword || '').trim().slice(0, 120),
                confidence: Number(parsed.confidence) || 0
            };
        } catch (_) {
            return null;
        }
    }

    function parseMemoryDecisionJson(raw) {
        if (!raw) return null;
        const text = String(raw).replace(/```json|```/gi, '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            const decision = String(parsed.decision || 'unclear').toLowerCase();
            if (!['accept', 'reject', 'unclear'].includes(decision)) return null;
            return {
                decision: (Number(parsed.confidence) || 0) >= 0.55 ? decision : 'unclear',
                confidence: Number(parsed.confidence) || 0
            };
        } catch (_) {
            return null;
        }
    }

    async function handleMemoryIntent(originalText, intent) {
        if (!window.MemoryManager || !intent || intent.action === 'none') return false;

        if (intent.action === 'offer') {
            if (!intent.text || intent.confidence < 0.55) return false;
            pendingMemorySuggestion = { text: intent.text, source: 'offer' };
            addMessage(`Remember this for future replies? "${intent.text}"\nReply with your choice.`, "system compact");
            return false;
        }

        await clearTransientSystemMessagesBeforeRealChat();
        addMessage(originalText, "user");

        let reply = '';
        try {
            if (intent.action === 'add') {
                const res = await window.MemoryManager.addSmart(intent.text);
                if (!res) reply = "⚠️ Could not save an empty memory.";
                else if (res.duplicate) reply = `ℹ️ Already remembered: "${res.entry.text}"`;
                else if (res.conflict) {
                    pendingMemorySuggestion = { text: res.text, conflicts: res.conflicts, source: 'explicit_add' };
                    reply = `This may conflict with existing memory:\n${formatMemoryEntries(res.conflicts)}\n\nSave it and replace the older conflicting memory? Reply with your choice.`;
                }
                else if (res.replaced?.length) reply = `💾 Remembered and replaced older memory: "${res.entry.text}"`;
                else reply = `💾 Remembered: "${res.entry.text}"`;
            } else if (intent.action === 'remove') {
                const res = await window.MemoryManager.removeByKeyword(intent.keyword || intent.text);
                if (res.removed === 0) {
                    if (res.ambiguous) {
                        pendingMemorySuggestion = { removeKeyword: intent.keyword || intent.text, matches: res.entries, source: 'remove_ambiguous' };
                        reply = `I found several matching memory entries:\n${formatMemoryEntries(res.entries)}\n\nRemove all of them? Reply with your choice.`;
                    } else {
                        reply = `🤔 I could not find a matching memory.`;
                    }
                } else {
                    const preview = res.entries.map(e => `• ${e.text}`).join('\n');
                    reply = `🗑️ Removed (${res.removed}):\n${preview}`;
                }
            } else if (intent.action === 'clear') {
                pendingMemorySuggestion = { source: 'clear_all' };
                reply = 'Clear all memory? Reply with your choice.';
            }
        } catch (e) {
            reply = `❌ Memory error: ${e.message || e}`;
        }

        addMessage(reply, "system compact");
        return true;
    }

    function formatMemoryEntries(entries = []) {
        return entries.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');
    }

    async function handlePendingMemoryDecision(originalText, decision) {
        const pending = pendingMemorySuggestion;
        pendingMemorySuggestion = null;

        await clearTransientSystemMessagesBeforeRealChat();

        let reply = '';
        if (!decision.accept) {
            reply = 'Memory unchanged.';
        } else if (pending?.source === 'remove_ambiguous') {
            const res = await window.MemoryManager.removeByKeyword(pending.removeKeyword, { allowMultiple: true });
            reply = res.removed ? `🗑️ Removed (${res.removed}) memory entries.` : 'Memory unchanged.';
        } else if (pending?.source === 'clear_all') {
            await window.MemoryManager.clear();
            reply = '🗑️ All memory cleared.';
        } else if (pending?.text) {
            const res = await window.MemoryManager.addSmart(pending.text, { replaceConflicts: true });
            if (res?.entry) {
                reply = res.replaced?.length
                    ? `💾 Remembered and replaced ${res.replaced.length} older conflicting memory entry.`
                    : `💾 Remembered: "${res.entry.text}"`;
            } else {
                reply = 'Memory unchanged.';
            }
        }

        addMessage(reply, "system compact");
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
            codeBlocks.push(`<pre class="code-block-wrapper"><code>${escapedCode}</code><button class="copy-code-btn" type="button" title="Copy">📋</button></pre>`);
            return `🔸CODEBLOCK◆${index}◆`;
        });

        // 2. Зберігаємо inline code з кнопкою копіювання
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const index = inlineCodes.length;
            const escapedCode = escapeHtml(code);
            inlineCodes.push(`<code class="inline-code-wrapper"><span class="inline-code-text">${escapedCode}</span><button class="copy-inline-btn" type="button" title="Copy">📋</button></code>`);
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

        // Lists should not inherit line-break spacing between items.
        html = html
            .replace(/<\/(li)>\s*<br\s*\/?>\s*<(li)>/gi, '</$1><$2>')
            .replace(/<(ul|ol)>\s*<br\s*\/?>/gi, '<$1>')
            .replace(/<br\s*\/?>\s*<\/(ul|ol)>/gi, '</$1>');

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
                const code = btn.closest('.code-block-wrapper')?.querySelector('code')?.textContent || '';
                await copyToClipboard(code, btn);
            };
        });

        // Handle copy buttons for inline code
        container.querySelectorAll('.copy-inline-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const code = btn.closest('.inline-code-wrapper')?.querySelector('.inline-code-text')?.textContent || '';
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
                title: 'Gemini did not respond in time.',
                action: 'Retry the request. The extension will automatically try the available fallback models.'
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
            'guarantee',
            'we can make anything',
            'exactly as you want',
            'we will fix everything',
            'we can recreate it exactly',
            'turn out perfectly',
            'unlimited revisions',
            'I promise'
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
        if (retryContext.scopeKey && retryContext.scopeKey !== activeAiScopeKey) return;

        // Find the actual button element (user might click SVG inside)
        const button = event?.target?.closest('.retry-btn');
        const previousError = button?.closest('.etsy-ai-msg.system.error');

        // Disable button IMMEDIATELY to prevent double-clicks
        if (button) {
            button.disabled = true;
            button.style.opacity = '0.5';
            button.style.pointerEvents = 'none';
            button.style.cursor = 'not-allowed';
        }

        // Set processing state IMMEDIATELY to prevent race conditions
        activeAbortController = new AbortController();
        setProcessingState(true);

        // The retry replaces this error state; do not leave stale errors in chat.
        if (previousError) previousError.remove();

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
            const historyKey = retryContext.historyKey || getActiveChatStorageKeys().messagesKey;
            const conversationHistory = await aiService.buildConversationHistory(historyKey, retryContext.text);
            const { systemInstruction } = await aiService.constructPromptData(CURRENT_CONTEXT, retryContext.text);

            // Update lastUserMessage with minimal context for potential next retry
            lastUserMessage = {
                text: retryContext.text,
                provider: retryContext.provider,
                modelId: retryContext.modelId,
                apiKey: retryContext.apiKey,
                historyKey,
                scopeKey: retryContext.scopeKey || activeAiScopeKey
            };

            const retryStorageKeys = getActiveChatStorageKeys(retryContext.scopeKey || activeAiScopeKey);
            await streamAIResponse(retryContext.modelId, retryContext.apiKey, conversationHistory, systemInstruction, {}, activeAbortController.signal, retryStorageKeys);

        } catch (e) {
            removeLoadingMessage();
            if (e?.cancelled && (!retryContext.scopeKey || retryContext.scopeKey === activeAiScopeKey)) {
                addMessage('Request stopped.', 'system');
            } else if (!e?.cancelled && (!retryContext.scopeKey || retryContext.scopeKey === activeAiScopeKey)) {
                // Use retryContext (not lastUserMessage) to maintain original retry context
                addErrorMessage(e.message, retryContext);
            }
        } finally {
            activeAbortController = null;
            setProcessingState(false);
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
        if (status?.message) showAiStatus(status.message);
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
        const span = document.createElement('span');
        span.textContent = text;
        div.appendChild(span);
        ELEMENTS.chatBox.appendChild(div);
    }

    async function switchActiveAiScope(scopeKey, label, transitionId = contextTransitionId) {
        if (transitionId !== contextTransitionId) return;
        if (!scopeKey || activeAiScopeKey === scopeKey) return;

        if (isProcessing && activeAbortController) {
            activeAbortController.abort();
        }
        activeAiScopeKey = scopeKey;
        viewingLegacySession = false;
        currentChatTitle = null;
        loadedSessionId = null;
        currentSessionId = null;
        ELEMENTS.chatBox.innerHTML = '';

        const customerName = label || await getCurrentCustomerDisplayName();
        const hasExistingChat = await scopeHasRealChatMessages(scopeKey);
        if (transitionId !== contextTransitionId || activeAiScopeKey !== scopeKey) return;
        addSystemDivider(`${hasExistingChat ? 'Continuing chat with' : 'Chat with'} ${customerName}`);
        await loadCurrentChat(scopeKey, transitionId);
    }

    async function resetActiveChatForNewPage(pageTitle) {
        const { messagesKey, metadataKey } = getActiveChatStorageKeys();
        await safeStorageSet({ [messagesKey]: [], [metadataKey]: {} });
        await syncLegacyActiveChatMirror([], {});
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
    async function streamAIResponse(modelId, apiKey, conversationHistory, systemInstruction, promptMetadata = {}, abortSignal = null, storageKeys = getActiveChatStorageKeys()) {
        let aiMsgDiv = null;
        const startedAt = Date.now();
        let finalText = '';
        const isRequestScopeActive = () => activeAiScopeKey === storageKeys.scopeKey;
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
                if (!isRequestScopeActive()) return;
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
                if (!isRequestScopeActive()) return;
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
                if (!isRequestScopeActive()) return;
                if (overpromiseRisk) {
                    addMessage(`Warning: this draft may overpromise (${overpromiseRisk.matches.join(', ')}). Review before sending or ask me to make it more cautious.`, 'system');
                }

                // Save to global chat storage
                await saveChatToStorage(finalText, "ai", storageKeys);
                if (!isRequestScopeActive()) return;

                // Generate title after first exchange (user message + AI response)
                // Cache title using first words from AI response (no API call)
                if (!currentChatTitle) {
                    const { messagesKey } = storageKeys;
                    const result = await safeStorageGet([messagesKey]);
                    if (result) {
                        const messages = result[messagesKey] || [];
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
                if (isRequestScopeActive()) showRetryCountdown(status);
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
                onStatus,
                abortSignal
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
                    sessionsIndex[existingSessionIndex].scope_key = metadata.scope_key || activeAiScopeKey;

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
                scope_key: metadata.scope_key || activeAiScopeKey,
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
            const { messagesKey, metadataKey } = getActiveChatStorageKeys();
            const result = await safeStorageGet([messagesKey, metadataKey]);
            if (!result) return;

            const messages = result[messagesKey] || [];
            const metadata = result[metadataKey] || {};

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
        const sessionsIndex = (indexResult[indexKey] || []).filter(session => !session.scope_key || session.scope_key === activeAiScopeKey);

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
        const expectedScopeKey = activeAiScopeKey;
        if (!session?.scope_key) {
            viewingLegacySession = true;
            ELEMENTS.chatBox.innerHTML = '';
            addSystemDivider('Legacy chat (read-only)');
            (session.messages || []).forEach(msg => renderMessage(msg.text, msg.type, msg.timestamp));
            addSystemDivider('Start a new chat to continue in the current Etsy conversation');
            return;
        }
        if (session.scope_key !== expectedScopeKey) return;
        viewingLegacySession = false;

        // Save current session before loading another
        const { messagesKey, metadataKey } = getActiveChatStorageKeys();
        const currentMessages = await safeStorageGet([messagesKey]);
        if (activeAiScopeKey !== expectedScopeKey) return;
        if (currentMessages && currentMessages[messagesKey]?.length > 0) {
            await saveCurrentSession();
            if (activeAiScopeKey !== expectedScopeKey) return;
        }

        // Clear current chat UI
        ELEMENTS.chatBox.innerHTML = '';

        // Track that this is a loaded session (not a new one)
        loadedSessionId = session.id;
        currentChatTitle = session.title || session.name;
        currentChatId = session.id;

        const metadata = {
            created_at: session.created_at || session.timestamp,
            updated_at: session.updated_at || session.timestamp,
            loaded_session_id: session.id,
            session_title: session.title || session.name,
            scope_key: session.scope_key
        };

        await safeStorageSet({ [messagesKey]: session.messages || [], [metadataKey]: metadata });
        if (activeAiScopeKey !== expectedScopeKey) return;
        await syncLegacyActiveChatMirror(session.messages || [], metadata);
        if (activeAiScopeKey !== expectedScopeKey) return;

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
        const { messagesKey, metadataKey } = getActiveChatStorageKeys();
        const result = await safeStorageGet([messagesKey, metadataKey]);
        if (!result) return; // Extension context invalidated

        const currentMessages = result[messagesKey] || [];

        // Only save if there are actual user/AI messages (not just system messages)
        const realMessages = currentMessages.filter(m => m.type === 'user' || m.type === 'ai');
        if (realMessages.length > 0) {
            await saveCurrentSession();
        }

        await safeStorageSet({ [messagesKey]: [], [metadataKey]: {} });
        await syncLegacyActiveChatMirror([], {});

        // Reset chat title and loaded session ID
        currentChatTitle = null;
        loadedSessionId = null;
        viewingLegacySession = false;

        // Clear UI
        ELEMENTS.chatBox.innerHTML = '';

        console.log('🆕 New chat started');
    }

    // Update the existing updateContext function to handle session management
    const originalUpdateContext = updateContext;
    updateContext = async function (data) {
        if (!data) return;

        const transitionId = ++contextTransitionId;
        const prevScopeKey = activeAiScopeKey || getContextScopeKey(CURRENT_CONTEXT);
        const nextScopeKey = getContextScopeKey(data);
        const nextMessagesMatch = nextScopeKey.match(/^messages:(\d+)$/);

        // If switching to a different Etsy object/page mode, keep AI history scoped
        // to that Etsy conversation/page instead of mixing it into one global prompt.
        if (CURRENT_CONTEXT && prevScopeKey !== nextScopeKey) {
            const nextTitle = nextMessagesMatch
                ? await getMessageScopeDisplayLabel(nextScopeKey, data)
                : (data.page_content?.title || data.metadata?.title || 'Etsy Page');
            if (transitionId !== contextTransitionId) return;
            await switchActiveAiScope(nextScopeKey, nextTitle, transitionId);
        }

        if (transitionId !== contextTransitionId) return;
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
