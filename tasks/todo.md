# Покращення агентивності Etsy AI Помічника

## Ціль
1. Підтягнути системний промпт — менше переобіцянок, краще слухається, відмовляється від нереальних запитів
2. Додати користувацьку пам'ять у стилі ChatGPT ("запам'ятай" / "забудь")
3. Покращити контекст зі сторінки (агрегація лістингів, свіжість, чіткий page-scope)

## Поточний стан (коротко після дослідження)
- Системний промпт: `src/config/base_instruction.js` (~90 рядків) — визначає агента як "Etsy Shop Operations Partner"
- Вбудовується в кожне повідомлення через `base_ai_service.js` → `buildFullInstruction(context)` → передається як `system` role у 4 провайдерах (deepseek, gemini, grok, openrouter)
- Контекст: `page_parser.js` (Markdown), `etsy_context_interceptor.js` (API розмов), `link_discovery.js` (RAG лістингів з 24h TTL), `listing_editor_tracker.js` (редактор лістингу)
- Storage: `chrome.storage.local` — ключі `ETSY_CHAT_HISTORY`, `ETSY_CURRENT_LISTING_ID`, `RAG_LISTING_*`, `custom_instructions`
- **Memory системи немає** — лише per-conversation атачменти

## План

### Фаза 1 — Промпт (src/config/base_instruction.js)
- [x] Перебудувати структуру: `ROLE` → `HARD LIMITS` → `INPUT HIERARCHY` → `PAGE_SCOPE AWARENESS` → `BEHAVIOR` → `OUTPUT FORMAT` → `MODES` → `EXAMPLES`
- [x] HARD LIMITS: no tools/API, no guarantees, no invented facts, no "sure!" openers, match Owner's sentiment, push back on impossible asks
- [x] Anti-yes-man: явні приклади refuse + alternative для "автоматично опублікуй", "зроби 100 продажів"
- [x] USER_MEMORY як пріоритет #1 у Input Hierarchy
- [x] PAGE_SCOPE awareness розділ з правилами для editor/messages/dashboard/public-listing

### Фаза 2 — Пам'ять
- [x] `src/content/memory_manager.js` — `window.MemoryManager` з API: `detectCommand`, `list`, `add`, `removeById`, `removeByKeyword`, `update`, `clear`, `buildContextSection`
- [x] Storage key `ETSY_AI_USER_MEMORY`, 50 entries max, 500 chars max, LRU drop
- [x] Regex-детектор (UA + RU + EN): "запам'ятай", "запомни", "remember", "note" / "забудь", "forget" / "очисти пам'ять", "clear memory" (16/16 regex-тестів проходять)
- [x] Hook у `chat_ui.js` → `sendMessage`: команди ловляться ДО AI-виклику, показують системне повідомлення в чаті
- [x] Ін'єкція `### USER_MEMORY:` блоку у `buildFullInstruction` у `base_ai_service.js`
- [x] UI у `src/options/options.html` — список пам'яті, додавання, редагування inline (✏️), видалення (🗑️), clear all, живе оновлення через `chrome.storage.onChanged`
- [x] Реєстрація в усіх трьох манiфестах: `src/manifest.json`, `manifests/manifest.chrome.json`, `manifests/manifest.firefox.json`

### Фаза 3 — Контекст
- [x] `getPageScope()` у `base_ai_service.js` — тег `[PAGE_SCOPE: type | details]` для listing-editor / messages / messages-inbox / shop-dashboard / public-listing / other
- [x] `[CONTEXT_AGE: Xm]` на секції `CUSTOMER_CONVERSATION_HISTORY` — LLM бачить наскільки свіжі дані
- [x] `getRAGContext()` тепер агрегує до 5 лістингів: primary (повний опис) + secondary (title + 160 символів) замість одного
- [x] `formatAge(ms)` helper для коротких label (`5s` / `3m` / `2h` / `1d`)
- [x] `scanCurrentChatForListings` тепер повертає ВСІ унікальні лістинги в priority order, а не перший знайдений
- [x] `listing_editor_tracker.js` патчить `history.pushState` / `replaceState` + власна подія `etsy-ai-locationchange` — SPA navigation тепер ловиться

