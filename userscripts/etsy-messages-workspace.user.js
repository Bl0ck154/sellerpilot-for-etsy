// ==UserScript==
// @name         SellerPilot - Etsy Messages Workspace
// @namespace    https://github.com/Bl0ck154/sellerpilot-for-etsy
// @version      1.0.0
// @description  Makes Etsy Shop Manager Messages use the screen properly: full-height chat, resizable panels, saved drafts, and an attachment gallery. No AI required.
// @author       Bl0ck154
// @match        https://www.etsy.com/messages*
// @match        https://www.etsy.com/messages/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const ID = 'sellerpilot-etsy-messages-workspace';
    const STYLE_ID = `${ID}-style`;
    const VIEWER_ID = `${ID}-attachments`;
    const LIGHTBOX_ID = `${ID}-lightbox`;
    const LEFT_RESIZER_ID = `${ID}-resizer-left`;
    const RIGHT_RESIZER_ID = `${ID}-resizer-right`;
    const KEY_LEFT = `${ID}:left-width`;
    const KEY_RIGHT = `${ID}:right-width`;
    const DRAFT_PREFIX = `${ID}:draft:`;
    const SENT_PREFIX = `${ID}:sent:`;
    const DEFAULT_LEFT = 300;
    const DEFAULT_RIGHT = 350;
    const MIN_PANEL = 120;
    const SENT_GUARD_MS = 5 * 60 * 1000;

    let observer = null;
    let refreshScheduled = false;
    let lastUrl = location.href;
    let historyMessages = [];
    let historyConversationId = null;
    let attachmentHash = '';

    const selectors = {
        composer: [
            'textarea.wt-textarea',
            'textarea[placeholder*="reply" i]',
            'textarea[aria-label*="reply" i]',
            '.detail-view form textarea',
            'main form textarea'
        ],
        detail: ['.detail-view', '[data-conversation-id]'],
        grid: ['.wt-grid.wt-overflow-hidden.wt-bt-xs.wt-width-full', 'main .wt-grid.wt-width-full'],
        left: ['.wt-grid__item-lg-2'],
        right: ['.wt-grid__item-lg-3'],
        messageList: ['.msg-list-container', '.scrolling-message-list', '[role="log"]', '[aria-label*="message" i][role="region"]']
    };

    function queryFirst(list, root = document) {
        for (const selector of list) {
            try {
                const el = root.querySelector(selector);
                if (el) return el;
            } catch (_) {}
        }
        return null;
    }

    function conversationId() {
        return location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function isMessagesPage() {
        return /^\/messages(?:\/|$)/.test(location.pathname);
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ''), location.href);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function directChildContaining(root, element) {
        if (!root || !element) return null;
        let current = element;
        while (current?.parentElement && current.parentElement !== root) current = current.parentElement;
        return current?.parentElement === root ? current : null;
    }

    function findLayout() {
        const composer = queryFirst(selectors.composer);
        const detail = queryFirst(selectors.detail) || composer?.closest('.detail-view') || composer?.closest('[data-conversation-id]');
        const grid = queryFirst(selectors.grid) || detail?.closest('.wt-grid');
        if (!composer || !detail || !grid) return { composer, detail, grid, left: null, center: null, right: null };

        const center = directChildContaining(grid, detail) || detail;
        let left = queryFirst(selectors.left, grid) || center.previousElementSibling;
        let right = queryFirst(selectors.right, grid) || center.nextElementSibling;
        if (left === center) left = null;
        if (right === center) right = null;
        return { composer, detail, grid, left, center, right };
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            :root { --sp-left: ${DEFAULT_LEFT}px; --sp-right: ${DEFAULT_RIGHT}px; }
            html.sp-workspace, body.sp-workspace { height:100vh!important; width:100%!important; overflow:hidden!important; margin:0!important; padding:0!important; background:#fff!important; }
            body.sp-workspace footer, body.sp-workspace .wt-footer-theme-black, body.sp-workspace #gnav-footer { display:none!important; }
            body.sp-workspace .sp-grid { display:flex!important; flex-flow:row nowrap!important; align-items:stretch!important; width:100%!important; height:calc(100vh - 64px)!important; max-height:calc(100vh - 64px)!important; margin:0!important; padding:0!important; overflow:hidden!important; position:relative!important; box-sizing:border-box!important; }
            body.sp-workspace .sp-left { flex:0 0 var(--sp-left)!important; width:var(--sp-left)!important; min-width:${MIN_PANEL}px!important; max-width:55vw!important; margin:0!important; padding:0!important; overflow-y:auto!important; border-right:1px solid #ddd; box-sizing:border-box!important; }
            body.sp-workspace .sp-center { flex:1 1 auto!important; width:0!important; min-width:0!important; max-width:none!important; height:100%!important; min-height:0!important; margin:0!important; padding:0!important; overflow:hidden!important; display:flex!important; flex-direction:column!important; box-sizing:border-box!important; }
            body.sp-workspace .sp-center > * { width:100%!important; max-width:none!important; box-sizing:border-box!important; }
            body.sp-workspace .sp-right { flex:0 0 var(--sp-right)!important; width:var(--sp-right)!important; min-width:${MIN_PANEL}px!important; max-width:55vw!important; margin:0!important; padding:0!important; overflow-y:auto!important; border-left:1px solid #ddd; box-sizing:border-box!important; }
            body.sp-workspace .msg-list-container, body.sp-workspace .sp-message-list { flex:1 1 auto!important; height:0!important; min-height:0!important; max-height:none!important; margin-bottom:0!important; padding-bottom:0!important; overflow:hidden!important; position:relative!important; }
            body.sp-workspace .msg-list-container > div, body.sp-workspace .scrolling-message-list, body.sp-workspace .sp-message-list [role="log"] { height:100%!important; min-height:100%!important; max-height:100%!important; }
            body.sp-workspace .inline-compose-container, body.sp-workspace .sp-compose { flex:0 0 auto!important; min-height:60px!important; max-height:50vh!important; margin:0!important; overflow:visible!important; background:#fff!important; border-top:1px solid #ddd; position:relative!important; z-index:30!important; }
            body.sp-workspace textarea.sp-composer, body.sp-workspace textarea.wt-textarea { min-height:60px!important; max-height:50vh!important; overflow-y:auto!important; resize:none!important; }
            .sp-resizer { position:absolute; top:0; bottom:0; width:16px; z-index:99999; cursor:col-resize; user-select:none; background:transparent; }
            .sp-resizer::after { content:''; position:absolute; top:0; bottom:0; left:7px; width:1px; background:rgba(0,0,0,.12); transition:.1s; }
            .sp-resizer:hover::after, .sp-resizer.active::after { width:3px; background:#f1641e; }
            #${LEFT_RESIZER_ID} { left:var(--sp-left); transform:translateX(-50%); }
            #${RIGHT_RESIZER_ID} { right:var(--sp-right); transform:translateX(50%); }
            body.sp-resizing, body.sp-resizing * { cursor:col-resize!important; user-select:none!important; }
            #${VIEWER_ID} { margin:12px 16px; padding:12px; border:1px solid #e1e1e1; border-radius:10px; background:#fff; font-family:Arial,sans-serif; }
            #${VIEWER_ID} summary { cursor:pointer; font-weight:600; font-size:14px; }
            #${VIEWER_ID} .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px; }
            #${VIEWER_ID} button { display:block; width:100%; aspect-ratio:1/1; border:0; padding:0; background:#f5f5f5; border-radius:8px; overflow:hidden; cursor:zoom-in; }
            #${VIEWER_ID} img { width:100%; height:100%; display:block; object-fit:cover; }
            #${LIGHTBOX_ID} { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:30px; background:rgba(0,0,0,.84); cursor:zoom-out; }
            #${LIGHTBOX_ID} img { max-width:95vw; max-height:92vh; object-fit:contain; border-radius:6px; box-shadow:0 10px 50px rgba(0,0,0,.35); }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function restoreWidths() {
        const max = Math.max(MIN_PANEL, window.innerWidth * 0.55);
        const left = clamp(Number(localStorage.getItem(KEY_LEFT)) || DEFAULT_LEFT, MIN_PANEL, max);
        const right = clamp(Number(localStorage.getItem(KEY_RIGHT)) || DEFAULT_RIGHT, MIN_PANEL, max);
        document.documentElement.style.setProperty('--sp-left', `${left}px`);
        document.documentElement.style.setProperty('--sp-right', `${right}px`);
    }

    function createResizer(grid, side) {
        const id = side === 'left' ? LEFT_RESIZER_ID : RIGHT_RESIZER_ID;
        if (document.getElementById(id)) return;
        const el = document.createElement('div');
        el.id = id;
        el.className = 'sp-resizer';
        el.setAttribute('aria-hidden', 'true');
        grid.appendChild(el);
        el.addEventListener('mousedown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            el.classList.add('active');
            document.body.classList.add('sp-resizing');
            const rect = grid.getBoundingClientRect();
            const onMove = move => {
                const max = Math.max(MIN_PANEL, window.innerWidth * 0.55);
                const width = side === 'left'
                    ? clamp(move.clientX - rect.left, MIN_PANEL, max)
                    : clamp(rect.right - move.clientX, MIN_PANEL, max);
                document.documentElement.style.setProperty(side === 'left' ? '--sp-left' : '--sp-right', `${width}px`);
                localStorage.setItem(side === 'left' ? KEY_LEFT : KEY_RIGHT, String(Math.round(width)));
            };
            const onUp = () => {
                el.classList.remove('active');
                document.body.classList.remove('sp-resizing');
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
            };
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
        });
    }

    function draftKey(id) { return `${DRAFT_PREFIX}${id}`; }
    function sentKey(id) { return `${SENT_PREFIX}${id}`; }

    function readSent(id) {
        try { return JSON.parse(localStorage.getItem(sentKey(id)) || 'null'); }
        catch (_) { return null; }
    }

    function markSent(id, text) {
        localStorage.removeItem(draftKey(id));
        const normalized = normalizeText(text);
        if (normalized) localStorage.setItem(sentKey(id), JSON.stringify({ text: normalized, at: Date.now() }));
    }

    function setupDrafts(composer, id) {
        if (!(composer instanceof HTMLTextAreaElement) || !id) return;
        composer.classList.add('sp-composer');
        composer.dataset.spConversationId = id;
        const saved = localStorage.getItem(draftKey(id));
        const sent = readSent(id);
        const sentGuard = sent?.at && Date.now() - sent.at < SENT_GUARD_MS && normalizeText(saved) === sent.text;
        if (!composer.value && saved && !sentGuard) {
            composer.value = saved;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (!composer.dataset.spDraftListener) {
            composer.addEventListener('input', () => {
                const currentId = composer.dataset.spConversationId || conversationId();
                if (!currentId) return;
                const text = composer.value;
                const lastSent = readSent(currentId);
                const recentlySent = lastSent?.at && Date.now() - lastSent.at < SENT_GUARD_MS && normalizeText(text) === lastSent.text;
                if (!normalizeText(text) || recentlySent) localStorage.removeItem(draftKey(currentId));
                else localStorage.setItem(draftKey(currentId), text);
            });
            composer.dataset.spDraftListener = '1';
        }
        const form = composer.closest('form');
        const scope = composer.closest('.detail-view') || form || document;
        const buttons = new Set(scope.querySelectorAll('button[aria-label="Send reply"],button[aria-label*="Send"]'));
        form?.querySelectorAll('button[type="submit"]').forEach(button => buttons.add(button));
        buttons.forEach(button => {
            if (button.dataset.spSendListener) return;
            button.addEventListener('click', () => markSent(composer.dataset.spConversationId || conversationId(), composer.value), true);
            button.dataset.spSendListener = '1';
        });
        if (!composer.dataset.spEnterListener) {
            composer.addEventListener('keydown', event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    markSent(composer.dataset.spConversationId || conversationId(), composer.value);
                }
            }, true);
            composer.dataset.spEnterListener = '1';
        }
    }

    function attachmentFrom(raw) {
        const url = safeUrl(raw?.url || raw?.fullsize_url || raw?.image_url || raw?.download_url || raw?.image_data?.url || '');
        if (!url) return null;
        const thumb = safeUrl(raw?.thumb_url || raw?.thumbnail_url || raw?.image_data?.sources?.find(source => Number(source?.width) >= 75)?.url || raw?.image_data?.url || url) || url;
        return { url, thumb };
    }

    function attachmentsFromHistory() {
        const items = [];
        const seen = new Set();
        for (const message of historyConversationId === conversationId() ? historyMessages : []) {
            for (const group of [message?.attachments, message?.images]) {
                for (const raw of Array.isArray(group) ? group : []) {
                    const item = attachmentFrom(raw);
                    if (!item || seen.has(item.url)) continue;
                    seen.add(item.url);
                    items.push(item);
                }
            }
        }
        return items;
    }

    function attachmentsFromDom() {
        const list = queryFirst(selectors.messageList);
        if (!list) return [];
        const items = [];
        const seen = new Set();
        for (const img of list.querySelectorAll('a[href] img[src],img[src*="etsystatic.com"]')) {
            const url = safeUrl(img.closest('a[href]')?.href || img.currentSrc || img.src);
            const thumb = safeUrl(img.currentSrc || img.src || url) || url;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            items.push({ url, thumb });
        }
        return items;
    }

    function allAttachments() {
        const seen = new Set();
        return [...attachmentsFromHistory(), ...attachmentsFromDom()].filter(item => {
            if (!item.url || seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        });
    }

    function showLightbox(url) {
        document.getElementById(LIGHTBOX_ID)?.remove();
        const resolved = safeUrl(url);
        if (!resolved) return;
        const overlay = document.createElement('div');
        overlay.id = LIGHTBOX_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Attachment preview');
        const img = document.createElement('img');
        img.src = resolved;
        img.alt = 'Attachment preview';
        overlay.appendChild(img);
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    function renderAttachments(right) {
        const existing = document.getElementById(VIEWER_ID);
        if (!right) {
            existing?.remove();
            return;
        }
        const attachments = allAttachments();
        const hash = attachments.map(item => item.url).join('|');
        if (existing && hash === attachmentHash) return;
        attachmentHash = hash;
        existing?.remove();
        if (!attachments.length) return;
        const details = document.createElement('details');
        details.id = VIEWER_ID;
        const summary = document.createElement('summary');
        summary.textContent = `Attached files (${attachments.length})`;
        const grid = document.createElement('div');
        grid.className = 'grid';
        attachments.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.title = 'Open attachment';
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = item.thumb;
            img.alt = 'Conversation attachment';
            button.appendChild(img);
            button.addEventListener('click', () => showLightbox(item.url));
            grid.appendChild(button);
        });
        details.append(summary, grid);
        right.insertBefore(details, right.firstChild);
    }

    function normalizeMessages(messages) {
        return (Array.isArray(messages) ? messages : []).map(message => ({
            ...message,
            attachments: Array.isArray(message?.attachments) ? message.attachments : (Array.isArray(message?.images) ? message.images : [])
        }));
    }

    async function fetchFullHistory(detail, shopId) {
        const id = String(detail?.conversation_id || '');
        const receiptId = detail?.receipt_history?.[0]?.receipt_id;
        if (!id || id !== conversationId() || !receiptId || !shopId) return;
        try {
            const response = await fetch(`/api/v3/ajax/shop/${encodeURIComponent(shopId)}/mission-control/orders/convos/${encodeURIComponent(receiptId)}`, {
                credentials: 'include',
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!response.ok) return;
            const data = await response.json();
            if (id !== conversationId() || !Array.isArray(data?.messages) || !data.messages.length) return;
            historyMessages = normalizeMessages(data.messages);
            historyConversationId = id;
            attachmentHash = '';
            scheduleRefresh();
        } catch (_) {}
    }

    function acceptDetailData(data) {
        const detail = data?.detail;
        const id = String(detail?.conversation_id || '');
        if (!detail || !id || id !== conversationId()) return;
        const messages = normalizeMessages(detail.messages);
        if (messages.length) {
            historyMessages = messages;
            historyConversationId = id;
            attachmentHash = '';
        }
        fetchFullHistory(detail, data?.shop_id || detail?.shop_id || null);
        scheduleRefresh();
    }

    function installFetchInterceptor() {
        if (window.__SELLERPILOT_MESSAGES_WORKSPACE_FETCH_PATCHED__) return;
        window.__SELLERPILOT_MESSAGES_WORKSPACE_FETCH_PATCHED__ = true;
        const original = window.fetch;
        if (typeof original !== 'function') return;
        window.fetch = async function (...args) {
            const response = await original.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                if (url?.includes('/conversations/detail-view-data')) response.clone().json().then(acceptDetailData).catch(() => {});
            } catch (_) {}
            return response;
        };
    }

    function tryEmbeddedContext() {
        const id = conversationId();
        if (!id || historyConversationId === id) return;
        const detail = window.Etsy?.Context?.data?.initial_data?.detail;
        if (String(detail?.conversation_id || '') !== id) return;
        const messages = normalizeMessages(detail.messages);
        if (messages.length) {
            historyMessages = messages;
            historyConversationId = id;
            attachmentHash = '';
        }
    }

    function cleanup() {
        document.documentElement.classList.remove('sp-workspace');
        document.body?.classList.remove('sp-workspace', 'sp-resizing');
        ['sp-grid', 'sp-left', 'sp-center', 'sp-right', 'sp-message-list', 'sp-compose', 'sp-composer'].forEach(cls => {
            document.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
        });
        document.getElementById(LEFT_RESIZER_ID)?.remove();
        document.getElementById(RIGHT_RESIZER_ID)?.remove();
        document.getElementById(VIEWER_ID)?.remove();
    }

    function apply() {
        if (!document.body || !isMessagesPage()) return;
        ensureStyle();
        restoreWidths();
        const id = conversationId();
        if (!id) {
            cleanup();
            return;
        }
        const { composer, grid, left, center, right } = findLayout();
        if (!composer || !grid || !center) {
            cleanup();
            return;
        }
        tryEmbeddedContext();
        document.documentElement.classList.add('sp-workspace');
        document.body.classList.add('sp-workspace');
        grid.classList.add('sp-grid');
        center.classList.add('sp-center');
        left?.classList.add('sp-left');
        right?.classList.add('sp-right');
        queryFirst(selectors.messageList)?.classList.add('sp-message-list');
        (composer.closest('.inline-compose-container') || composer.closest('form'))?.classList.add('sp-compose');
        setupDrafts(composer, id);
        if (left) createResizer(grid, 'left');
        if (right) createResizer(grid, 'right');
        renderAttachments(right);
    }

    function scheduleRefresh() {
        if (refreshScheduled) return;
        refreshScheduled = true;
        requestAnimationFrame(() => {
            refreshScheduled = false;
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                historyMessages = [];
                historyConversationId = null;
                attachmentHash = '';
            }
            apply();
        });
    }

    function patchHistory(name) {
        const original = history[name];
        if (typeof original !== 'function' || original.__spPatched) return;
        const patched = function (...args) {
            const result = original.apply(this, args);
            queueMicrotask(scheduleRefresh);
            return result;
        };
        patched.__spPatched = true;
        history[name] = patched;
    }

    installFetchInterceptor();
    patchHistory('pushState');
    patchHistory('replaceState');
    window.addEventListener('popstate', scheduleRefresh);
    window.addEventListener('hashchange', scheduleRefresh);
    window.addEventListener('resize', () => { restoreWidths(); scheduleRefresh(); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.getElementById(LIGHTBOX_ID)?.remove();
    }, true);

    const start = () => {
        if (!observer && document.documentElement) {
            observer = new MutationObserver(scheduleRefresh);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
        scheduleRefresh();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
