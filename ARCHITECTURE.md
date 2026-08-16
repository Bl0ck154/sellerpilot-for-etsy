# Architecture

## Overview

Etsy AI Assistant is a Manifest V3 browser extension. Most application logic runs as Etsy content scripts, while a background service worker performs operations that require extension privileges or cross-origin access.

`src/manifest.json` is the source-of-truth manifest. Chromium builds copy `src/` directly; the Firefox build derives its manifest from the same source and applies browser-specific changes.

## High-level data flow

```text
Etsy page
   |
   | DOM / page state / Etsy conversation context
   v
Content scripts
   |-- page + listing context
   |-- conversation isolation
   |-- quick replies / memory
   |-- agent policy + safety/output guards
   |-- image/shop intelligence
   |-- chat UI
   |
   +-----------> chrome.storage.local
   |
   +-----------> AI provider request
                      |
                      +-- Google Gemini (default)
                      +-- optional provider/fallback integrations
                      +-- user-configured OpenAI-compatible endpoint

Content scripts <----> background service worker
                         |-- privileged network requests
                         |-- downloads
                         |-- offscreen coordination
                         |-- custom-provider streaming
```

## Main components

### `src/content/`

The content-script layer contains the Etsy integration and most user-facing behavior.

Important groups include:

- `content.js` and page/parser modules — page lifecycle and context extraction
- `etsy_context_interceptor.js` — Etsy conversation/context capture
- `listing_editor_tracker.js` and `link_discovery.js` — listing-aware context
- `conversation_context_manager.js` — conversation-scoped state
- `memory_manager.js` — durable local assistant memory
- `quick_reply_manager.js` / `quick_reply_ui.js` — reusable draft-only replies
- `base_ai_service.js` / `ai_service_factory.js` — common AI request layer
- `providers/` — Gemini and optional provider implementations
- `agent_*` modules — context, scope, management, output, vision, and prompt guards
- `chat_manager.js` / `chat_ui.js` — local assistant history and UI

### `src/background/service_worker.js`

The service worker handles operations that should not be performed directly by the Etsy page content-script context, including privileged requests, downloads, offscreen coordination, and custom-provider network access.

### `src/options/`

The settings UI stores provider credentials and user preferences in extension-local storage. It also exposes memory, quick replies, custom instructions, and custom-provider configuration.

### `src/config/`

- `base_instruction.js` — stable assistant instruction
- `agent_policy.json` — public behavior-policy data that can be fetched from this repository

The remote policy is data, not executable extension code.

## Storage and privacy boundaries

The extension uses `chrome.storage.local` for local state such as:

- provider credentials and settings;
- assistant/chat history;
- user memory and additional instructions;
- quick replies;
- cached Etsy context and derived summaries;
- UI/configuration state.

The extension does not add application-level encryption around browser-local values. Security therefore depends in part on the browser profile and operating-system account.

Relevant Etsy content can leave the browser when it is included in an AI request. The destination is the selected AI provider or custom endpoint, not a project-owned AI backend.

See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md).

## Network trust boundaries

### Etsy

Content scripts execute only on the Etsy hosts declared in the manifest and read page/context data required by enabled features.

### AI providers

Provider requests are made over HTTPS, except that a user-configured custom endpoint may use HTTP for local loopback addresses. Custom endpoint URLs are validated before use.

Because a custom provider's hostname cannot be known at install time, the extension declares broad **optional** HTTPS host permission. That permission exists for user-selected endpoints and is not equivalent to a content script running on every website.

### GitHub-hosted agent policy

The extension may fetch `src/config/agent_policy.json` from the public repository. The request is for policy text only; Etsy conversation data, provider keys, and local history are not part of the policy fetch.

## Agent hardening

The current branch includes explicit guard layers around AI context and actions. Their purpose is to keep page data, user instructions, inferred context, management actions, and model output within defined trust/scope boundaries.

These guards reduce risk but are not a proof that AI output is always correct or safe. Customer-facing text should still be reviewed before sending.

## Draft-only behavior

Quick replies and generated reply text are designed to populate a draft rather than automatically send a customer message. This keeps the seller in the approval loop.

## Browser builds

### Chromium

`build.bat` copies `src/` to `dist/chrome/`.

### Firefox

`build-firefox-manifest.ps1` reads `src/manifest.json`, removes unsupported Chromium-specific permission(s), converts the background declaration, and adds Firefox-specific settings before packaging.

The old hand-maintained browser-specific manifests were removed to avoid configuration drift.

## Tests

Tests live in `tests/`. Fixtures must be synthetic and must not contain real Etsy customer names, messages, order details, attachments, cookies, or account data.

## Release automation

GitHub Actions workflows can package and publish Chromium builds to browser stores. Store credentials are referenced through GitHub Actions secrets and must never be committed to the repository.

Release workflows should only be triggered intentionally by a maintainer.
