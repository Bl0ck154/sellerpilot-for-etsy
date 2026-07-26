// quick_reply_ui.js - Quick-reply toolbar for Etsy's message composer.

(function () {
    'use strict';

    const TOOLBAR_ID = 'etsy-ai-quick-replies';
    const caretByTextarea = new WeakMap();
    let observer = null;
    let rafId = null;
    let renderGeneration = 0;
    let lastHash = '';
    let lastConversationId = '';

    function getConversationId() {
        const match = location.pathname.match(/^\/messages\/(\d+)/);
        return match ? match[1] : '';
    }

    function getTextarea() {
        return document.querySelector('textarea.wt-textarea');
    }

    function rememberCaret(textarea) {
        if (!textarea) return;
        caretByTextarea.set(textarea, {
            start: Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length,
            end: Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : textarea.value.length
        });
    }

    function trackCaret(textarea) {
        if (textarea.dataset.quickReplyCaretTracked === 'true') return;
        ['click', 'keyup', 'select', 'input', 'focus'].forEach(eventName => {
            textarea.addEventListener(eventName, () => rememberCaret(textarea));
        });
        textarea.dataset.quickReplyCaretTracked = 'true';
        rememberCaret(textarea);
    }

    function setNativeTextareaValue(textarea, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, value);
        else textarea.value = value;
    }

    function insertReply(textarea, replyText) {
        const current = textarea.value || '';
        const savedCaret = caretByTextarea.get(textarea);
        let start = savedCaret?.start;
        let end = savedCaret?.end;

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            start = current.length;
            end = current.length;
        }
        start = Math.max(0, Math.min(start, current.length));
        end = Math.max(start, Math.min(end, current.length));

        let insertion = replyText;
        if (start === end && start > 0 && !/\s$/.test(current.slice(0, start)) && !/^\s/.test(insertion)) {
            insertion = '\n' + insertion;
        }
        if (start === end && end < current.length && !/^\s/.test(current.slice(end)) && !/\s$/.test(insertion)) {
            insertion += '\n';
        }

        const nextValue = current.slice(0, start) + insertion + current.slice(end);
        const nextCaret = start + insertion.length;
        setNativeTextareaValue(textarea, nextValue);
        textarea.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: replyText
        }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
        rememberCaret(textarea);
    }

    function animateReplyToTextarea(sourceButton, textarea) {
        const sourceRect = sourceButton.getBoundingClientRect();
        const targetRect = textarea.getBoundingClientRect();
        if (!sourceRect.width || !sourceRect.height || !targetRect.width || !targetRect.height) return;

        const flyer = document.createElement('span');
        flyer.className = 'etsy-ai-quick-reply-flyer';
        flyer.textContent = sourceButton.textContent;
        flyer.style.left = `${sourceRect.left}px`;
        flyer.style.top = `${sourceRect.top}px`;
        flyer.style.maxWidth = `${Math.min(Math.max(sourceRect.width, 80), 180)}px`;
        document.body.appendChild(flyer);

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const destinationX = targetRect.left + Math.min(32, targetRect.width / 2);
        const destinationY = targetRect.top + Math.min(24, targetRect.height / 2);
        const deltaX = destinationX - sourceRect.left;
        const deltaY = destinationY - sourceRect.top;

        const animation = flyer.animate(
            reduceMotion
                ? [
                    { opacity: 0.9, transform: 'scale(1)' },
                    { opacity: 0, transform: 'scale(0.75)' }
                ]
                : [
                    { opacity: 0.95, transform: 'translate3d(0, 0, 0) scale(1)' },
                    { opacity: 0.9, offset: 0.55, transform: `translate3d(${deltaX * 0.7}px, ${deltaY * 0.55}px, 0) scale(0.8)` },
                    { opacity: 0, transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.35)` }
                ],
            {
                duration: reduceMotion ? 140 : 450,
                easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)',
                fill: 'forwards'
            }
        );
        animation.finished.catch(() => { }).finally(() => flyer.remove());
    }

    function showInsertedStatus(toolbar, label) {
        const status = toolbar.querySelector('.etsy-ai-quick-replies-status');
        if (!status) return;
        status.textContent = `"${label}" inserted — review before sending`;
        clearTimeout(status._clearTimer);
        status._clearTimer = setTimeout(() => {
            status.textContent = '';
        }, 2600);
    }

    function buildToolbar(entries, textarea, conversationId) {
        const toolbar = document.createElement('div');
        toolbar.id = TOOLBAR_ID;
        toolbar.className = 'etsy-ai-quick-replies';
        toolbar.dataset.conversationId = conversationId;
        toolbar.setAttribute('aria-label', 'Quick replies');

        const heading = document.createElement('span');
        heading.className = 'etsy-ai-quick-replies-heading';
        heading.textContent = 'Quick replies';

        const chips = document.createElement('div');
        chips.className = 'etsy-ai-quick-replies-chips';

        if (!entries.length) {
            const empty = document.createElement('span');
            empty.className = 'etsy-ai-quick-replies-empty';
            empty.textContent = 'No saved replies';
            chips.appendChild(empty);
        } else {
            for (const entry of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'etsy-ai-quick-reply-chip';
                button.textContent = entry.label;
                button.title = `${entry.text}\n\nInsert into draft`;
                button.setAttribute('aria-label', `Insert quick reply: ${entry.label}`);
                button.addEventListener('mousedown', () => rememberCaret(textarea));
                button.addEventListener('click', () => {
                    animateReplyToTextarea(button, textarea);
                    insertReply(textarea, entry.text);
                    showInsertedStatus(toolbar, entry.label);
                });
                chips.appendChild(button);
            }
        }

        const manageButton = document.createElement('button');
        manageButton.type = 'button';
        manageButton.className = 'etsy-ai-quick-replies-manage';
        manageButton.textContent = 'Manage';
        manageButton.title = 'Manage quick replies in extension settings';
        manageButton.addEventListener('click', () => {
            try {
                const openResult = chrome.runtime.openOptionsPage();
                openResult?.catch?.(error => {
                    console.warn('Quick replies: could not open settings', error);
                });
            } catch (error) {
                console.warn('Quick replies: could not open settings', error);
            }
        });

        const status = document.createElement('span');
        status.className = 'etsy-ai-quick-replies-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        toolbar.append(heading, chips, status, manageButton);
        return toolbar;
    }

    async function render(force = false) {
        const generation = ++renderGeneration;
        const conversationId = getConversationId();
        const textarea = conversationId ? getTextarea() : null;

        if (!conversationId || !textarea || !window.QuickReplyManager) {
            document.getElementById(TOOLBAR_ID)?.remove();
            lastHash = '';
            lastConversationId = '';
            return;
        }

        trackCaret(textarea);
        const entries = await window.QuickReplyManager.list();
        if (generation !== renderGeneration || !textarea.isConnected || conversationId !== getConversationId()) return;

        const hash = entries.map(entry => `${entry.id}:${entry.updatedAt || entry.createdAt}:${entry.label}:${entry.text}`).join('|');
        const existing = document.getElementById(TOOLBAR_ID);
        if (!force && existing && hash === lastHash && conversationId === lastConversationId) return;

        existing?.remove();
        const host = textarea.closest('.inline-compose-container') || textarea.parentElement;
        if (!host) return;

        host.insertBefore(buildToolbar(entries, textarea, conversationId), host.firstChild);
        lastHash = hash;
        lastConversationId = conversationId;
    }

    function scheduleRender(force = false) {
        if (force) {
            lastHash = '';
            lastConversationId = '';
        }
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            render(force).catch(error => console.warn('Quick replies: render failed', error));
        });
    }

    function start() {
        observer = new MutationObserver(() => scheduleRender());
        observer.observe(document.body, { childList: true, subtree: true });
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes[window.QuickReplyManager.STORAGE_KEY]) {
                scheduleRender(true);
            }
        });
        window.addEventListener('popstate', () => scheduleRender(true));
        window.addEventListener('hashchange', () => scheduleRender(true));
        window.addEventListener('etsy-ai-locationchange', () => scheduleRender(true));
        scheduleRender(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