### Фаза 4 — Тести
- [x] Syntax check всіх змінених JS файлів — OK
- [x] JSON валідація всіх 3 манiфестів — OK
- [x] Unit-тести regex детектора — 16/16 passed
- [x] Unit-тести CRUD (add/list/dedupe/removeByKeyword/update/clear + buildContextSection) — passed
- [ ] Ручний тест у браузері: "запам'ятай що я продаю натуральне мило" → перевірити що зберігається і впливає на відповідь у наступній розмові
- [ ] Ручний тест: "забудь про мило" → перевірити видалення
- [ ] Ручний тест: "зроби мені 100 продажів завтра" / "автоматично опублікуй лістинг" → перевірити що чітко відмовляє, пропонує альтернативу
- [ ] Ручний тест: перехід messages → listing-editor → messages → перевірити зміну `[PAGE_SCOPE]` і збереження пам'яті
- [ ] Ручний тест options: відкрити options.html → перевірити UI пам'яті (додати, редагувати, видалити, clear all)

## Важливо для користувачів які раніше зберегли custom instructions
Якщо в Settings → Custom AI Instructions вже збережений СТАРИЙ промпт (з попередньої версії), агент буде його використовувати. Щоб отримати новий — відкрити Settings і натиснути "🔄 Reset to Default".

## Порядок виконання
1 → 2 → 3 → 4. Між фазами — чекпойн з користувачем.

## Ризики / трейдофи
- **Довший промпт**: більше токенів за запит, але краща керованість. Компенсація — коротші приклади, прибрати дублікати.
- **Пам'ять у system prompt**: якщо користувач збере 50 фактів — це кілька KB щораз. Поріг + LRU.
- **Детектор "запам'ятай" regex**: може пропустити перефразування. Якщо треба — потім перевести на LLM-based intent detection (дорожче, але гнучкіше).

---

# Фаза 5 — Gemini-only + невидимий fallback (2026-04-19)

## Ціль
- Прибрати з UI селектор моделей + непотрібних провайдерів (OpenRouter, DeepSeek, Grok).
- Залишити тільки Gemini і переключатися між моделями невидимо, якщо запит не пройшов.
- Виправити залипаючий "Loading..." у хедері вікна асистента.

## Виконано
- [x] `src/content/config.js` — залишено тільки `gemini`, `defaultProvider: "gemini"`. Fallback-chain експортується як `window.ETSY_AI_GEMINI_FALLBACK_CHAIN`:
    1. `gemini-flash-latest` (primary)
    2. `gemini-3.1-flash-lite-preview`
    3. `gemini-3-flash-preview`
    4. `gemini-2.5-flash`
- [x] `src/content/ui.html` — `"Loading..."` замінено на порожній текст; `<select id="model-select">` отримав `display:none`, `aria-hidden="true"`, `tabindex="-1"` (елемент залишився в DOM, щоб решта JS читала `.value` + `selectedOption.dataset.provider`).
- [x] `src/content/chat_ui.js` — на початку IIFE в `initChat` виставляється fallback `ELEMENTS.pageTitle.textContent = document.title` + tooltip з `location.href`, якщо ElementPage пустий. Тепер заголовок не залежить від того, чи `content.js` вже надіслав контекст.
- [x] `src/content/providers/gemini_service.js` — `streamMessage` перероблено:
    - Новий хелпер `_buildFallbackList(modelId)` — якщо `modelId` у ланцюгу, повертає зріз починаючи з нього; інакше ставить `modelId` першим і додає весь ланцюг.
    - `_shouldFallback(error)` пропускає 400/401/403 (проблеми з ключем/запитом — наступна модель не допоможе).
    - Якщо помилка сталася ДО першого чанку — тихо переключаємось на наступну модель. Якщо стрім уже почався — далі не переключаємось (щоб не зіпсувати UI).
    - `_streamMessageInternal` тепер кидає `Error` з `.statusCode = response.status` для чіткої класифікації.
- [x] Syntax check усіх трьох змінених JS-файлів — OK.
- [x] Rebuild: `dist/chrome` та `dist/firefox` збігаються з `src/` (diff clean).

## Міграція для існуючих користувачів
- Якщо у `chrome.storage.local` лежить старий `preferred_model` = `"openrouter/auto"` або `"deepseek-chat"`, `populateModelDropdown` просто не знайде цього option у прихованому `<select>`, потрапить у гілку detection → перезапише на `gemini-flash-latest`. Окремого wipe не потрібно.
- Старий `selected_provider` у storage теж не впливає — `chat_ui.handleChatInteraction` завжди передає `provider` з `dataset.provider` вибраного option (а там тільки `gemini`).

