# Architecture Documentation

## Overview

Etsy AI Assistant is a Chrome Manifest V3 extension that provides context-aware AI assistance for Etsy pages. The extension uses a content script architecture with a floating chat interface.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Etsy Page                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Content Scripts (injected into page)                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │page_parser.js│  │ai_service.js │  │content.js   │ │  │
│  │  │(HTML→MD)     │──│(Gemini API)  │──│(Extraction) │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  │         │                  │                 │        │  │
│  │         └──────────────────┴─────────────────┘        │  │
│  │                         │                             │  │
│  │                  ┌──────▼─────────┐                   │  │
│  │                  │  chat_ui.js    │                   │  │
│  │                  │ (Floating UI)  │                   │  │
│  │                  └────────────────┘                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Background      │
                    │ service_worker.js│
                    │ (Context Store)  │
                    └──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │ chrome.storage   │
                    │  - API keys      │
                    │  - Chat history  │
                    │  - Preferences   │
                    └──────────────────┘
```

## Component Details

### 1. Content Scripts

Content scripts run in the context of Etsy pages. They have access to the DOM but run in an isolated JavaScript environment.

#### `content/content.js`
**Purpose**: Main content script coordinator
- **Responsibilities**:
  - Monitors page changes (SPA navigation)
  - Extracts page content using PageParser
  - Sends page context to background script
  - Manages extension lifecycle (handles context invalidation)
- **Key Functions**:
  - `attemptExtraction()` - Extracts and sends page data
  - MutationObserver - Watches for DOM changes
  - URL change detection via interval

#### `content/page_parser.js`
**Purpose**: Convert HTML to clean Markdown
- **Dependencies**: 
  - Mozilla Readability (libs/Readability.min.js)
  - Turndown (libs/turndown.js)
- **Process**:
  1. Clone document to avoid modifying visible page
  2. Remove noise (nav, footer, scripts, styles)
  3. Extract main content
  4. Convert HTML → Markdown
  5. Clean up formatting
- **Exports**: `window.PageParser` with `getFullPageData()`

#### `content/ai_service.js`
**Purpose**: Gemini API integration
- **Responsibilities**:
  - Build conversation history from chrome.storage
  - Construct system instructions with page context
  - Make streaming API calls to Gemini
  - Handle API responses and errors
- **Key Methods**:
  - `buildConversationHistory(userId, currentMessage)` - Loads chat history
  - `constructPromptData(context, userQuery)` - Builds prompts
  - `callGeminiStreamingAPI()` - Streams AI responses
- **Storage**: Reads API keys from chrome.storage (not from files)

#### `content/chat_ui.js`
**Purpose**: Floating chat interface
- **Responsibilities**:
  - Inject UI HTML and CSS
  - Handle user interactions (send message, settings, history)
  - Render markdown responses
  - Manage drag & drop positioning
  - Tooltips and visual feedback
- **Key Features**:
  - Drag & drop for button and chat window
  - Edge-based positioning (saves distance from nearest edge)
  - Session management (save/restore chat sessions)
  - Markdown parser (custom implementation)
  - Copy-to-clipboard for code blocks
- **Storage Used**:
  - Local storage for UI positions
  - chrome.storage for chat history and API keys

### 2. Background Script

#### `background/service_worker.js`
**Purpose**: Lightweight context storage
- **Current Functionality**:
  - Listens for `ETSY_DATA_PARSED` messages
  - Stores current page context in chrome.storage.local
- **Storage Key**: `current_context` - Contains latest page data

**Note**: This is a minimal implementation. The background script doesn't do heavy processing since everything happens in content scripts.

### 3. Libraries

#### `libs/Readability.min.js`
- **Source**: [Mozilla Readability](https://github.com/mozilla/readability)
- **Purpose**: Extract main content from web pages
- **Usage**: PageParser uses it to get clean article text

#### `libs/turndown.js`
- **Source**: [Turndown](https://github.com/mixmark-io/turndown)
- **Purpose**: Convert HTML to Markdown
- **Usage**: PageParser converts extracted HTML to markdown

## Data Flow

### Page Load Flow
```
1. User visits Etsy page
   ↓
2. content.js injects (manifest)
   ↓
3. page_parser.js & ai_service.js load
   ↓
4. chat_ui.js injects floating UI
   ↓
5. content.js extracts page → PageParser
   ↓
6. Sends to background → chrome.storage
   ↓
7. UI updates status indicator
```

### Chat Interaction Flow
```
1. User types message in chat_ui
   ↓
2. chat_ui loads conversation history (chrome.storage)
   ↓
3. Calls ai_service.buildConversationHistory()
   ↓
4. Adds current page context as system instruction
   ↓
5. ai_service calls Gemini streaming API
   ↓
6. Streams chunks → chat_ui renders markdown
   ↓
