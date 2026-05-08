// config.js - Configuration for Etsy AI Assistant
// This file is loaded before other content scripts (see manifest.json)

// Gemini fallback chain — primary first, silently fall through on failure.
// Used both by populateModelDropdown (first entry wins as default) and by
// gemini_service.js when a request fails.
window.ETSY_AI_GEMINI_FALLBACK_CHAIN = [
    "gemini-flash-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-flash"
];

window.ETSY_AI_CONFIG = {
    providers: [
        {
            id: "gemini",
            name: "Google Gemini",
            models: window.ETSY_AI_GEMINI_FALLBACK_CHAIN.map(id => ({ id, name: id })),
            defaultModel: window.ETSY_AI_GEMINI_FALLBACK_CHAIN[0]
        }
    ],

    defaultProvider: "gemini"
};