## Ручна перевірка (TODO)
- [ ] Відкрити чат на сторінці Etsy — у хедері має одразу бути `document.title`, а не "Loading...".
- [ ] Надіслати повідомлення — має піти на `gemini-flash-latest`.
- [ ] Заблокувати primary модель (напр. тимчасово змінити id у `config.js` на невалідний) — у консолі має з'явитися `🔄 Gemini fallback: ... → ...` і відповідь прийти з наступної моделі.
- [ ] У DevTools перевірити, що `<select id="model-select">` прихований (`display: none`).

---

# Фаза 6 — Gemini зависає / користувачі бачать нескінченне очікування (2026-05-08)

## План
- [x] Перевірити Gemini streaming path на відсутність таймаутів, надто довгий fallback і UI-cleanup.
- [x] Додати bounded timeout для Gemini `fetch`/SSE, щоб чат швидко повертав помилку замість нескінченного loader.
- [x] Залишити повний актуальний Gemini fallback-chain 2026; latency вирішувати таймаутами, а не видаленням моделей.
- [x] Додати явний `host_permissions` для Gemini API endpoint у manifest.
- [x] Запустити syntax checks і переглянути diff перед висновком.

---

# Фаза 7 — Стабілізація AI-відповідей без видалення моделей (2026-05-08)

## План
- [x] Додати safe fallback для порожнього/ще не готового `CURRENT_CONTEXT`, щоб AI-виклик не падав до Gemini.
- [x] Ввести prompt budget: обрізати page markdown, RAG, Etsy chat history і global chat history до контрольованого розміру.
- [x] Додати total budget для Gemini fallback-chain, не видаляючи актуальні Gemini-моделі 2026.
- [x] Додати lightweight diagnostic log останніх AI-запитів без секретів і без повного prompt.
- [x] Запустити syntax checks і переглянути diff перед висновком.

---

# Фаза 8 — Зрозумілі помилки й наступні стабілізаційні кроки (2026-05-08)

## План
- [x] Класифікувати AI-помилки в UI: timeout, rate limit, auth, request-too-large, empty response, extension reload.
- [x] Додати до error message коротку дію для користувача: retry, wait, check API key, shorten request, reload page.
- [x] Зберігати `errorType` у diagnostics, щоб скарги можна було групувати.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 9 — Не міксувати старий чат з новою Etsy-сторінкою (2026-05-08)

## План
- [x] При зміні URL зберігати попередній чат в history і очищати active `current_chat_messages`.
- [x] Не видаляти історію й не ховати контекст; просто створювати нову active-сесію для нової сторінки.
- [x] Додати видимий divider у UI, щоб користувач бачив зміну контексту.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 10 — Gemini 503 auto-retry з видимим статусом (2026-05-08)

## План
- [x] Для Gemini 503/overloaded робити короткий retry на тій самій моделі перед fallback.
- [x] Показувати користувачу тимчасове повідомлення: Gemini лагає, retry/fallback через N секунд.
- [x] Не видаляти й не змінювати Gemini fallback-chain; retry має працювати поверх існуючого chain.
- [x] Записувати retry/fallback події в diagnostics attempts.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 11 — Доступний експорт diagnostics для підтримки (2026-05-08)

## План
- [x] Додати кнопку в Settings для копіювання останніх `AI_DIAGNOSTICS` без API keys і без prompt text.
- [x] Показувати коротке системне повідомлення після копіювання або якщо diagnostics порожні.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 12 — Прибрати застарілу Gemini title model (2026-05-08)

## План
- [x] Замінити `gemini-2.0-flash-exp` у `generateChatTitle` на актуальний Gemini fallback-chain.
- [x] Додати timeout і fallback для title generation, щоб dead/legacy path не зависав.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 13 — Adaptive Gemini thinking mode (2026-05-08)

## План
- [x] Додати adaptive thinking mode: fast для коротких задач, balanced/deep для великого контексту або важливих запитів.
- [x] Якщо Gemini/API відхиляє `thinkingConfig`, автоматично повторити ту ж модель без thinkingConfig, щоб не ламати відповідь.
- [x] Записувати `thinkingMode` і prompt size у diagnostics attempts.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 14 — Debug mock для Gemini 503 retry/fallback (2026-05-08)

