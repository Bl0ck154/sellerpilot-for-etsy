# Lessons Learned — Etsy AI Chrome Extension

Кожен запис: **дата | коротке ім'я**. Формат: що сталося → чому → як робити надалі.

## 2026-04-19 — "Loading..." у хедері чату залипав назавжди

**Мистейк.** У `src/content/ui.html:6` було hardcoded `<span id="page-title">Loading...</span>`. Цей текст мав замінитися в `updateContext()` (chat_ui.js), яка тригериться з `chrome.storage.onChanged` або з initial read `current_context`. Якщо `content.js` ще не встиг розпарсити сторінку і зберегти контекст, то storage порожнє → `updateContext` не фаєриться → "Loading..." лишається назавжди.

**Фікс.** В IIFE `initChat` (перед усіма awaits) виставляти fallback `ELEMENTS.pageTitle.textContent = document.title` одразу. Коли справжній контекст прийде — `updateContext` перепише його на розпарсений title. Також прибрав hardcoded "Loading..." з HTML, бо він усе одно миттєво перезатирається.

**Lesson.** Hardcoded placeholders у HTML — це борг: їхнє зникнення залежить від щасливого шляху JS. Якщо є шанс, що async ніколи не дійде — ставити sync fallback до першого await.

---

## 2026-04-19 — Приховування DOM-елемента, який читається JS

**Мистейк-пастка (не допустив).** Була спокуса просто видалити `<select id="model-select">` з `ui.html`, коли ховали селектор моделей. Але `chat_ui.js` в ~20 місцях читає `ELEMENTS.modelSelect.value`, `selectedOption.dataset.provider`, `populateModelDropdown` тощо. Видалення → `null.value` → рантайм-крашнуло б UI при відкритті чату.

**Рішення.** Лишити `<select>` у DOM з `style="display:none" aria-hidden="true" tabindex="-1"`. `populateModelDropdown` заповнює одним option (Gemini), JS продовжує читати `.value` і `dataset.provider` без змін.

**Lesson.** Перш ніж видаляти елемент з DOM — grep по id на всі його використання в JS. "Приховати" ≠ "видалити", коли логіка тримається на елементі.

---

## 2026-04-19 — Fallback моделей не можна робити після того, як стрім почався

**Мистейк-пастка.** Перша ідея для Gemini fallback: якщо під час стрімінгу падає модель — переключитися на наступну. Але UI вже показав частину відповіді (`onChunk` стріляв). Якщо тихо перезапустити — користувач побачить стрибок тексту/дубль/обрізаний початок.

**Фікс.** Додав прапорець `chunkDelivered`. Fallback дозволений ТІЛЬКИ якщо жодного чанку ще не віддано в UI (тобто HTTP-запит впав до початку стрімінгу: 4xx/5xx на fetch, DNS-fail тощо). Якщо стрім уже почався — помилка прокидається назовні як є, показуємо retry-кнопку.

**Lesson.** Silent retry/fallback допустимий лише поки ти ще не проявив проміжний стейт користувачу. Як тільки щось відображено — це контракт, ламати не можна.

---

## 2026-04-19 — Auth-помилки не варто фолбекати на іншу модель

**Мистейк-пастка.** Перший варіант `streamMessage` фолбекав на наступну модель при будь-якій помилці. Але 400/401/403 означають: ключ поганий / запит зламаний / доступу до моделі нема. Жодна інша модель Gemini цього не вилікує — тільки марно спалимо 4 запити і покажемо помилку повільніше.

**Фікс.** Хелпер `_shouldFallback(error)` повертає `false` для status 400/401/403 → миттєво кидаємо помилку користувачу.

**Lesson.** Fallback-політика має враховувати тип помилки. 5xx/429 → retry/fallback (тимчасові проблеми на їхньому боці). 4xx auth → throw (проблема не в моделі).

---

## 2026-05-08 — Gemini/SSE без таймауту залишає чат у нескінченному loader

**Мистейк.** `gemini_service.js` робив `fetch(...:streamGenerateContent?alt=sse)` і `reader.read()` без `AbortController`. Якщо Google API або SSE-з'єднання зависало без HTTP-помилки, UI показував loading dots скільки завгодно довго, а користувач бачив "думає і не відповідає".

**Фікс.** Додати bounded timeout на Gemini streaming request, кидати зрозумілу помилку після ліміту, не вважати порожній SSE успіхом. Не видаляти актуальні Gemini-моделі 2026 (`gemini-3.1-flash-lite-preview`, `gemini-3-flash-preview`) з fallback-chain без прямого запиту власника проєкту.

**Lesson.** Будь-який зовнішній network/streaming виклик у content script має мати явний таймаут і failure path, який прибирає loader та повертає керовану помилку користувачу.

---

## 2026-05-08 — Не видаляти актуальні Gemini-моделі 2026

**Мистейк.** Я видалив `gemini-3.1-flash-lite-preview` і `gemini-3-flash-preview` з fallback-chain, намагаючись зменшити latency, хоча користувач цього не просив. Це змінило продуктову політику моделей і прибрало актуальні на 2026 рік моделі.

**Фікс.** Відновити повний chain: `gemini-flash-latest` → `gemini-3.1-flash-lite-preview` → `gemini-3-flash-preview` → `gemini-2.5-flash`.

**Lesson.** Ніколи не видаляти, не даунгрейдити й не приховувати актуальні Gemini-моделі 2026 у цьому проєкті без прямої явної команди користувача. Для latency-фіксів використовувати таймаути, помилки, telemetry або smarter fallback, але не прибирати моделі.

---

## 2026-05-19 — Retry loop після chunk не має падати у fallback

**Мистейк.** У `gemini_service.js` fallback був заборонений після першого stream chunk на основному catch path, але в overloaded retry branch `break` виходив тільки з inner retry loop. Після цього код доходив до next-model fallback і UI міг замінити вже показану partial відповідь іншим текстом.

**Фікс.** Після retry loop додати явний `if (chunkDelivered) break;` перед next-model fallback. Якщо користувач уже побачив chunk, silent retry/fallback більше не можна робити.

**Lesson.** Правило “fallback тільки до першого UI chunk” має перевірятися на кожному nested retry/fallback exit path, не лише на головному catch path.

---

## 2026-05-19 — Hidden flex item змістив кнопки вводу

**Мистейк.** `.etsy-ai-input-controls` мав `justify-content: space-between`, коли model select був прихований через `display:none`. Залишився один visible flex item `.etsy-ai-action-buttons`, тому браузер поставив його зліва.

**Фікс.** Для controls використовувати `justify-content: flex-end`, а для `.etsy-ai-action-buttons` додати `margin-left:auto`.

**Lesson.** Коли flex layout залежить від hidden controls, не покладатися на `space-between`; явний `margin-left:auto` для action group стабільніший.
