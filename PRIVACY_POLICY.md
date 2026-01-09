# Privacy Policy for Etsy AI Assistant

**Last updated: January 9, 2026**

## Introduction

Etsy AI Assistant ("the Extension") is a Chrome browser extension designed to help Etsy shop owners manage their business more efficiently through AI-powered assistance. This privacy policy explains how the Extension handles your data.

## Data Collection and Storage

### What We Don't Collect

The Extension **does NOT**:
- Collect any personal information
- Store data on external servers (we don't have any servers)
- Track your browsing activity
- Share your data with third parties (except AI providers you explicitly choose)
- Use analytics or tracking tools

### What Data Stays Local

The following data is stored **locally in your browser** using Chrome's storage API:

1. **API Keys**: Your API keys for AI services (Google Gemini, DeepSeek, Grok) are stored encrypted in `chrome.storage.local`
2. **Chat History**: Your conversation history with the AI assistant stays in your browser
3. **Preferences**: Your selected AI model and UI position preferences

This data **never leaves your computer** except when you explicitly interact with AI services.

## Third-Party Services

When you use the Extension's AI features, page content and your messages are sent directly to the AI provider you selected:

### Supported AI Providers

1. **Google Gemini API**
   - Privacy Policy: https://policies.google.com/privacy
   - Terms: https://ai.google.dev/gemini-api/terms

2. **DeepSeek AI**
   - Privacy Policy: https://www.deepseek.com/privacy
   - Terms: https://www.deepseek.com/terms

3. **Grok AI (xAI)**
   - Privacy Policy: https://x.ai/legal/privacy-policy
   - Terms: https://x.ai/legal/terms-of-service

**Important**: Each AI provider has its own privacy policy and data handling practices. Please review their policies before using their services.

## Permissions Explained

The Extension requests the following Chrome permissions:

- **`activeTab`**: To read the current Etsy page content when you use the chat
- **`tabs`**: To identify which Etsy page you're on
- **`storage`**: To save your API keys and chat history locally
- **`downloads`**: To download images from Etsy messages
- **`scripting`**: To inject the chat interface into Etsy pages
- **`https://www.etsy.com/*`**: The Extension only works on Etsy.com domains

## Data Transmission

### When Data is Sent to AI Providers

Data is transmitted to AI providers **only when**:
1. You explicitly type a message and press Send
2. You click the "Generate Draft" button

### What Data is Sent

When you interact with the AI:
- Current Etsy page title and URL
- Main content of the page (extracted using Mozilla's Readability library)
- Your message
- Previous conversation context

This data is sent **directly** to the AI provider's API endpoint via HTTPS. The Extension developer has **no access** to this data.

## User Control

You have full control over your data:

- **Delete API Keys**: Remove your API keys anytime from the Settings page
- **Clear Chat History**: Delete individual chats or all history from the History panel
- **Uninstall**: Uninstalling the Extension removes all locally stored data

## Children's Privacy

The Extension is not intended for children under 13. We do not knowingly collect information from children.

## Changes to This Policy

We may update this privacy policy from time to time. The "Last updated" date at the top will reflect any changes. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Data Security

- API keys are stored in Chrome's secure storage
- All communication with AI providers uses HTTPS encryption
- No data is transmitted to servers controlled by the Extension developer

## Open Source

This Extension is open source. You can review the code at:
[GitHub Repository URL - add your repo link]

## Contact

For privacy concerns or questions:
- **Email**: [Your contact email]
- **GitHub Issues**: [Your repository issues URL]

## Compliance

This Extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR) - No personal data is collected
- California Consumer Privacy Act (CCPA) - No personal data is sold or shared

## Your Rights (GDPR/CCPA)

Since we don't collect, store, or process personal data on our servers:
- There is no data to request, delete, or port
- All your data stays in your browser under your control
- You can delete all data by clearing browser storage or uninstalling the Extension

---

**Summary**: The Extension is designed with privacy in mind. Your data stays in your browser, and we never see it. When you use AI features, your data goes directly to your chosen AI provider under their privacy terms.
