# Changelog

All notable source-level changes to SellerPilot for Etsy are documented here.

Store publication can lag behind the repository, so a version listed here does not by itself guarantee that the same build is already available in a browser store.

## Unreleased

### Repository

- Rebranded the public project presentation as **SellerPilot for Etsy** while keeping the current extension package identity unchanged.
- Added public-facing security, privacy, contribution, build, architecture, and third-party licensing documentation.
- Added structured GitHub bug-report and feature-request forms.
- Added a pull-request template with privacy, security, and release-safety checks.

## 1.6.26 — current source

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
