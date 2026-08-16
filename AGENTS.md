# Agent Instructions

Guidance for AI coding agents and automated contributors working in this repository.

## Repository rules

1. Treat `src/manifest.json` as the manifest source of truth.
2. Edit source files under `src/`; do not edit generated `dist/` output.
3. Keep Chromium and Firefox behavior compatible unless a change is explicitly browser-specific.
4. Keep customer-facing message insertion draft-only unless a maintainer explicitly changes that product rule.
5. Preserve the extension's trust-boundary and agent-guard layers when modifying context or AI flows.

## Privacy and secrets

Never commit or add to fixtures:

- API keys, tokens, client secrets, refresh tokens, cookies, or session data;
- browser profiles or exported extension storage;
- real Etsy customer names, messages, order details, addresses, attachments, or screenshots;
- local database files, HAR captures, logs containing customer content, or production diagnostics containing private data;
- browser-store credentials.

Use clearly synthetic data in tests and examples.

Provider and store credentials belong in the user's browser-local settings or GitHub Actions secrets, depending on their purpose.

## AI/provider changes

When adding or changing an AI provider:

- document what data can be sent to it;
- avoid hardcoding credentials;
- validate custom network destinations;
- keep timeouts and abort handling bounded;
- do not silently send the same customer context to an additional provider unless the configured fallback behavior allows it;
- update `PRIVACY_POLICY.md` when data handling changes materially.

## Testing

For behavior changes:

- run the relevant tests under `tests/`;
- use synthetic fixtures only;
- validate JavaScript syntax and JSON;
- rebuild when changing manifests or browser-specific behavior.

## Releases

Do not trigger Chrome Web Store or Microsoft Edge Add-ons publication merely to test a code change. Run a store-release workflow only when the maintainer explicitly asks for a release/publication action.

Store credentials must remain GitHub Actions secrets and must never be printed into documentation, issues, logs, or commits.

## Documentation

Keep public documentation focused on current behavior. Do not add private work logs, personal reminders, credential-expiry reminders, internal order/customer notes, or temporary debugging transcripts to the repository.
