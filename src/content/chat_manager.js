// chat_manager.js - Etsy Chat Manager Module
// Adapted from Tampermonkey UserScript v45.0
// Provides resizable panels and enhanced UX for Etsy Messages

(function () {
    'use strict';

    const KEY_L = 'etsy_clean_left';
    const KEY_R = 'etsy_clean_right';
    const KEY_H = 'etsy_clean_input_height';
    const SENT_TEXT_GUARD_MS = 5 * 60 * 1000;

    let styleElement = null;
    let isInitialized = false;
    let rafId = null;
    let observer = null;
    let urlCheckInterval = null;
    let lastUrl = location.href;
    let lastParsedHash = "";

    // Attachments viewer state
    let lastAttachmentsConvoId = null;
    let lastAttachmentsHash = null;

    // Event listener references for cleanup
    let storageChangeListener = null;
    let popstateListener = null;
    let hashchangeListener = null;
    const pendingSendTextByConversation = new Map();

    // Module API
    window.EtsyChatManager = {
        init: function () {
            if (isInitialized) {
                console.log('🎨 Chat Manager: Already initialized');
                return;
            }

            injectStyles();
            startMonitoring();

            // Initialize image modal if available
            if (window.EtsyImageModal) {
                window.EtsyImageModal.init();
            }

            isInitialized = true;
        },

        cleanup: function () {
            if (!isInitialized) {
                console.log('🎨 Chat Manager: Not initialized, nothing to cleanup');
                return;
            }

            // Remove styles
            if (styleElement && styleElement.parentNode) {
                styleElement.parentNode.removeChild(styleElement);
                styleElement = null;
            }

            // Stop monitoring
            if (observer) {
                observer.disconnect();
                observer = null;
            }

            if (urlCheckInterval) {
                clearInterval(urlCheckInterval);
                urlCheckInterval = null;
            }

            // Remove storage change listener
            if (storageChangeListener) {
                chrome.storage.onChanged.removeListener(storageChangeListener);
                storageChangeListener = null;
            }

            // Remove navigation event listeners
            if (popstateListener) {
                window.removeEventListener('popstate', popstateListener);
                popstateListener = null;
            }
            if (hashchangeListener) {
                window.removeEventListener('hashchange', hashchangeListener);
                hashchangeListener = null;
            }

            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }

            // Clean up DOM modifications
            forceCleanupChatMode();

            // Clean up image modal
            if (window.EtsyImageModal) {
                window.EtsyImageModal.cleanup();
            }

            // Reset state
            lastParsedHash = "";
            lastAttachmentsConvoId = null;
            lastAttachmentsHash = null;
            isInitialized = false;
        },

        isActive: function () {
            return isInitialized;
        }
    };

    // Inject CSS styles
    function injectStyles() {
        if (styleElement) return;

        styleElement = document.createElement('style');
        styleElement.setAttribute('data-chat-manager', 'true');
        styleElement.innerHTML = `
        /* ГЛОБАЛЬНІ ЗМІННІ */
        :root {
            --wl: 300px;
            --wr: 350px;
            --h-input: 150px;
        }

        /* --- 1. РЕЖИМ ЧАТУ (ecm-active) --- */

        html.ecm-active, body.ecm-active {
            height: 100vh !important;
            width: 100% !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
        }

        body.ecm-active footer,
        body.ecm-active .wt-footer-theme-black,
        body.ecm-active #gnav-footer { display: none !important; }

        /* Контейнер чату */
        body.ecm-active .wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            align-items: stretch !important;
            justify-content: flex-start !important;
            height: calc(100vh - 64px) !important;
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            margin: 0 !important;
            position: relative !important;
            background: #fff !important;
            top: 0 !important;
        }

        body.ecm-active .wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full::before,
        body.ecm-active .wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full::after {
            display: none !important; content: none !important;
        }

        /* ЛІВА (Чат) */
        html.ecm-active body.ecm-active .my-col-left {
            flex: 0 0 var(--wl) !important;
            width: var(--wl) !important;
            min-width: 50px !important;
            max-width: 60% !important;
            margin: 0 !important; padding: 0 !important;
            border-right: 1px solid #ddd;
            background: #fff !important;
            overflow-y: auto !important;
            z-index: 20;
        }

        /* ЦЕНТР (Чат) */
        html.ecm-active body.ecm-active .my-col-center {
            flex: 1 1 auto !important;
            width: 0 !important;
            min-width: 0 !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            z-index: 10;
            background: #fff !important;
        }

        body.ecm-active .my-col-center > * {
            width: 100% !important; max-width: none !important;
            flex-basis: auto !important; margin: 0 !important;
            box-sizing: border-box !important;
        }

        /* ПРАВА (Чат) */
        html.ecm-active body.ecm-active .my-col-right {
            flex: 0 0 var(--wr) !important;
            width: var(--wr) !important;
            min-width: 50px !important;
            max-width: 60% !important;
            margin: 0 !important;
            padding: 0 !important;
            border-left: 1px solid #ddd;
            background: #fff !important;
            overflow-y: auto !important;
            z-index: 20;
        }

        /* Елементи чату */
        body.ecm-active .wt-display-flex-xs.wt-align-items-center.wt-pt-xs-1.wt-pt-md-2.wt-pl-xs-3.wt-pb-xs-1 {
            padding-top: 0 !important; padding-bottom: 0 !important;
            min-height: 0 !important; height: auto !important;
            margin-top: 0 !important; margin-bottom: 0 !important;
            line-height: 1 !important;
            flex: 0 0 auto !important;
        }

        body.ecm-active .msg-list-container {
            flex: 1 1 auto !important;
            height: 0 !important;
            min-height: 0 !important;
            margin-bottom: 0 !important;
            padding-bottom: 0 !important;
            position: relative !important;
            overflow: hidden !important;
        }

        body.ecm-active .msg-list-container > div,
        body.ecm-active .scrolling-message-list {
            height: 100% !important;
            min-height: 100% !important;
            max-height: 100% !important;
        }

        body.ecm-active .inline-compose-container {
            flex: 0 0 auto !important;
            height: auto !important;
            min-height: 60px !important;
            max-height: 50vh !important;
            overflow: visible !important;
            position: relative !important;
            z-index: 50 !important;
            background: #fff !important;
            border-top: 1px solid #ddd;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
        }

        /* Textarea auto-expand */
        body.ecm-active .inline-compose-container textarea.wt-textarea {
            min-height: 60px !important;
            max-height: 50vh !important;
            overflow-y: auto !important;
            resize: none !important;
        }

        /* --- 2. РЕЖИМ СПИСКУ (ecm-list-mode) --- */

        html.ecm-list-mode, body.ecm-list-mode {
            height: auto !important;
            width: 100% !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            position: static !important;
        }

        /* Контейнер у списку - використовуємо flex для правильної адаптації */
        body.ecm-list-mode .wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full {
            position: relative !important;
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            margin-top: 0 !important;
            top: 0 !important;
            width: 100% !important;
        }

        /* ЛІВА КОЛОНКА В СПИСКУ */
        body.ecm-list-mode .my-col-left {
            width: var(--wl) !important;
            min-width: var(--wl) !important;
            max-width: var(--wl) !important;
            flex: 0 0 var(--wl) !important;
            box-sizing: border-box !important;
        }

        /* СПИСОК ЧАТІВ (права колонка) - має пріоритет і займає весь залишковий простір */
        body.ecm-list-mode .convo-inbox-main-container {
            flex: 1 1 auto !important;
            width: 0 !important;
            min-width: 0 !important;
            max-width: none !important;
            box-sizing: border-box !important;
        }

        /* --- РЕСАЙЗЕРИ --- */
        .my-resizer {
            display: none;
            position: absolute; top: 0; bottom: 0; width: 20px;
            background: transparent; cursor: col-resize; z-index: 9999;
            user-select: none; align-items: center; justify-content: center;
        }
        .my-resizer::before {
            content: ''; position: absolute; height: 100%; width: 4px;
            background: transparent; border-left: 1px solid rgba(0,0,0,0.1); transition: 0.1s;
        }
        .my-resizer:hover::before, .my-resizer.active::before { background: #F1641E; width: 4px; opacity: 1; }

        /* Лівий - ЗАВЖДИ */
        body.ecm-active #resizer-left, body.ecm-list-mode #resizer-left {
            display: flex !important;
            left: var(--wl); transform: translateX(-50%);
        }

        /* Правий - ТІЛЬКИ ЧАТ */
        body.ecm-active #resizer-right {
            display: flex !important;
            right: var(--wr) !important;
            transform: translateX(50%) !important;
        }

        /* Горизонтальний ресайзер прибрано - поле вводу розширюється автоматично */

        body.is-resizing { cursor: col-resize !important; user-select: none !important; }
        body.is-resizing-h { cursor: row-resize !important; user-select: none !important; }
        body.is-resizing *, body.is-resizing-h * { user-select: none !important; pointer-events: none !important; }

        textarea.wt-textarea { resize: none !important; }
        .convos-send-add-attachment-container + div { display: none !important; }

        /* Збільшена кнопка відправки */
        body.ecm-active button[data-clg-id="WtButton"][aria-label*="Send"] {
            min-width: 120px !important;
            padding-left: 32px !important;
            padding-right: 32px !important;
        }

        /* Широкі кнопки для primary та filled */
        body.ecm-active .wt-btn.wt-btn--primary,
        body.ecm-active .wt-btn.wt-btn--filled {
            min-width: 140px !important;
            width: auto !important;
            padding-left: 24px !important;
            padding-right: 24px !important;
        }
    `;
        document.head.appendChild(styleElement);
        restoreVars();
    }

    function restoreVars() {
        let root = document.documentElement;
        let wl = parseFloat(localStorage.getItem(KEY_L)) || 300;
        let wr = parseFloat(localStorage.getItem(KEY_R)) || 350;
        let hin = parseFloat(localStorage.getItem(KEY_H)) || 150;

        root.style.setProperty('--wl', wl + 'px');
        root.style.setProperty('--wr', wr + 'px');
        root.style.setProperty('--h-input', hin + 'px');
    }

    function normalizeDraftText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function getConversationId() {
        const m = location.href.match(/\/messages\/(\d+)/);
        return m ? m[1] : null;
    }

    function getDraftStorageKeys(id) {
        return {
            draftKey: 'draft_' + id,
            draftUpdatedAtKey: 'draft_updated_at_' + id,
            sentKey: 'sent_' + id,
            sentTextKey: 'sent_text_' + id,
            sentTextGuardKey: 'sent_text_guard_until_' + id,
            confirmedSentTextKey: 'confirmed_sent_text_' + id,
            confirmedSentAtKey: 'confirmed_sent_at_' + id
        };
    }

    function readStorageTimestamp(key) {
        const value = parseInt(localStorage.getItem(key) || '0', 10);
        return Number.isFinite(value) ? value : 0;
    }

    function getMessageText(msg) {
        return String(msg?.message_body || msg?.message || msg?.body || msg?.text || '').trim();
    }

    function getMessageTimestampMs(msg) {
        const raw = msg?.create_date || msg?.timestamp || msg?.created_at || msg?.sent_at;
        if (!raw) return 0;

        if (typeof raw === 'number') {
            return raw > 1e12 ? raw : raw * 1000;
        }

        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function isSellerAuthoredMessage(msg) {
        if (!msg) return false;

        const roleText = `${msg.sender_type || ''} ${msg.role || ''} ${msg.author_role || ''}`.toLowerCase();
        if (/seller|shop|owner/.test(roleText)) return true;
        if (/buyer|customer/.test(roleText)) return false;

        if (msg.is_seller === true || msg.is_shop_member === true || msg.from_owner === true) return true;
        if (msg.is_customer === true) return false;

        return false;
    }

    function getLatestSellerMessage(chatHistory) {
        const messages = chatHistory?.messages || [];
        let latestMessage = null;
        let latestTimestamp = 0;

        for (const msg of messages) {
            if (!isSellerAuthoredMessage(msg)) continue;
            const ts = getMessageTimestampMs(msg);
            if (!latestMessage || ts >= latestTimestamp) {
                latestMessage = msg;
                latestTimestamp = ts;
            }
        }

        return latestMessage;
    }

    function shouldClearConfirmedSentDraft(draftUpdatedAt, confirmedSentAt) {
        if (!confirmedSentAt) return false;
        if (!draftUpdatedAt) return true;
        return draftUpdatedAt <= (confirmedSentAt + SENT_TEXT_GUARD_MS);
    }

    function removeStoredDraft(id) {
        const { draftKey, draftUpdatedAtKey } = getDraftStorageKeys(id);
        localStorage.removeItem(draftKey);
        localStorage.removeItem(draftUpdatedAtKey);
    }

    function clearSentTextGuard(id) {
        const { sentTextKey, sentTextGuardKey } = getDraftStorageKeys(id);
        localStorage.removeItem(sentTextKey);
        localStorage.removeItem(sentTextGuardKey);
    }

    function clearConfirmedSentText(id) {
        const { confirmedSentTextKey, confirmedSentAtKey } = getDraftStorageKeys(id);
        localStorage.removeItem(confirmedSentTextKey);
        localStorage.removeItem(confirmedSentAtKey);
    }

    function isGuardedSentText(id, normalizedText) {
        if (!normalizedText) return false;

        const { sentTextKey, sentTextGuardKey } = getDraftStorageKeys(id);
        const guardUntil = readStorageTimestamp(sentTextGuardKey);
        if (!guardUntil) return false;

        if (Date.now() >= guardUntil) {
            clearSentTextGuard(id);
            return false;
        }

        return normalizedText === (localStorage.getItem(sentTextKey) || '');
    }

    function isRecentlyConfirmedSentText(id, normalizedText) {
        if (!normalizedText) return false;

        const { confirmedSentTextKey, confirmedSentAtKey } = getDraftStorageKeys(id);
        const confirmedText = localStorage.getItem(confirmedSentTextKey) || '';
        const confirmedAt = readStorageTimestamp(confirmedSentAtKey);
        if (!confirmedText || !confirmedAt) return false;

        return normalizedText === confirmedText;
    }

    function suppressResurrectedSentText(textarea, id) {
        if (!textarea || !id) return false;
        const normalized = normalizeDraftText(textarea.value);
        if (!normalized || (!isGuardedSentText(id, normalized) && !isRecentlyConfirmedSentText(id, normalized))) {
            return false;
        }

        textarea.value = '';
        removeStoredDraft(id);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function markDraftSent(id, text) {
        if (!id) return;

        const normalized = normalizeDraftText(text);
        const { sentKey, sentTextKey, sentTextGuardKey, confirmedSentTextKey, confirmedSentAtKey } = getDraftStorageKeys(id);
        const now = Date.now();

        removeStoredDraft(id);
        localStorage.setItem(sentKey, now.toString());

        if (normalized) {
            localStorage.setItem(sentTextKey, normalized);
            localStorage.setItem(sentTextGuardKey, (now + SENT_TEXT_GUARD_MS).toString());
            localStorage.setItem(confirmedSentTextKey, normalized);
            localStorage.setItem(confirmedSentAtKey, now.toString());
        } else {
            clearSentTextGuard(id);
        }

        pendingSendTextByConversation.delete(id);
    }

    function isDraftRestoreBlockedAfterSend(id, normalizedDraft, draftUpdatedAt) {
        const { sentKey, sentTextKey, confirmedSentTextKey } = getDraftStorageKeys(id);
        const sentAt = readStorageTimestamp(sentKey);

        const sentText = localStorage.getItem(sentTextKey) || '';
        const confirmedSentText = localStorage.getItem(confirmedSentTextKey) || '';
        if (normalizedDraft && (normalizedDraft === sentText || normalizedDraft === confirmedSentText)) return true;

        if (!sentAt) return false;

        if (!draftUpdatedAt || draftUpdatedAt <= sentAt) return true;
        return false;
    }

    function getActiveTextarea() {
        return document.querySelector('textarea.wt-textarea');
    }

    function getTextareaConversationId(textarea) {
        const currentId = getConversationId();
        if (currentId && textarea === getActiveTextarea()) return currentId;
        return textarea.dataset.draftConvoId || currentId;
    }

    function rememberPendingSendText(textarea) {
        const id = getTextareaConversationId(textarea);
        if (!id || !textarea) return;

        const text = textarea.value;
        if (normalizeDraftText(text)) {
            pendingSendTextByConversation.set(id, {
                text,
                capturedAt: Date.now()
            });
        } else {
            pendingSendTextByConversation.delete(id);
        }
    }

    function clearDraftAndMarkSent(textarea) {
        const id = getTextareaConversationId(textarea);
        if (!id || !textarea) return;

        const pending = pendingSendTextByConversation.get(id);
        const pendingText = pending && Date.now() - pending.capturedAt < 10000 ? pending.text : '';
        const text = textarea.value || pendingText;
        if (normalizeDraftText(text)) {
            markDraftSent(id, text);
        } else {
            removeStoredDraft(id);
        }
    }

    function handleDraftInput(e) {
        const id = getTextareaConversationId(e.target);
        if (!id) return;

        e.target.dataset.draftConvoId = id;

        const text = e.target.value;
        const normalized = normalizeDraftText(text);
        if (!normalized) {
            removeStoredDraft(id);
            return;
        }

        if (isGuardedSentText(id, normalized) || isRecentlyConfirmedSentText(id, normalized)) {
            removeStoredDraft(id);
            if (e.target.value) {
                e.target.value = '';
            }
            return;
        }

        const { draftKey, draftUpdatedAtKey } = getDraftStorageKeys(id);
        localStorage.setItem(draftKey, text);
        localStorage.setItem(draftUpdatedAtKey, Date.now().toString());
    }

    function restoreStoredDraft(area, id) {
        const { draftKey, draftUpdatedAtKey, sentKey, sentTextKey, confirmedSentTextKey, confirmedSentAtKey } = getDraftStorageKeys(id);
        const savedDraft = localStorage.getItem(draftKey);
        if (!savedDraft) return;

        const normalizedDraft = normalizeDraftText(savedDraft);
        const draftUpdatedAt = readStorageTimestamp(draftUpdatedAtKey);
        const lastSentAt = readStorageTimestamp(sentKey);
        const lastSentText = localStorage.getItem(sentTextKey) || '';
        const confirmedSentText = localStorage.getItem(confirmedSentTextKey) || '';
        const confirmedSentAt = readStorageTimestamp(confirmedSentAtKey);
        let shouldRestore = Boolean(normalizedDraft);

        if (shouldRestore && isDraftRestoreBlockedAfterSend(id, normalizedDraft, draftUpdatedAt)) {
            shouldRestore = false;
        }

        if (shouldRestore && isGuardedSentText(id, normalizedDraft)) {
            shouldRestore = false;
        }

        if (shouldRestore && confirmedSentText && normalizedDraft === confirmedSentText && shouldClearConfirmedSentDraft(draftUpdatedAt, confirmedSentAt)) {
            shouldRestore = false;
        }

        if (shouldRestore && lastSentText && normalizedDraft === lastSentText && (!draftUpdatedAt || draftUpdatedAt <= lastSentAt)) {
            shouldRestore = false;
        }

        // Legacy drafts have no timestamp; after a send they are ambiguous, so do not resurrect them.
        if (shouldRestore && lastSentAt && !draftUpdatedAt) {
            shouldRestore = false;
        }

        if (shouldRestore && draftUpdatedAt && lastSentAt && draftUpdatedAt <= lastSentAt) {
            shouldRestore = false;
        }

        if (shouldRestore) {
            area.value = savedDraft;
            area.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            removeStoredDraft(id);
        }
    }

    function setupDraftPersistence(area, id) {
        area.dataset.draftConvoId = id;

        if (!area.dataset.draftSaverAttached) {
            area.addEventListener('input', handleDraftInput);
            area.dataset.draftSaverAttached = 'true';
        }

        if (area.dataset.draftRestoreConvoId !== id) {
            restoreStoredDraft(area, id);
            area.dataset.draftRestoreConvoId = id;
        }

        // React can assign textarea.value without a reliable input event after
        // submit. Check the live value briefly on each manager pass as well.
        suppressResurrectedSentText(area, id);
    }

    function setupDraftCleaner(textarea) {
        if (!textarea) return;

        const scope = textarea.closest('.detail-view') || textarea.closest('form') || document;
        const form = textarea.closest('form');
        const resolveTextarea = () => getActiveTextarea() || textarea;
        const sendButtons = new Set(scope.querySelectorAll('button[aria-label="Send reply"], button[aria-label*="Send"]'));
        form?.querySelectorAll('button[type="submit"]').forEach(btn => sendButtons.add(btn));

        sendButtons.forEach(sendBtn => {
            if (sendBtn.id === 'send-btn' || sendBtn.classList.contains('etsy-ai-send-btn')) return;
            if (!sendBtn.dataset.draftCleanerAttached) {
                sendBtn.addEventListener('pointerdown', () => rememberPendingSendText(resolveTextarea()), true);
                sendBtn.addEventListener('click', () => clearDraftAndMarkSent(resolveTextarea()), true);
                sendBtn.dataset.draftCleanerAttached = 'true';
            }
        });

        if (!textarea.dataset.draftKeydownCleanerAttached) {
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    clearDraftAndMarkSent(textarea);
                }
            }, true);
            textarea.dataset.draftKeydownCleanerAttached = 'true';
        }

        if (form && !form.dataset.draftSubmitCleanerAttached) {
            form.addEventListener('submit', () => clearDraftAndMarkSent(resolveTextarea()), true);
            form.dataset.draftSubmitCleanerAttached = 'true';
        }

    }

    async function reconcileSentDraftWithChatHistory(convoId = getConversationId()) {
        if (!convoId || !chrome.runtime?.id) return;
        let reconciled = false;

        try {
            const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
            const chatHistory = result.ETSY_CHAT_HISTORY;
            if (!chatHistory?.messages || String(chatHistory.convo_id) !== String(convoId)) return;

            const latestSellerMessage = getLatestSellerMessage(chatHistory);
            if (!latestSellerMessage) return;

            const latestText = normalizeDraftText(getMessageText(latestSellerMessage));
            if (!latestText) return;

            const keys = getDraftStorageKeys(convoId);
            const draftUpdatedAt = readStorageTimestamp(keys.draftUpdatedAtKey);
            const sentText = localStorage.getItem(keys.sentTextKey) || '';
            const confirmedSentText = localStorage.getItem(keys.confirmedSentTextKey) || '';

            localStorage.setItem(keys.confirmedSentTextKey, latestText);
            localStorage.setItem(keys.confirmedSentAtKey, String(getMessageTimestampMs(latestSellerMessage) || Date.now()));
            reconciled = true;

            const draft = localStorage.getItem(keys.draftKey) || '';
            if (normalizeDraftText(draft) === latestText) {
                removeStoredDraft(convoId);

                const activeTextarea = getActiveTextarea();
                if (activeTextarea && normalizeDraftText(activeTextarea.value) === latestText) {
                    activeTextarea.value = '';
                    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to reconcile sent draft with chat history:', error);
        }

        return reconciled;
    }

    function forceCleanupChatMode() {
        document.documentElement.classList.remove('ecm-active');
        document.body.classList.remove('ecm-active');

        const r1 = document.getElementById('resizer-left');
        const r2 = document.getElementById('resizer-right');

        if (r1) r1.remove();
        if (r2) r2.remove();

        document.querySelectorAll('.my-col-right').forEach(el => el.classList.remove('my-col-right'));
        document.querySelectorAll('.my-col-center').forEach(el => el.classList.remove('my-col-center'));

        // Clean up attachments viewer
        const attachmentsViewer = document.getElementById('etsy-ai-attachments-viewer');
        if (attachmentsViewer) {
            attachmentsViewer.remove();
        }
        lastAttachmentsConvoId = null;
        lastAttachmentsHash = null;

        document.body.classList.add('ecm-list-mode');
        document.documentElement.classList.add('ecm-list-mode');
    }

    // === ATTACHMENTS VIEWER ===

    /**
     * Extract attachments from chat history
     * @param {Object} chatHistory - Chat history object from storage
     * @returns {Array} Array of {id, url, thumb_url}
     */
    function extractAttachments(chatHistory) {
        if (!chatHistory?.messages) return [];

        const attachments = [];
        const seenIds = new Set();

        for (const msg of chatHistory.messages) {
            // Method 1: Full history attachments (from mission-control API)
            if (msg.attachments?.length > 0) {
                for (const att of msg.attachments) {
                    const id = att.convo_message_attachment_id || att.attachment_id;
                    if (id && !seenIds.has(id)) {
                        attachments.push({
                            id: id,
                            url: att.url,
                            thumb_url: att.thumb_url
                        });
                        seenIds.add(id);
                    }
                }
            }

            // Method 2: Fallback images array (from pagination API)
            if (msg.images?.length > 0) {
                for (const img of msg.images) {
                    const id = img.image_id;
                    if (id && !seenIds.has(id)) {
                        const thumb = img.image_data?.sources?.find(s => s.width === 75);
                        attachments.push({
                            id: id,
                            url: img.image_data.url,
                            thumb_url: thumb?.url || img.image_data.url
                        });
                        seenIds.add(id);
                    }
                }
            }
        }

        return attachments;
    }

    /**
     * Create HTML for attachments accordion
     */
    function createAttachmentsHTML(attachments) {
        const count = attachments.length;
        const toggleId = `wt-content-toggle-${Math.random().toString(36).substring(7)}`;

        let gridItems = '';
        for (const att of attachments) {
            gridItems += `
                <div class="wt-grid__item-xs-4 wt-display-flex-xs wt-justify-content-center">
                    <a href="${att.url}" 
                       class="wt-transparent-card etsy-ai-attachment-link" 
                       data-image-url="${att.url}"
                       data-attachment-id="${att.id}">
                        <img src="${att.thumb_url}" 
                             alt="Attachment ${att.id}" 
                             class="grid-image">
                    </a>
                </div>
            `;
        }

        return `
            <div data-clg-id="WtAccordion">
                <button type="button" 
                        aria-controls="${toggleId}" 
                        aria-expanded="false" 
                        data-clg-id="WtButton" 
                        class="wt-btn wt-btn--transparent wt-btn--transparent-flush-left wt-content-toggle--btn wt-content-toggle--with-icon wt-content-toggle--full-width wt-content-toggle--flush">
                    <span class="wt-flex-xs-auto wt-width-full">
                        <div class="wt-display-flex-xs wt-justify-content-space-between wt-align-items-center">
                            <h3 class="wt-text-caption-title">Attached files</h3>
                            <h3 class="wt-text-caption wt-ml-xs-1">${count}</h3>
                        </div>
                    </span>
                    <span aria-hidden="true" class="wt-content-toggle--btn__icon"></span>
                </button>
                <div id="${toggleId}" 
                     aria-hidden="true" 
                     class="wt-content-toggle__body" 
                     style="max-height: 0px;" 
                     tabindex="-1">
                    <div class="wt-pt-xs-1">
                        <div class="wt-mt-xs-1 wt-grid wt-grid--block wt-horizontal-center listing-grid">
                            ${gridItems}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Attach accordion toggle listeners
     */
    function attachAccordionListeners(container) {
        const button = container.querySelector('button[aria-controls]');
        if (!button) return;

        const targetId = button.getAttribute('aria-controls');
        const body = document.getElementById(targetId);
        if (!body) return;

        button.addEventListener('click', () => {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';

            if (isExpanded) {
                button.setAttribute('aria-expanded', 'false');
                body.setAttribute('aria-hidden', 'true');
                body.style.maxHeight = '0px';
            } else {
                button.setAttribute('aria-expanded', 'true');
                body.setAttribute('aria-hidden', 'false');
                body.style.maxHeight = body.scrollHeight + 'px';
            }
        });
    }

    /**
     * Attach image click listeners for lightbox
     */
    function attachImageListeners(container) {
        const links = container.querySelectorAll('.etsy-ai-attachment-link');

        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const imageUrl = link.dataset.imageUrl;

                // Use existing EtsyImageModal if available
                if (window.EtsyImageModal) {
                    window.EtsyImageModal.showImage(imageUrl);
                } else {
                    // Fallback: open in new tab
                    window.open(imageUrl, '_blank');
                }
            });
        });
    }

    /**
     * Inject attachments viewer into right column
     * OPTIMIZED: Single storage call, caching, deduplication
     */
    async function injectAttachmentsViewer() {
        // Only on chat page
        if (!/\/messages\/\d+/.test(window.location.pathname)) {
            return;
        }

        // Get current conversation ID
        const match = window.location.pathname.match(/\/messages\/(\d+)/);
        const currentConvoId = match ? match[1] : null;
        if (!currentConvoId) {
            return;
        }

        // Find right column
        const rightCol = document.querySelector('.my-col-right');
        if (!rightCol) {
            return;
        }

        // Check extension context
        if (!chrome.runtime?.id) {
            return;
        }

        try {
            // OPTIMIZATION: Single storage call
            const result = await chrome.storage.local.get(['ETSY_CHAT_HISTORY']);
            const chatHistory = result.ETSY_CHAT_HISTORY;

            // No chat history - remove viewer if exists
            if (!chatHistory?.messages) {
                const existingViewer = document.getElementById('etsy-ai-attachments-viewer');
                if (existingViewer) {
                    existingViewer.remove();
                    lastAttachmentsConvoId = null;
                    lastAttachmentsHash = null;
                }
                return;
            }

            // Check if this is for current conversation
            if (chatHistory.convo_id !== currentConvoId) {
                return; // Stale data
            }

            // Extract attachments
            const attachments = extractAttachments(chatHistory);

            // Create hash for change detection
            const attachmentsHash = attachments.map(a => a.id).join(',');

            // OPTIMIZATION: Skip if nothing changed
            if (currentConvoId === lastAttachmentsConvoId && attachmentsHash === lastAttachmentsHash) {
                return; // No changes
            }

            // Update cache
            lastAttachmentsConvoId = currentConvoId;
            lastAttachmentsHash = attachmentsHash;

            // Remove existing viewer
            const existingViewer = document.getElementById('etsy-ai-attachments-viewer');
            if (existingViewer) {
                existingViewer.remove();
            }

            // No attachments - don't create viewer
            if (attachments.length === 0) {
                return;
            }

            // Create and inject viewer
            const viewerHtml = createAttachmentsHTML(attachments);

            const container = document.createElement('div');
            container.id = 'etsy-ai-attachments-viewer';
            container.className = 'wt-mt-xs-2 wt-mb-xs-2 wt-pl-xs-3 wt-pr-xs-3 wt-pl-md-1 wt-pr-md-1';
            container.innerHTML = viewerHtml;

            // Insert at end of right column (after other elements)
            rightCol.appendChild(container);

            // Attach event listeners
            attachAccordionListeners(container);
            attachImageListeners(container);

        } catch (error) {
            console.error('⚠️ Chat Manager: Failed to inject attachments viewer:', error);
        }
    }

    function loop() {
        restoreVars();

        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
        }

        const isChatUrl = /\/messages\/\d+/.test(window.location.href);

        if (!isChatUrl) {
            forceCleanupChatMode();

            const parent = document.querySelector('.wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full');
            if (parent) {
                const col1 = parent.querySelector('.wt-grid__item-lg-2');
                if (col1) {
                    if (!col1.classList.contains('my-col-left')) {
                        col1.classList.add('my-col-left');
                    }

                    if (!document.getElementById('resizer-left')) {
                        createLeftResizer(parent);
                    }
                }
            }
            return;
        }

        const parent = document.querySelector('.wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full');
        if (!parent) return;

        const col1 = parent.querySelector('.wt-grid__item-lg-2');
        const col2 = parent.querySelector('.detail-view');
        const col3 = parent.querySelector('.wt-grid__item-lg-3');

        if (!col1 || !col2) return;

        if (!document.body.classList.contains('ecm-active')) {
            window.scrollTo(0, 0);

            document.body.classList.remove('ecm-list-mode');
            document.documentElement.classList.remove('ecm-list-mode');
            document.body.classList.add('ecm-active');
            document.documentElement.classList.add('ecm-active');
        }

        if (!col1.classList.contains('my-col-left')) col1.classList.add('my-col-left');
        if (!col2.classList.contains('my-col-center')) col2.classList.add('my-col-center');
        if (col3 && !col3.classList.contains('my-col-right')) col3.classList.add('my-col-right');

        if (!document.getElementById('resizer-left')) {
            createLeftResizer(parent);
        }

        if (!document.getElementById('resizer-right')) {
            createRightResizer(parent);
        }

        // Horizontal resizer removed - textarea auto-expands now

        const area = document.querySelector('textarea.wt-textarea');
        const m = location.href.match(/\/messages\/(\d+)/);

        if (area && m) {
            const id = m[1];
            if (area.dataset.reconciledChatHistoryConvoId !== id) {
                reconcileSentDraftWithChatHistory(id).catch(err => {
                    console.warn('⚠️ Failed initial draft reconciliation:', err);
                }).finally(() => {
                    setupDraftPersistence(area, id);
                    setupDraftCleaner(area);
                });
                area.dataset.reconciledChatHistoryConvoId = id;
            } else {
                setupDraftPersistence(area, id);
                setupDraftCleaner(area);
            }
        }

        // Inject attachments viewer (optimized with caching)
        injectAttachmentsViewer();
    }

    function createLeftResizer(parent) {
        const r1 = document.createElement('div');
        r1.id = 'resizer-left';
        r1.className = 'my-resizer';
        parent.appendChild(r1);

        let isDragging = false;
        r1.onmousedown = (e) => {
            isDragging = true;
            document.body.classList.add('is-resizing');
            r1.classList.add('active');
            e.preventDefault();
        };

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const rect = parent.getBoundingClientRect();
            let newW = e.clientX - rect.left;
            let maxW = window.innerWidth - 300;
            if (newW > maxW) newW = maxW;
            if (newW < 50) newW = 50;
            document.documentElement.style.setProperty('--wl', newW + 'px');
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.classList.remove('is-resizing');
                r1.classList.remove('active');
                localStorage.setItem(KEY_L, parseFloat(document.documentElement.style.getPropertyValue('--wl')));
            }
        });
    }

    function createRightResizer(parent) {
        const r2 = document.createElement('div');
        r2.id = 'resizer-right';
        r2.className = 'my-resizer';
        parent.appendChild(r2);

        let isDragging = false;

        r2.onmousedown = (e) => {
            isDragging = true;
            document.body.classList.add('is-resizing');
            r2.classList.add('active');
            e.preventDefault();
        };

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();

            // Calculate width from right edge of screen
            const newW = window.innerWidth - e.clientX;

            const minWidth = 50;
            const maxWidth = window.innerWidth * 0.6;

            let finalW = newW;
            if (finalW < minWidth) finalW = minWidth;
            if (finalW > maxWidth) finalW = maxWidth;

            document.documentElement.style.setProperty('--wr', finalW + 'px');
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.classList.remove('is-resizing');
                r2.classList.remove('active');

                const finalWidth = parseFloat(document.documentElement.style.getPropertyValue('--wr'));
                localStorage.setItem(KEY_R, finalWidth);
            }
        });
    }

    // Horizontal resizer removed - textarea auto-expands

    function scheduleLoop() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            loop();
            rafId = null;
        });
    }

    function startMonitoring() {
        // Listen for storage changes to react instantly when interceptor saves chat history
        storageChangeListener = (changes, areaName) => {
            if (areaName === 'local' && changes.ETSY_CHAT_HISTORY) {
                // Immediately update attachments viewer
                injectAttachmentsViewer().catch(err => {
                    console.warn('⚠️ Failed to update attachments on storage change:', err);
                });
                reconcileSentDraftWithChatHistory().catch(err => {
                    console.warn('⚠️ Failed to reconcile draft on storage change:', err);
                });
            }
        };
        chrome.storage.onChanged.addListener(storageChangeListener);

        observer = new MutationObserver(scheduleLoop);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Replace interval with event listeners for navigation detection
        popstateListener = () => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                scheduleLoop();
            }
        };

        hashchangeListener = () => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                scheduleLoop();
            }
        };

        window.addEventListener('popstate', popstateListener);
        window.addEventListener('hashchange', hashchangeListener);

        loop();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', loop);
        }

        window.addEventListener('load', loop);
    }

})();