## План
- [x] Додати dev-only storage flag `ETSY_AI_DEBUG_FORCE_GEMINI_503_ONCE`, який симулює один 503 на наступному Gemini stream request.
- [x] Після спрацювання автоматично вимикати flag, щоб не зламати реальних користувачів.
- [x] Записувати mock-подію в diagnostics attempts.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 15 — Diagnostics count і clear у Settings (2026-05-08)

## План
- [x] Показувати кількість записів `AI_DIAGNOSTICS` у Settings.
- [x] Додати кнопку Clear diagnostics.
- [x] Оновлювати count після copy/clear/open settings.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 16 — Smarter Gemini 503 retry policy (2026-05-08)

## План
- [x] Для Gemini 503/overloaded робити до 2 retry на тій самій моделі з backoff 1.5s → 3s.
- [x] Не ретраїти 400/401/403 і не виходити за total request budget.
- [x] Показувати countdown для кожного retry і писати номер retry у diagnostics.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 17 — UI English + precise session scope + version bump (2026-05-08)

## План
- [x] Перекласти user-facing статуси/помилки/пам'ять/history labels на international English.
- [x] Скидати active chat тільки при зміні Etsy scope (інший convo/listing/page mode), не на будь-яку дрібну зміну URL.
- [x] Підняти extension version після стабілізаційних змін.
- [x] Запустити syntax checks, commit і push.

---

# Фаза 18 — Conservative custom-work agent behavior (2026-05-08)

## План
- [x] Посилити `base_instruction.js`: кастомні роботи за замовчуванням тільки review/clarify, без acceptance до явного approval.
- [x] Оновити `Suggest Response` shortcut, щоб дефолтний draft був cautious і не переобіцяв.
- [x] Додати легкий локальний overpromise checker після відповіді: warning + diagnostics без другого AI-запиту.
- [x] Зберегти page-aware поведінку: не різати `PAGE_CONTENT`, `PAGE_SCOPE`, RAG і Etsy chat context; prompt має лишитись компактним.
- [x] Запустити syntax checks і переглянути diff.

---

# Фаза 19 — Verify and push conservative agent changes (2026-05-08)

## План
- [x] Перевірити JS syntax і prompt size після змін.
- [x] Підняти extension version.
- [x] Зробити Chromium build для Chrome/Edge.
- [x] Переглянути git diff/status, щоб у commit потрапили тільки потрібні файли.
- [x] Закомітити й запушити зміни.

---

# Фаза 20 — Remote agent policy + Store release automation (2026-05-08)

## План
- [x] Додати bundled `agent_policy.json` з prompt addendum / forbidden phrases / suggest prompt.
- [x] Додати remote policy loader з TTL, fallback на bundled defaults і без remote JS execution.
- [x] Інтегрувати policy в `base_ai_service.js` і `chat_ui.js` без збільшення page context budgets.
- [x] Додати GitHub Actions workflow skeleton для build zip + Chrome Web Store upload/publish через secrets.
- [x] Запустити syntax/JSON/build перевірки, переглянути diff, commit і push. Додано host permission для remote policy і CI-safe build без pause.

---

# Фаза 21 — Edge Add-ons API release workflow (2026-05-08)

## План
- [x] Додати GitHub Actions workflow для Microsoft Edge Add-ons Update API v1.1.
- [x] Пакувати Chromium build `dist/chrome` для Edge без окремого `dist/edge`.
- [x] Використати Partner Center secrets: Product ID, Client ID, API key.
- [x] Додати manual publish toggle і tag-based publish.
- [x] Перевірити YAML/PowerShell синтаксис, commit і push.

---

# Фаза 22 — Edge release ops docs (2026-05-08)

## План
- [x] Задокументувати, що Edge Add-ons автопублікація доступна через GitHub Actions.
- [x] Зафіксувати назви GitHub secrets без самих секретів.
- [x] Зафіксувати expiry `EDGE_API_KEY`: 2026-07-19 22:55, ключ треба вручну перевипустити в Partner Center.
- [x] Commit і push docs.

---

# Фаза 23 — Remote policy/custom prompt hardening (2026-05-08)

## План
- [x] Посилити remote policy wording: safety policy overrides custom prompts on conflicts.
- [x] Додати diagnostics: `policyVersion` і `customInstructionsActive`.
- [x] Показувати Settings warning, якщо активний локальний custom prompt.
- [x] Перевірити syntax/build/prompt size, commit і push.

---

# Фаза 24 — Async Gemini Shop Intelligence (2026-05-08)

