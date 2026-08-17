# Etsy compatibility layer

The extension depends on Etsy's web UI for features that Etsy does not expose through a stable public Messages API. `src/content/etsy_compatibility.js` isolates that risk behind a compatibility layer so a normal Etsy redesign does not have to break every feature at once.

## Goals

1. **Central Etsy adapter** — `window.EtsyAdapter` is the single place for semantic Etsy element discovery used by the compatibility layer.
2. **Conversation fallbacks** — existing intercepted/primary conversation data wins; if it is unavailable, the layer can recover matching embedded `Etsy.Context` data and finally conservative visible-DOM message data. Fallback data is explicitly marked as degraded and never overwrites healthy primary history for the live conversation.
3. **Multi-strategy composer detection** — the reply composer is located through multiple selectors (legacy class, placeholder, ARIA, structural form fallback) instead of one Etsy CSS class.
4. **Remote data-only compatibility config** — selector/layout data can be refreshed from `src/config/etsy_compatibility.json` on the public repository and cached locally. The remote file is validated JSON data only; it is never executed as code. If the repository is private or GitHub is unavailable, the packaged/built-in config remains authoritative.
5. **Compatibility self-test** — `window.EtsyCompatibility.runSelfTest()` checks the live Messages page and stores a local `ETSY_COMPATIBILITY_DIAGNOSTICS` snapshot with health, selected strategies, fallback source, and layout classification.
6. **Layout fingerprinting** — each Messages layout gets a stable fingerprint made from the page kind and adapter strategies. Unknown layouts enter `unknown-layout`/degraded behavior instead of blindly applying invasive layout rewrites.

## Legacy-class bridge

Older feature modules still contain Etsy selectors such as `.wt-textarea`, `.inline-compose-container`, `.detail-view`, and the legacy grid classes. The compatibility layer adds those legacy classes to elements that it has identified semantically, allowing existing quick-reply and enhanced-layout code to keep working after simple Etsy class renames.

Full-page layout normalization is intentionally stricter than composer detection: the layer only exposes the legacy grid/detail contract when both elements were found with high confidence. An unknown redesign should therefore degrade safely instead of rearranging the wrong page elements.

## Remote config behavior

The packaged file is always available in the extension. A remote copy is fetched from the repository with a bounded cache TTL and strict schema validation. Only selector strings, confidence values, and known-layout metadata are accepted. JavaScript, expressions, or executable remote behavior are not supported.

This means a simple Etsy selector change can eventually be fixed by updating the public compatibility JSON without waiting for a browser-store release, while substantive parsing/logic changes still require an extension update.

## Diagnostics and privacy

Compatibility diagnostics stay in browser-local extension storage. They are not uploaded by this layer. The diagnostic record contains compatibility state and selector/layout metadata, not message bodies, attachments, API keys, cookies, or customer content.
