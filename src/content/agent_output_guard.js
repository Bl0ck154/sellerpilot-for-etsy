// agent_output_guard.js - Sanitizes AI-rendered HTML before it reaches the live DOM.
(() => {
    'use strict';

    if (window.__ETSY_AI_OUTPUT_GUARD_INSTALLED__) return;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!descriptor?.get || !descriptor?.set) return;
    window.__ETSY_AI_OUTPUT_GUARD_INSTALLED__ = true;

    const ALLOWED_TAGS = new Set([
        'A', 'B', 'BR', 'BUTTON', 'CODE', 'EM', 'H1', 'H2', 'H3', 'I', 'LI',
        'OL', 'PRE', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL'
    ]);
    const ALLOWED_CLASSES = new Set([
        'code-block-wrapper',
        'copy-code-btn',
        'copy-inline-btn',
        'inline-code-wrapper',
        'inline-code-text',
        'etsy-ai-loading-dots',
        'etsy-ai-status-text'
    ]);

    function isAiMessageTarget(element) {
        return element?.classList?.contains('etsy-ai-msg') && element.classList.contains('ai');
    }

    function safeHref(rawHref) {
        if (!rawHref) return null;
        try {
            const parsed = new URL(rawHref, location.href);
            if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return null;
            return rawHref;
        } catch (_) {
            return null;
        }
    }

    function sanitizeClassList(element) {
        const safe = [...element.classList].filter(name => ALLOWED_CLASSES.has(name));
        if (safe.length) element.setAttribute('class', safe.join(' '));
        else element.removeAttribute('class');
    }

    function sanitizeHtml(value) {
        const template = document.createElement('template');
        descriptor.set.call(template, String(value ?? ''));
        const elements = [...template.content.querySelectorAll('*')];

        for (const element of elements) {
            if (!element.isConnected && !template.content.contains(element)) continue;
            if (!ALLOWED_TAGS.has(element.tagName)) {
                element.replaceWith(document.createTextNode(element.textContent || ''));
                continue;
            }

            const href = element.tagName === 'A' ? safeHref(element.getAttribute('href')) : null;
            const buttonClass = element.tagName === 'BUTTON'
                ? [...element.classList].find(name => name === 'copy-code-btn' || name === 'copy-inline-btn')
                : null;
            const classNames = [...element.classList];

            for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);

            if (classNames.length) {
                for (const name of classNames) element.classList.add(name);
                sanitizeClassList(element);
            }

            if (element.tagName === 'A' && href) {
                element.setAttribute('href', href);
                element.setAttribute('target', '_blank');
                element.setAttribute('rel', 'noopener noreferrer');
            } else if (element.tagName === 'A') {
                element.removeAttribute('href');
            }

            if (element.tagName === 'BUTTON') {
                if (!buttonClass) {
                    element.replaceWith(document.createTextNode(element.textContent || ''));
                    continue;
                }
                element.setAttribute('class', buttonClass);
                element.setAttribute('type', 'button');
                element.setAttribute('aria-label', 'Copy');
            }
        }

        return descriptor.get.call(template);
    }

    Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
            const safeValue = isAiMessageTarget(this) ? sanitizeHtml(value) : value;
            return descriptor.set.call(this, safeValue);
        }
    });

    window.EtsyAiOutputGuard = { sanitizeHtml, safeHref };
})();
