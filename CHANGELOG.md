# Changelog

All notable source-level changes to SellerPilot for Etsy are documented here.

Store publication can lag behind the repository, so a version listed here does not by itself guarantee that the same build is already available in a browser store.

## Unreleased

### Repository

- Rebranded the public project presentation as **SellerPilot for Etsy** while keeping the current extension package identity unchanged.
- Added public-facing security, privacy, contribution, build, architecture, and third-party licensing documentation.
- Added structured GitHub bug-report and feature-request forms.
- Added a pull-request template with privacy, security, and release-safety checks.

## 1.6.30 — current source

### Permission cleanup

- Removed the unused `scripting` permission; Etsy page integration is already provided by declared content scripts and host permissions, and the source contains no `chrome.scripting`, `executeScript`, or dynamic CSS-injection calls.
- Removed the unused `activeTab` permission; Etsy access is already declared explicitly and tab management uses the separate `tabs` permission.
- Added regression assertions so these unnecessary permissions are not accidentally reintroduced.

## 1.6.29

### Gemini streaming reliability

- Preserve the beginning of AI replies when Gemini emits visible answer text in a later part of a multi-part streaming candidate.
- Ignore `thought: true` streaming parts so hidden model reasoning is never mixed into the customer-facing answer.
- Accept SSE `data:` frames with or without a following space and flush the final buffered event when a stream closes without a trailing newline.

## 1.6.28

### Etsy Messages reliability

- Reload open Etsy tabs automatically after an extension runtime update so already-open pages do not keep invalidated content scripts until a manual refresh.
- Prevent SellerPilot's own floating chat UI from being parsed back into Etsy page context.
- Migrate legacy conversation history into scoped storage and include an unseen live DOM tail when structured history lags behind the visible Etsy thread.
- Keep the live tab URL authoritative when restoring or receiving the legacy global `current_context`, so another open Etsy tab cannot switch the assistant to the wrong conversation or page context.
- Make shop-intelligence reads prefer live-tab page data plus scoped conversation/listing state instead of cross-tab legacy mirrors.
- Harden assistant message-bubble sizing against host-page CSS collisions that could stretch a short user message over the full chat height.
- Point the remote compatibility configuration at the canonical `sellerpilot-for-etsy` repository.

## 1.6.27

### Reliability and compatibility

- Consolidated the final 1.6.26 agent-hardening audit into the canonical `main` branch.
- Added per-conversation scoped storage for safer multi-tab Etsy Messages usage.
- Added scoped context bridging, AI-call budget controls, image-request gating, and stronger stale-operation protection.
- Improved image-intelligence batching, persistence, attachment normalization, and conversation isolation.
- Added a resilient Etsy UI compatibility layer with selector fallbacks, layout diagnostics, and safe degraded behavior when Etsy changes its Messages UI.
- Preserved both compatibility-layer and agent-hardening manifest wiring in the unified release build.

### Release maintenance

- Removed stale hardening, compatibility, release, and preparation branches after consolidation.
- Bumped the browser package version to 1.6.27 for the post-consolidation Edge release.

## 1.6.26

### Reliability and context safety

- Hardened conversation and page-scope isolation.
- Added guards for agent output, auxiliary prompts, management actions, and vision metadata.
- Improved Etsy context ingestion and ordering behavior for SPA navigation and asynchronous responses.
- Added broader automated coverage for context, policy, scope, image, and management boundaries.

### AI and seller workflows

- Context-aware AI assistance across supported Etsy pages and conversations.
- Local memory and reusable quick-reply workflows.
- Customer-image analysis with cache and failure handling.
- Gemini streaming/fallback support plus optional additional/custom provider paths.

### Browser support

- Chromium source package from `src/`.
- Firefox manifest/build generation from the same source tree.

For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