## План
- [x] Додати `shop_intelligence_manager.js`: async bootstrap, cooldown, snapshot hash, no new Etsy API calls.
- [x] Gemini summary з існуючого context/storage: page context, current Etsy chat, current listing cache.
- [x] Інжектити compact `AUTO_SHOP_INTELLIGENCE` у prompt без блокування reply generation.
- [x] Тригерити bootstrap на startup/context/conversation events, але throttled/debounced.
- [x] Додати diagnostics metadata: shop intelligence version/age/sources.
- [x] Перевірити syntax/build/prompt size, commit і push.

---

# Фаза 25 — Release Shop Intelligence to Edge (2026-05-08)

## План
- [x] Підняти extension version до `1.6.4` для Shop Intelligence release.
- [x] Перевірити syntax/JSON/build і built manifests.
- [x] Commit і push version bump.
- [ ] Запустити Edge Add-ons workflow з `publish=true`.

---

# Фаза 26 — Customer image intelligence + version label (2026-05-09)

## План
- [x] Дослідити існуючу логіку attachments/download buttons і структуру Etsy chat messages.
- [x] Додати image intelligence manager: тільки customer-side image attachments, Gemini Vision summary, cache, no raw image storage.
- [x] Інтегрувати on-demand image analysis перед `Suggest Response` зі status message і prompt section.
- [x] Додати diagnostics image metadata.
- [x] Додати малий version label у header агента.
- [x] Оновити privacy note щодо image attachments.
- [x] Перевірити syntax/build/prompt budget, commit і push.

---

# Фаза 27 — Release image intelligence to Edge (2026-05-09)

## План
- [x] Підняти extension version до `1.6.5` для image intelligence release.
- [x] Перевірити syntax/build і built manifests.
- [x] Commit і push version bump.
- [ ] Запустити Edge Add-ons workflow з `publish=true`.

---

# Фаза 28 — Fix Etsy compose draft restore (2026-05-09)

## План
- [x] Заблокувати повторне збереження щойно відправленого тексту як draft після Send/Enter.
- [x] Видаляти draft і suppress input saves на коротке вікно після відправки, поки Etsy очищає textarea.
- [x] Перевірити syntax/build, commit і push.

---

# Фаза 29 — Exact sent-text draft guard (2026-05-09)

## План
- [x] Замінити грубий time suppress на exact sent text guard.
- [x] Не зберігати draft тільки коли textarea дорівнює щойно відправленому тексту.
- [x] Дозволити новий draft одразу після send, якщо текст відрізняється.
- [x] Перевірити syntax/build, commit і push.

---

# Фаза 30 — Hide internal retry/page-scope artifacts (2026-05-09)

## План
- [x] Прибрати user-facing Gemini retry/fallback countdown текст із chat loader.
- [x] Санітизувати AI output від internal `[PAGE_SCOPE: ...]` tags перед display/save/diagnostics.
- [x] Посилити prompt output rule: ніколи не виводити internal context tags.
- [x] Перевірити syntax/build, commit і push.

---

# Фаза 30 — Hide setup/status messages when real chat starts (2026-05-19)

## План
- [x] Дослідити, як `chat_ui.js` рендерить і зберігає `system` повідомлення.
- [x] Додати мінімальну очистку технічних setup/status повідомлень при першому реальному `user` повідомленні.
- [x] Перевірити syntax/build і built manifests.

---

# Фаза 31 — Fix streaming replacement and send button layout (2026-05-19)

## План
- [x] Знайти, чому partial Gemini stream може замінюватися іншим fallback/retry текстом.
- [x] Зробити fallback/retry неможливим після першого UI chunk.
- [x] Розширити sanitizer для inline/trailing internal tags, включно з тегами перед timestamp.
- [x] Знайти CSS причину зміщення Etsy send button вліво і зафіксувати справа.
- [x] Оновити lessons після correction.
- [x] Перевірити syntax/build, diff, commit і push.

---

# Фаза 32 — Improve user timestamp contrast (2026-05-19)

## План
- [x] Зробити timestamp у user bubble контрастним на помаранчевому фоні.
- [x] Перевірити CSS diff/build, commit і push.

---

# Фаза 33 — Release 1.6.6 to Edge (2026-05-19)

## План
- [x] Підняти source manifest/build version до `1.6.6`.
- [x] Перебілдити Chrome/Firefox artifacts з версією `1.6.6`.
- [x] Закомітити і запушити version bump.
- [x] Запустити Edge Add-ons release workflow і перевірити результат.