7. Complete message saved to chrome.storage
```

## Storage Schema

### chrome.storage.local

```javascript
{
  // Current page context (set by background)
  "current_context": {
    page_content: {
      title: string,
      markdown: string,
      excerpt: string,
      siteName: string,
      hasContent: boolean
    },
    metadata: {
      url: string,
      pathname: string,
      title: string,
      timestamp: string
    },
    page_url: string
  },

  // API keys (set by user via Settings)
  "custom_api_keys": {
    google: string
  },

  // User preferences
  "preferred_model": string,  // e.g. "gemini-1.5-flash"

  // Chat history (per page URL hash)
  "history_<URL_HASH>": [
    {
      text: string,
      type: "user" | "ai" | "system",
      timestamp: string (ISO)
    }
  ],

  // Session index (all saved sessions)
  "sessions_index_all": [
    {
      id: string,
      name: string,
      pageTitle: string,
      pageUrl: string,
      timestamp: string (ISO),
      messageCount: number,
      messages: Array<HistoryMessage>
    }
  ]
}
```

### localStorage (for UI state)

```javascript
{
  "etsy-ai-btn-position": {
    edge: "left" | "right",
    edgeDistance: number,
    verticalEdge: "top" | "bottom",
    verticalDistance: number
  },
  "etsy-ai-chat-position": { /* same structure */ }
}
```

## Security Considerations

### API Key Protection

**Before (INSECURE)**:
- `config.secret.json` was in `web_accessible_resources`
- Any webpage could read it via `chrome.runtime.getURL()`

**After (SECURE)**:
- API keys stored in `chrome.storage.local`
- Only extension code can access
- User enters key via Settings UI

### Content Security

- Content scripts run in isolated world (separate from page JS)
- Page cannot access extension storage or APIs
- Extension cannot be compromised by malicious Etsy pages

### Data Privacy

- All page content stays local until user initiates chat
- AI requests go directly to Google Gemini (no middleman)
- No telemetry or analytics
- Chat history stored locally (not synced)

## Extension Lifecycle

### Installation
1. User loads extension
2. Manifest registered with Chrome
3. Background service worker starts (dormant until needed)

### Page Visit
1. Content scripts injected (manifest match pattern)
2. Scripts execute in order (manifest.content_scripts.js array)
3. UI appears after initialization

### Extension Update/Reload
**Problem**: Extension context can be invalidated mid-execution

**Solution**: Defensive checks
```javascript
// Before any chrome.* API call:
if (!chrome.runtime?.id) {
  // Extension was reloaded, stop execution
  return;
}
```

Used in:
- `content.js` - Before sendMessage
- `chat_ui.js` - Before storage operations

## Performance Considerations

### Page Parsing
- **Cost**: Readability + Turndown on every page load
- **Mitigation**: 
  - Only parse once per page
  - Use hash comparison to avoid re-parsing identical content
  - Debounce DOM mutations (1 second)

### Chat History
- **Cost**: Loading message history from storage
- **Mitigation**:
  - Limit to 50 messages per session
  - Use URL hash for efficient lookups
  - Lazy load old sessions (only on History open)

### API Calls
- **Rate Limits**: Gemini API has quotas
- **Mitigation**:
  - Use streaming to show progress
  - Cache conversation history
  - Client-side validation before sending

## Future Improvements

### Code Duplication (Planned)
Currently there's significant duplication between `chat_ui.js` and removed `sidepanel.js`. Both implemented identical:
- Configuration loading
- Chat logic
- History management
- Markdown parsing

**Plan**: Create `ChatController` module to share logic.

### Suggested Architecture
```
content/
  ├── chat_controller.js  (shared logic)
  ├── chat_ui.js         (UI only, uses controller)
  └── ai_service.js      (kept separate)
```

## Debugging

### Enable Detailed Logging
Content scripts log to the page's console (Dev Tools)

### Inspect Storage
- `chrome.storage`: DevTools → Application → Storage → Extension
- `localStorage`: DevTools → Application → Local Storage

### Reload Extension
After code changes:
1. chrome://extensions/
2. Click reload icon
3. Refresh Etsy page

### Common Issues

**Chat not appearing**:
- Check console for errors
- Verify manifest permissions
- Check if content scripts loaded

**API errors**:
- Verify API key in Settings
- Check Network tab for API responses
- Look for quota exceeded errors

**Context not updating**:
- Check background service worker console
- Verify storage.local has `current_context`
- Look for extension context invalidation warnings

## Technology Stack

- **JavaScript**: ES6+ (Chrome 88+ support)
- **CSS**: Vanilla CSS (no preprocessors)
- **APIs**:
  - Chrome Extension APIs (manifest v3)
  - Google Gemini AI API
  - Fetch API for HTTP requests
- **Libraries**:
  - Mozilla Readability
  - Turndown
- **Storage**:
  - chrome.storage.local (extension data)
  - localStorage (UI state)

## Browser Compatibility

- **Minimum**: Chrome 88 (Manifest V3 support)
- **Recommended**: Chrome 100+
- **Not Supported**: Firefox, Safari, Edge (Chromium Edge may work but untested)

---

For implementation details, see code comments in individual files.
