// chat_manager.js - Etsy Chat Manager Module
// Adapted from Tampermonkey UserScript v45.0
// Provides resizable panels and enhanced UX for Etsy Messages

(function () {
    'use strict';

    const KEY_L = 'etsy_clean_left';
    const KEY_R = 'etsy_clean_right';
    const KEY_H = 'etsy_clean_input_height';

    let styleElement = null;
    let isInitialized = false;
    let rafId = null;
    let observer = null;
    let urlCheckInterval = null;
    let lastUrl = location.href;
    let draftCleanerAttached = false;
    let lastParsedHash = "";

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
            draftCleanerAttached = false;
            lastParsedHash = "";
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

        /* Контейнер у списку */
        body.ecm-list-mode .wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full {
            position: relative !important;
            display: block !important;
            margin-top: 0 !important;
            top: 0 !important;
        }

        /* ЛІВА КОЛОНКА В СПИСКУ */
        body.ecm-list-mode .my-col-left {
            width: var(--wl) !important;
            min-width: var(--wl) !important;
            max-width: var(--wl) !important;
            flex: 0 0 var(--wl) !important;
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

    function setupDraftCleaner() {
        const sendBtn = document.querySelector('button[aria-label="Send reply"]');
        const textarea = document.querySelector('textarea.wt-textarea');

        if (!sendBtn || !textarea || draftCleanerAttached) return;

        const clearDraft = () => {
            const m = location.href.match(/\/messages\/(\d+)/);
            if (m) {
                const id = m[1];
                localStorage.removeItem('draft_' + id);
            }
        };

        sendBtn.addEventListener('click', () => {
            setTimeout(clearDraft, 300);
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                setTimeout(clearDraft, 300);
            }
        });

        textarea.addEventListener('input', (e) => {
            if (e.target.value.trim() === '') {
                clearDraft();
            }
        });

        draftCleanerAttached = true;
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

        draftCleanerAttached = false;

        document.body.classList.add('ecm-list-mode');
        document.documentElement.classList.add('ecm-list-mode');
    }

    function loop() {
        restoreVars();

        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            draftCleanerAttached = false;
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

            if (!area.dataset.saved) {
                const v = localStorage.getItem('draft_' + id);
                if (v) {
                    area.value = v;
                    area.dispatchEvent(new Event('input', { bubbles: true }));
                }

                area.oninput = (e) => {
                    const text = e.target.value;
                    if (text.trim() !== '') {
                        localStorage.setItem('draft_' + id, text);
                    } else {
                        localStorage.removeItem('draft_' + id);
                    }
                };

                area.dataset.saved = "true";
            }

            setupDraftCleaner();
        }
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
        observer = new MutationObserver(scheduleLoop);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        urlCheckInterval = setInterval(() => {
            if (location.href !== lastUrl) {
                scheduleLoop();
            }
        }, 100);

        loop();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', loop);
        }

        window.addEventListener('load', loop);
    }

})();