---

# Фаза 34 — Fix chat list formatting (2026-05-20)

## План
- [x] Прибрати зайві `<br>` між `<li>` у markdown-rendered списках.
- [x] Нормалізувати spacing списків у AI bubble CSS.
- [x] Перевірити syntax/build, commit і push.

---

# Фаза 35 — Smart chat actions and Etsy reply behavior (2026-05-20)

## План
- [x] Замінити magic shortcut на `Actions` dropdown з seller workflows.
- [x] Додати action prompts: suggest reply, rewrite shorter/warmer/firmer, translate, summarize, risk check.
- [x] Посилити agent rules для customer language, greeting compliance і Etsy reply drafts.
- [x] Перевірити primary Gemini model = `gemini-flash-latest`.
- [x] Перевірити syntax/build, commit і push.

---

# Фаза 36 — Release 1.6.7 Gemini model chain (2026-05-20)

## План
- [x] Змінити fallback chain на `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`.
- [x] Прибрати runtime preview model ids з fallback config.
- [x] Підняти версію до `1.6.7`.
- [x] Перевірити syntax/build і manifest artifacts.
- [x] Закомітити, запушити і запустити Edge release workflow.

---

# Фаза 37 — Fix Etsy sent reply draft resurrection (2026-06-01)

## План
- [x] Знайти точку, де Etsy reply textarea зберігає draft і чому sent text може записатися назад.
- [x] Зробити send cleanup надійним для click, Enter і submit, навіть якщо Etsy міняє DOM/label кнопки.
- [x] Заборонити повторне збереження exact sent text під час post-send React/input race, доки поле не очиститься або юзер не введе інший текст.
- [x] Перевірити синтаксис, diff і за потреби build artifacts.

---

# Фаза 38 — Agent Edge release instructions (2026-06-01)

## План
- [x] Перевірити, чи є project-level agent instructions для Edge releases.
- [x] Додати `AGENTS.md` з Edge release runbook для майбутніх агентів.
- [x] Перевірити diff, commit і push.

---

# Фаза 39 — Release 1.6.8 draft cleanup fix to Edge (2026-06-01)

## План
- [x] Підняти source manifest/build version до `1.6.8`.
- [x] Перебілдити Chrome/Firefox artifacts з версією `1.6.8`.
- [x] Закомітити і запушити draft cleanup fix + version bump: `c339a5d`.
- [x] Запустити Edge Add-ons release workflow з publish=true: run `26745792657`.
- [ ] Edge publish result: package uploaded, publish failed with `InProgressSubmission` (`Can't publish extension as your extension submission is in progress. Please try again later.`). Wait/check Partner Center before retrying.
- [x] Оновити release tracking після workflow, закомітити і запушити.

---

# Фаза 40 — Fix remaining draft resurrection and code-copy truncation (2026-06-01)

## План
- [x] Знайти всі шляхи збереження й відновлення Etsy draft.
- [x] Знайти причину обрізання copy на подвійних лапках.
- [x] Додати confirmed-send reconciliation по `ETSY_CHAT_HISTORY`.
- [x] Прибрати `data-code` з HTML-кнопок копіювання і читати текст з DOM.
- [ ] Перевірити build/syntax і зібрати релізну версію.

---

# Фаза 41 — Ensure active listing context hydrates for messages pages (2026-06-09)

## План
- [x] Додати більш надійний extractor для `ETSY_CURRENT_LISTING_ID` з detail-view payload.
- [x] Автоматично запускати link discovery при зміні storage і SPA navigation.
- [x] Додати short wait/fallback у `getRAGContext()` для гонки між detail parse і cache hydration.
- [x] Перевірити syntax check і rebuild artifacts.
- [ ] Ручний браузерний тест на `/messages/<id>`: переконатися, що `PRODUCT_CONTEXT` містить активний listing без focus/input.

---

# Фаза 42 — Add Stop button and hide confusing quick actions (2026-06-09)

## План
- [x] Повернути Gemini total request budget до 60 секунд.
- [x] Додати Stop кнопку, яка зупиняє активний `AbortController` і скасовує streaming request.
- [x] Сховати кнопки Reply та ⚡ без видалення залежної логіки.
- [x] Виправити втрату введеного тексту при натисканні цих елементів.
- [x] Зробити tooltip адаптивними, щоб вони не виходили за межі екрана.
- [ ] Ручно перевірити Stop/Retry/tooltip поведінку в браузері.
