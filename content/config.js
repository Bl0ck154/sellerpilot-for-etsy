// config.js - Configuration for Etsy AI Assistant
// This file is loaded before other content scripts (see manifest.json)

window.ETSY_AI_CONFIG = {
    models: [
        {
            id: "gemini-3-flash-preview",
            name: "Gemini 3.0 Flash",
            provider: "google"
        }
    ],

    // Default model (will be pre-selected in dropdown)
    defaultModel: "gemini-3-flash-preview"
};

console.log("✅ ETSY AI Config loaded:", window.ETSY_AI_CONFIG.models.length, "models");
