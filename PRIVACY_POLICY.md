# Privacy Policy — Etsy AI Assistant

**Last updated:** August 17, 2026

Etsy AI Assistant is a browser extension that adds AI-assisted workflows to Etsy pages. This document describes the behavior of the open-source version in this repository.

## Developer data collection

The extension does not require a developer-operated backend for its AI features. The current source does not include developer analytics or advertising trackers, and it does not intentionally send Etsy account or customer content to a server controlled by the extension developer.

## Data stored in the browser

Depending on the features you use, the extension may store:

- AI provider API keys and provider settings
- Custom provider URL and model selection
- Chat history and conversation state
- Agent memory and additional AI instructions
- Quick replies and UI preferences
- Cached Etsy page, listing, and conversation context
- Derived AI summaries and diagnostic metadata
- Per-image technical/visual analysis generated for Etsy conversation attachments

Image-intelligence results are stored as derived text/JSON records keyed to the relevant conversation image. Successful derived analyses do not use an automatic time-to-live and may remain in local extension storage until extension data is cleared or the extension is uninstalled. Raw image bytes are **not** stored in the persistent image-intelligence cache.

These values are stored locally in the browser profile using extension storage APIs. The extension does **not** implement an additional encryption layer for API keys or other stored values. Anyone with sufficient access to your browser profile or device may therefore be able to access local extension data.

## Data sent to AI providers

Depending on the action and configuration, an AI request may include:

- Your prompt or instruction
- Etsy page title, URL, and extracted page text
- Listing information
- Etsy conversation text and relevant message context
- Image attachments from the active Etsy conversation, including customer- or seller/Owner-side images when present, for image-aware workflows
- Image-derived technical/visual context from previously analyzed attachments
- Saved agent memory, quick-reply context, and additional instructions when relevant
- Previous assistant conversation context

For image intelligence, raw image bytes are sent to the configured Gemini image-analysis path when a new attachment requires analysis. Multiple new images from the same active conversation may be sent together in one multimodal request. The resulting derived analysis is cached locally so the same scoped image normally does not need to be sent for repeated analysis.

The request is sent to the provider used for that operation. The extension supports Google Gemini as its default provider and contains optional integrations/fallback paths such as DeepSeek, xAI/Grok, OpenRouter, and a user-configured OpenAI-compatible endpoint.

If you configure a custom endpoint, relevant request data is sent to that endpoint. Review and trust that service before enabling it.

Each third-party AI provider processes data under its own terms and privacy policy. This project does not control a provider's retention, training, logging, or regional processing practices.

## Remote behavior policy

The extension may fetch the public agent behavior policy from this GitHub repository so behavior rules can be updated as data. That fetch retrieves policy text from GitHub; it is not intended to upload Etsy content, chat history, API keys, or customer data to GitHub.

## Etsy access

The extension runs on Etsy pages so it can provide page-aware assistance. It may read content that is visible or available to the signed-in Etsy session as required by enabled features.

The extension can also request optional network access for a custom AI provider. Because the custom hostname is selected by the user at runtime, the manifest includes broad optional HTTPS host permission. The extension requests the relevant host permission when a custom provider is configured; this is separate from normal Etsy host access.

## Downloads

If you use image-download functionality, the extension uses the browser downloads API to save the requested file to your device. The developer does not receive the downloaded file through a project backend.

## User control and deletion

You can reduce or remove locally stored data by:

- removing provider API keys in Settings;
- clearing saved chat history, memory, or quick replies where controls are provided;
- clearing the extension's browser storage; or
- uninstalling the extension.

Clearing extension browser storage also removes persistent derived image-analysis records. Uninstall behavior and browser-profile cleanup are ultimately controlled by the browser.

## Security recommendations

- Use provider keys with the least privilege available.
- Do not reuse unrelated credentials as AI provider keys.
- Protect your browser profile and operating-system account.
- Do not enable a custom provider endpoint you do not trust.
- Revoke a provider key immediately if you believe it has been exposed.

For security reporting guidance, see [SECURITY.md](./SECURITY.md).

## Children's privacy

This extension is intended for Etsy seller/business workflows and is not designed for children.

## Changes

This policy may be updated when extension behavior, providers, permissions, or storage practices change. The date at the top identifies the latest policy revision in the repository.

## Contact

For normal questions, use the repository's GitHub Issues page. Do not post API keys, customer data, order details, private screenshots, or other sensitive information in a public issue.

## Disclaimer

This project is not affiliated with Etsy. This document describes project behavior and is not legal advice.
