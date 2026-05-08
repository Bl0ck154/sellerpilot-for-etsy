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
