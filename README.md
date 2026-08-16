# Etsy AI Assistant

A Manifest V3 browser extension that adds a context-aware AI assistant to Etsy pages and seller workflows.

**Current source version:** `1.6.26`

## Features

- Floating AI chat on Etsy pages
- Etsy page, listing, and conversation context for more relevant answers
- Streaming Google Gemini responses with model fallback
- Optional custom OpenAI-compatible provider
- Optional DeepSeek, Grok, and OpenRouter credentials for supported fallback paths
- Reusable quick replies that are inserted as drafts and are not auto-sent
- AI-managed quick-reply templates
- Local agent memory and additional shop-specific instructions
- Customer-image analysis for supported reply workflows
- Per-conversation context isolation and local chat history
- Chromium and Firefox builds from one source tree

## Privacy at a glance

This project does not include API keys or account credentials.

API credentials, chat history, memories, quick replies, preferences, and cached Etsy context are stored in the browser extension's local storage. The extension does **not** add its own encryption layer around those values.

When an AI feature needs Etsy context, relevant page, listing, conversation, or image data may be sent directly to the AI provider selected by the user. A custom provider sends data to the endpoint configured by the user. The project does not require a developer-operated backend for AI requests.

See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) for details.

## Requirements

- Chromium-based browser with Manifest V3 support, or Firefox 109+
- An API key for the AI provider you want to use
- Windows if you want to use the included `build.bat` cross-browser build script

## Install from source

### Chromium (Chrome / Edge)

```bash
git clone https://github.com/Bl0ck154/ChromeExtensionEtsyAI.git
cd ChromeExtensionEtsyAI
```

Then:

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `src` directory.
5. Open the extension settings and add your own provider credentials.

### Firefox development build

Run:

```cmd
build.bat
```

Then load `dist/firefox/manifest.json` from `about:debugging#/runtime/this-firefox`, or use the generated XPI for your normal signing/release workflow.

## Build

`src/manifest.json` is the manifest source of truth.

```cmd
build.bat
```

The build script creates:

- `dist/chrome/` — Chromium package contents
- `dist/firefox/` — Firefox-compatible package contents
- `dist/etsy-ai-assistant-firefox-<version>.xpi` — packaged Firefox build

The legacy `manifests/` directory is intentionally not used.

More details: [BUILD_INSTRUCTIONS.md](./BUILD_INSTRUCTIONS.md).

## Project layout

```text
src/
  background/   service worker and privileged browser operations
  config/       assistant behavior policy and base instruction
  content/      Etsy integration, context, AI providers, UI, guards
  libs/         vendored browser-side libraries
  offscreen/    Chromium offscreen parsing support
  options/      settings UI

tests/          unit/integration tests and synthetic fixtures
.github/        store release workflows
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the current data flow and trust boundaries.

## Security

- Never commit API keys, store credentials, cookies, browser profiles, Etsy exports, or real customer conversation fixtures.
- Use synthetic data in tests.
- Release credentials belong in GitHub Actions secrets, not repository files.
- A custom provider requires optional host access because its hostname is chosen by the user at runtime.

Please read [SECURITY.md](./SECURITY.md) before reporting a security issue.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Etsy. Etsy pages and APIs can change, which may break integration behavior.

## License

MIT — see [LICENSE](./LICENSE).
