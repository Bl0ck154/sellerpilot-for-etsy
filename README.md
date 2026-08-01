# Etsy AI Assistant 🤖

Chrome extension that integrates AI assistance directly into Etsy pages, helping shop owners manage their business more efficiently.

![Version](https://img.shields.io/badge/version-1.6.20-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)

## ✨ Features

- **Floating AI Chat**: Intelligent assistant accessible from any Etsy page
- **Page Context Aware**: Automatically extracts and analyzes page content
- **Multi-Model Support**: Choose from various Gemini AI models
- **Chat History**: Persistent conversation history per page
- **Quick Replies**: Reusable templates that insert into Etsy's draft field without sending
- **Agent-Managed Templates**: Ask the AI chat to add, edit, list, or remove quick replies
- **Markdown Rendering**: Beautiful formatting with code blocks, tables, and lists
- **Drag & Drop UI**: Fully customizable positioning that persists
- **Smart Tooltips**: Context-sensitive help throughout the interface

## 📋 Requirements

- Chrome browser (version 88+)
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## 🚀 Installation

### Development Installation

1. **Clone or download this repository**
   ```bash
   git clone <your-repo-url>
   cd ChromeExtensionEtsyAI
   ```

2. **Set up configuration (IMPORTANT)**
   
   The extension does NOT ship with API keys. You need to add your own:
   
   - Option A: Create `config.secret.json` (for development):
     ```bash
     cp config.example.json config.secret.json
     ```
     Then edit `config.secret.json` and add your Google API key.
     
   - Option B: Use the Settings UI (recommended for end users):
     Just install the extension and click the Settings ⚙️ button to add your API key.

3. **Load extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `ChromeExtensionEtsyAI/src` folder

4. **Test the extension**
   - Visit any Etsy page (e.g., https://www.etsy.com/)
   - Look for the floating 🤖 button in the bottom-right corner
   - Click it to open the AI chat interface

## ⚙️ Configuration

### API Key Setup

**Using Settings UI** (Recommended)
1. Click the 🤖 button to open the chat
2. Click the Settings ⚙️ icon
3. Enter your Google API key
4. Click "Save Settings"

API keys are stored securely in `chrome.storage.local`.

### Model Configuration

Models are configured in `content/config.js`. To add or change models:
1. Edit `content/config.js`
2. Modify the `models` array
3. Set `defaultModel` to your preferred model ID
4. Reload the extension

**Current default model**: `gemini-flash-latest`

Gemini thinking is adaptive. Simple requests use `minimal`, medium-context requests use `medium`, and complex/important requests (including internal briefs / ТЗ) use `high`. The Gemini 2.5 fallback uses equivalent legacy numeric budgets.

## 🎯 Usage

### Basic Chat
1. Click the 🤖 button to open the chat
2. Type your question or request
3. Press Enter or click Send
4. The AI will analyze the current Etsy page and respond

### Quick Actions
- **AI Actions**: Suggest, rewrite, translate, summarize, or risk-check a reply
- **Quick Replies**: Select a saved template above Etsy's message field; it is inserted as an unsent draft
- **Manage Templates**: Click `Manage` beside the templates, or ask the AI chat to add/edit/list/remove one
- **History**: View and restore previous chat sessions
- **New Chat**: Start a fresh conversation

### Page Context
The extension automatically extracts:
- Page title and metadata
- Main content (using Readability)
- Formatted as clean Markdown for better AI understanding

## 🏗️ Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

**Key Components:**
- `content/content.js` - Page content extraction
- `content/chat_ui.js` - Floating chat interface
- `content/base_ai_service.js` - Base abstract class for AI providers
- `content/ai_service_factory.js` - Factory for selecting AI providers
- `content/providers/` - AI service implementations (Gemini, DeepSeek, Grok)
- `content/page_parser.js` - HTML to Markdown conversion
- `background/service_worker.js` - Background context storage

## 🛠️ Development

### Project Structure
```
ChromeExtensionEtsyAI/
├── manifest.json          # Extension configuration
├── config.example.json    # API key template
├── background/
│   └── service_worker.js  # Background script
├── content/
│   ├── config.js          # Model configuration
│   ├── content.js         # Content script entry
│   ├── chat_ui.js         # Floating chat UI
│   ├── chat_ui.css        # Chat styling
│   ├── image_modal.css    # Image modal styling
│   ├── image_modal.js     # Image download modal
│   ├── chat_manager.js    # Chat history management
│   ├── page_parser.js     # Page content extraction
│   ├── base_ai_service.js      # Base AI service (abstract class)
│   ├── ai_service_factory.js   # AI provider factory
│   ├── providers/         # AI service providers
│   │   ├── gemini_service.js   # Google Gemini AI
│   │   ├── deepseek_service.js # DeepSeek AI
│   │   └── grok_service.js     # Grok AI
│   └── ui.html            # Chat HTML template
└── libs/
    ├── Readability.min.js # Mozilla Readability
    └── turndown.js        # HTML to Markdown
```

### Building & Testing

Run `cmd /c build.bat` to generate the Chromium package in `dist/chrome` and the Firefox package in
`dist/firefox`.

**To test changes:**
1. Make your code changes
2. Go to `chrome://extensions/`
3. Click the "Reload" icon on the extension card
4. Test on an Etsy page

### Code Quality

Before committing:
- Ensure `config.secret.json` is gitignored
- Test all features manually (see Verification Plan in implementation_plan.md)
- Check browser console for errors

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

[Add your license here]

## ⚠️ Disclaimer

This extension is not affiliated with Etsy. Use at your own discretion.

## 🔒 Security & Privacy

- API keys are stored locally in Chrome's storage (never transmitted to third parties)
- All AI requests go directly to Google's Gemini API
- No data is collected or stored by the extension developer
- Page content is only sent to the AI when you explicitly interact with the chat

## 📞 Support

[Add support information here - issues, email, etc.]

---

Made with ❤️ for Etsy shop owners
