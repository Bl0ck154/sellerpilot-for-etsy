# Etsy AI Assistant 1.6.26 — agent hardening audit

Status: implementation prepared on `agent-hardening-1.6.26-audit-final`.

Do not treat `agent-hardening-1.6.26-prep` or `agent-hardening-1.6.26-audit-fixes` as the final source of truth. The prep branch showed concurrent/ref drift during the audit. The final audit branch was intentionally created from the previously verified coherent hardening commit and then patched sequentially.

## Runtime invariants

1. Main Etsy conversation context is conversation-scoped, not one extension-global active object.
2. `ETSY_CHAT_HISTORY`, `ETSY_CURRENT_LISTING_ID`, `ETSY_CURRENT_LISTING_SCOPE`, and `ETSY_AI_ACTIVE_CONTEXT_FACTS` are compatibility mirrors only when `ScopedConversationStore` is available.
3. Core agent reads history/listing/facts from `ETSY_AI_CONVO_SCOPE_<convo>_*` keys.
4. Two Etsy message tabs must be able to hold independent customers/listings/receipt facts simultaneously.
5. A slow response from a previous SPA route must never overwrite the live conversation.
6. Vision only consumes images tied to the live conversation scope.
7. Successful image analysis has no TTL and is cached per scoped image. Raw image bytes are not persisted.
8. Up to four new images can share one Gemini multimodal request, subject to raw-payload budget.
9. Vision work is background-first; image-specific Owner questions get only a bounded foreground wait.
10. Ordinary Owner chat must not make memory-management or shop-intelligence model calls before the main answer.
11. Long-thread semantic compression is background-first on Etsy Messages.
12. A stale memory clear/remove confirmation can never be approved by a later unrelated `yes`.

## Main fixes from the re-audit

- Added `scoped_conversation_store.js` for multi-tab active-context isolation.
- Added `agent_scoped_context_bridge.js` so BaseAIService reads scoped history/listing data.
- Updated Etsy ingestion to merge `attachments` + `images`, preserve request ordering, and write scoped context.
- Removed destructive cross-tab cleanup from the normal scoped path.
- Reworked Vision cache into per-image storage entries instead of one ever-growing object.
- Changed persistent image identity to 64-bit FNV-1a and included conversation scope.
- Canonicalized Etsy resized image URLs to reduce duplicate analysis.
- Included Owner/seller images and unique DOM-only image extras while preserving sender uncertainty.
- Added local image transport normalization for unsupported direct Gemini MIME types.
- Preserved failure attempt history/backoff for batch failures.
- Made bounded Vision wait own the enqueue phase and removed a redundant pre-pass.
- Made long-conversation summary commits merge with current storage and strengthened source hashing.
- Added stale memory-confirmation protection.
- Updated privacy documentation for persistent derived image analysis and batched multimodal requests.

## Regression tests added/updated

- `tests/scoped_conversation_store.test.js`
- `tests/agent_scoped_context_bridge.test.js`
- `tests/etsy_context_interceptor_scoped.test.js`
- `tests/image_intelligence_manager.test.js`
- `tests/conversation_context_manager.test.js`
- `tests/agent_management_gate.test.js`
- `tests/agent_ai_budget_guard.test.js`
- `tests/agent_hardening_manifest.test.js`

## Required live-browser checks before merge/release

No GitHub Actions/release should be triggered just to perform this audit. Before merging, load the audit branch as an unpacked extension and test:

- Open customer A and customer B in two Etsy tabs at the same time; alternate between them and send assistant prompts. Each prompt must use only its tab's customer/listing/images.
- Rapid SPA A → B → C navigation in one tab while detail API responses are delayed/out of order.
- Conversations where Etsy exposes images in `images` with `attachments: []`.
- Customer image + Owner preview image + extra DOM-only image in one conversation.
- Five new images arriving together: expected normal batching is 4 + 1 model requests if byte budget allows.
- Large/unsupported-format images and failed Vision requests; verify retry deferral and no UI lock.
- Ask an image-specific question immediately after new images appear; main chat must wait at most the bounded image window.
- Extremely long Etsy thread; main answer should not wait for semantic compression, and later turns should reuse the cached summary.
- `clear memory` → ignore confirmation → do normal work → later say `yes`; old clear operation must not execute.
- Markdown/code/table/link rendering after all guard/load-order changes.

## Remaining integration-risk note

Legacy helper/UI code may still observe compatibility mirror keys. Core agent context, Vision and active snapshot no longer use those mirrors as authority. A live two-tab browser test is still required to catch purely UI-level timing behavior that unit/static tests cannot model.
