// config.js - Configuration for Etsy AI Assistant
// This file is loaded before other content scripts (see manifest.json)

window.ETSY_AI_CONFIG = {
    // Available AI providers
    providers: [
        {
            id: "gemini",
            name: "Google Gemini",
            models: [
                {
                    id: "gemini-3-flash-preview",
                    name: "Gemini 3.0 Flash"
                }
            ],
            defaultModel: "gemini-3-flash-preview"
        },
        {
            id: "deepseek",
            name: "DeepSeek",
            models: [
                {
                    id: "deepseek-chat",
                    name: "DeepSeek Chat"
                },
                {
                    id: "deepseek-reasoner",
                    name: "DeepSeek Reasoner"
                }
            ],
            defaultModel: "deepseek-chat"
        },
        {
            id: "grok",
            name: "Grok (xAI)",
            models: [
                {
                    id: "grok-beta",
                    name: "Grok Beta"
                },
                {
                    id: "grok-vision-beta",
                    name: "Grok Vision Beta"
                }
            ],
            defaultModel: "grok-beta"
        }
    ],

    // Default provider (will be pre-selected in dropdown)
    defaultProvider: "gemini"
};

