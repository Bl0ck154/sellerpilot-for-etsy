# Etsy Messages Workspace userscript

This directory contains a standalone Tampermonkey userscript extracted from SellerPilot's Etsy Messages UX layer.

It is for sellers who want the **layout and workflow improvements without the AI assistant or browser extension**.

## Features

- full-height Etsy Messages workspace that reclaims the large unused footer/blank area;
- wider conversation area that uses the remaining screen space;
- resizable left inbox panel and right order-details panel, with widths saved locally;
- auto-expanding reply area;
- per-conversation draft persistence in browser `localStorage`;
- attachment gallery in the order/details column;
- click-to-preview attachment lightbox;
- SPA navigation handling when moving between Etsy conversations;
- conservative fallback behavior: if Etsy's layout can no longer be identified safely, the userscript leaves the page layout alone instead of blindly rearranging it.

## Install with Tampermonkey

1. Install Tampermonkey (or a compatible userscript manager) in your browser.
2. Open the raw `etsy-messages-workspace.user.js` file from this repository.
3. Your userscript manager should offer to install it.
4. Open Etsy Shop Manager → Messages and refresh the page once if needed.

Raw install URL:

```text
https://raw.githubusercontent.com/Bl0ck154/sellerpilot-for-etsy/main/userscripts/etsy-messages-workspace.user.js
```

## Privacy

The userscript has **no AI provider integration and no developer-operated backend**. It does not upload message text, drafts, or attachments.

It stores only its own panel widths, per-conversation drafts, and short sent-message guards in the browser's `localStorage`. Attachment metadata is kept in page memory while the Etsy tab is open. It uses Etsy's own logged-in requests only to recover conversation attachment metadata when available.

## Relationship to SellerPilot

The full SellerPilot browser extension includes this kind of enhanced Messages workflow plus AI assistance, quick replies, context management, image intelligence, provider integrations, and additional safety/compatibility layers.

The userscript is intentionally smaller and independent. Changes to Etsy's website can still require updates to either implementation.
