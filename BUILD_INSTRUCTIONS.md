# Build Instructions

## 📦 Cross-Browser Extension Build

Цей проєкт підтримує **Chrome** та **Firefox** з одної кодової бази.

### Структура проєкту

```
ChromeExtensionEtsyAI/
├── src/                    # Вихідний код (тут ви працюєте)
│   ├── background/
│   ├── content/
│   ├── common/            # Спільні утиліти
│   ├── config/
│   ├── libs/
│   ├── offscreen/
│   └── options/
├── manifests/              # Маніфести для різних браузерів
│   ├── manifest.chrome.json
│   └── manifest.firefox.json
├── dist/                   # Згенеровані збірки (автоматично)
│   ├── chrome/
│   └── firefox/
└── build.bat               # Скрипт збірки
```

---

## 🔨 Як зібрати розширення

### Крок 1: Запустіть build script

Просто двічі клацніть на файл або запустіть з командного рядка:

```cmd
build.bat
```

Це автоматично створить **дві збірки** в папці `dist/`:
- `dist/chrome/` - для Chrome
- `dist/firefox/` - для Firefox

---

## 🌐 Як завантажити в браузер

### Google Chrome

1. Відкрити `chrome://extensions/`
2. Увімкнути **Developer mode** (праворуч вгорі)
3. Натиснути **Load unpacked**
4. Вибрати папку `dist\chrome`
5. ✅ Готово!

### Mozilla Firefox

1. Відкрити `about:debugging#/runtime/this-firefox`
2. Натиснути **Load Temporary Add-on...**
3. Вибрати файл `dist\firefox\manifest.json`
4. ✅ Готово!

> **Примітка**: У Firefox розширення буде активне тільки до перезапуску браузера (це обмеження тимчасових розширень для розробки).

---

## ✏️ Робочий процес розробки

1. **Редагуйте код** в папці `src/` (як завжди)
2. **Запустіть** `build.bat` для збірки
3. **Перезавантажте** розширення в браузері:
   - Chrome: кнопка 🔄 на `chrome://extensions/`
   - Firefox: кнопка **Reload** на `about:debugging`

---

## 🔍 Відмінності між версіями

| Функція | Chrome | Firefox |
|---------|--------|---------|
| Основний функціонал | ✅ Повна підтримка | ✅ Повна підтримка |
| AI Chat | ✅ | ✅ |
| RAG Context Parsing | ✅ (Offscreen API) | ⚠️ Fallback method |
| Storage API | ✅ | ✅ |
| Downloads | ✅ | ✅ |

### Offscreen API (Chrome-only)

Chrome версія використовує **Offscreen API** для парсингу HTML сторінок листингів (RAG context).

Firefox **не підтримує** Offscreen API, тому:
- У поточній версії (1.5.0) RAG parsing буде пропущений
- В майбутніх версіях можна додати fallback через content script

---

## 🐛 Troubleshooting

### Build script не запускається

- Переконайтеся що ви в правильній директорії
- Права на виконання скриптів: запустіть PowerShell як адміністратор

### Розширення не завантажується

**Chrome:**
- Перевірте `dist/chrome/manifest.json` на наявність
- Дивіться помилки на `chrome://extensions/`

**Firefox:**
- Виберіть саме файл `manifest.json`, а не папку
- Дивіться Browser Console (`Ctrl+Shift+J`) для помилок

### Зміни не застосовуються

- Запустіть `build.bat` знову після редагування
- Перезавантажте розширення в браузері

---

## 📝 Примітки

- Папка `dist/` **автоматично генерується** - не редагуйте файли там!
- Завжди працюйте в папці `src/`
- `.gitignore` налаштований ігнорувати `dist/`

---

**Версія:** 1.5.0  
**Підтримувані браузери:** Chrome 88+, Firefox 109+
