# 📦 Publication Checklist for Chrome Web Store

## ✅ Pre-Publication Steps

### 1. Code Quality
- [ ] Видалено всі `console.log()` для продакшену (або замінено на умовний debug mode)
- [ ] Перевірено, що всі файли в `manifest.json` існують
- [ ] Немає мертвого коду або невикористаних файлів
- [ ] Всі коментарі в коді актуальні

### 2. Manifest.json
- [ ] **version**: Оновлена до фінальної версії (наприклад, `1.0`)
- [ ] **name**: Перевірено назву розширення
- [ ] **description**: Написано коротку зрозумілу англійською (макс. 132 символи)
- [ ] **icons**: Додано іконки всіх розмірів (16x16, 32x32, 48x48, 128x128)
- [ ] **permissions**: Тільки необхідні дозволи
- [ ] **host_permissions**: Тільки Etsy домени

### 3. Security & Privacy
- [ ] Немає захардкоджених API keys в коді
- [ ] `config.secret.json` додано в `.gitignore`
- [ ] API ключі зберігаються тільки в `chrome.storage.local`
- [ ] Написано Privacy Policy (обов'язково для Chrome Web Store)

### 4. Content & Assets
- [ ] **README.md**: Оновлено з актуальною інформацією
- [ ] **Screenshot**: Підготовлено 3-5 скріншотів для Chrome Web Store (1280x800 або 640x400)
- [ ] **Promotional Images**: 
  - Small tile: 440x280
  - Marquee: 1400x560 (опціонально)
- [ ] **Icons**: Високоякісні іконки PNG з прозорим фоном

### 5. Functionality Testing
- [ ] Розширення завантажується без помилок
- [ ] Чат відкривається і закривається
- [ ] AI відповідає на запити з усіма провайдерами (Gemini, DeepSeek, Grok)
- [ ] Історія чатів зберігається та завантажується
- [ ] Завантаження зображень працює коректно
- [ ] Settings зберігає API ключі
- [ ] Працює на різних сторінках Etsy
- [ ] Немає помилок в консолі Chrome

### 6. Build & Package
- [ ] Видалено всі розробницькі файли:
  - ✅ `ChromeExtensionEtsyAI.zip` (старий архів)
  - ✅ `modal_styles.css` (невикористовуваний файл)
  - [ ] `ARCHITECTURE.md` (залишити в git, але не в .zip)
  - [ ] `.git/` folder
  - [ ] `.gitignore`
- [ ] Створено чистий ZIP архів з тільки необхідними файлами

### 7. Documentation for Users
- [ ] Написано чіткі інструкції по налаштуванню API ключів
- [ ] Підготовлено FAQ
- [ ] Описано підтримувані моделі AI
- [ ] Написано Privacy Policy (приклад нижче)

---

## 📝 Required Files for Chrome Web Store

### Files to Include in ZIP:
```
ChromeExtensionEtsyAI/
├── manifest.json
├── README.md (опціонально)
├── background/
│   └── service_worker.js
├── config/
│   └── base_instruction.js
├── content/
│   ├── *.js (всі файли)
│   ├── *.css (всі файли)
│   ├── ui.html
│   └── providers/
│       └── *.js (всі провайдери)
├── libs/
│   ├── Readability.min.js
│   └── turndown.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
└── icons/ (створити!)
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Files to EXCLUDE from ZIP:
- `.git/`
- `.gitignore`
- `ARCHITECTURE.md`
- `PUBLICATION_CHECKLIST.md`
- `*.zip` (старі архіви)
- `node_modules/` (якщо є)
- `.vscode/`, `.idea/`

---

## 🎨 Icon Requirements

**ВАЖЛИВО**: Поки що в проєкті немає іконок! Потрібно створити:

1. **Іконка розширення** (для Chrome Web Store):
   - 16x16, 32x32, 48x48, 128x128 px
   - PNG формат з прозорим фоном
   - Простий, зрозумілий дизайн

2. **Додати в manifest.json**:
```json
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

---

## 📄 Privacy Policy Template

Створити файл `PRIVACY_POLICY.md`:

```markdown
# Privacy Policy for Etsy AI Assistant

Last updated: [DATE]

## Data Collection
This extension does NOT collect, store, or transmit any personal data to external servers.

## API Keys
- API keys are stored locally in your browser using Chrome's storage API
- Keys are never transmitted to any server except the AI provider you choose (Google Gemini, DeepSeek, or Grok)

## Page Content
- The extension only reads Etsy page content when you explicitly interact with the chat
- Page content is sent directly to your chosen AI provider
- No data is stored on our servers (we don't have any servers)

## Third-Party Services
This extension uses AI services from:
- Google Gemini API
- DeepSeek API
- Grok API

Each service has its own privacy policy. Please review:
- [Google Gemini Privacy](https://policies.google.com/privacy)
- [DeepSeek Privacy](https://deepseek.com/privacy)
- [Grok Privacy](https://x.ai/legal/privacy-policy)

## Contact
For privacy concerns, contact: [YOUR EMAIL]
```

---

## 🚀 Publication Steps

1. **Create Clean Build**:
   ```powershell
   # В корені проєкту
   # Створіть папку для білду
   mkdir release
   
   # Скопіюйте всі необхідні файли (без .git, ARCHITECTURE.md, etc.)
   # Потім запакуйте в ZIP
   Compress-Archive -Path manifest.json,background,config,content,libs,options,icons -DestinationPath release/etsy-ai-assistant-v1.0.zip
   ```

2. **Go to Chrome Web Store Developer Dashboard**:
   - https://chrome.google.com/webstore/devconsole
   - Потрібно заплатити $5 (одноразово) для реєстрації

3. **Upload Extension**:
   - Натисніть "New Item"
   - Завантажте ZIP архів
   - Заповніть всі поля

4. **Store Listing**:
   - **Name**: Etsy AI Assistant
   - **Summary**: AI-powered assistant for Etsy shop owners (132 chars max)
   - **Description**: Детальний опис можливостей
   - **Category**: Shopping / Productivity
   - **Language**: English (потім можна додати Ukrainian)

5. **Privacy**:
   - Вказати URL до Privacy Policy (можна на GitHub)
   - Відповісти на питання про дозволи

6. **Submit for Review**:
   - Процес займає ~1-3 дні
   - Можуть попросити додаткову інформацію

---

## ⚠️ Common Rejection Reasons

1. **Missing Privacy Policy** → Створіть PRIVACY_POLICY.md
2. **Too Many Permissions** → Використовуйте тільки необхідні
3. **Poor Description** → Напишіть детальний англійською
4. **Missing Icons** → Додайте всі 4 розміри
5. **Broken Functionality** → Протестуйте перед публікацією

---

## 📊 Post-Publication

- [ ] Додати значок Chrome Web Store в README
- [ ] Моніторити відгуки користувачів
- [ ] Готувати оновлення за потреби
- [ ] Відповідати на питання користувачів
