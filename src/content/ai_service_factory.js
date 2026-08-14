// ai_service_factory.js - Factory for AI Service Provider Instantiation
// Dynamically loads and instantiates the appropriate AI service based on configuration

class AIServiceFactory {
    static DEFAULT_MODELS = {
        gemini: 'gemini-flash-latest',
        deepseek: 'deepseek-chat',
        grok: 'grok-beta',
        openrouter: 'openrouter/auto',
        custom: ''
    };

    /**
     * Check if extension context is still valid
     * @private
     */
    static isExtensionContextValid() {
        return !!(chrome.runtime && chrome.runtime.id);
    }

    /**
     * Creates an instance of the appropriate AI service provider
     * @param {string} providerId - Provider ID (gemini, deepseek, grok, openrouter)
     * @returns {Promise<BaseAIService>} Instance of the provider service
     */
    static async createService(providerId) {
        if (providerId === 'custom') {
            if (!window.CustomOpenAIService) throw new Error('CustomOpenAIService not loaded');
            return new window.CustomOpenAIService();
        }

        // Service classes are already loaded via manifest.json
        // Just instantiate the appropriate one
        switch (providerId) {
            case 'gemini':
                if (!window.GeminiService) {
                    throw new Error('GeminiService not loaded');
                }
                return new window.GeminiService();

            case 'deepseek':
                if (!window.DeepSeekService) {
                    throw new Error('DeepSeekService not loaded');
                }
                return new window.DeepSeekService();

            case 'grok':
                if (!window.GrokService) {
                    throw new Error('GrokService not loaded');
                }
                return new window.GrokService();

            case 'openrouter':
                if (!window.OpenRouterService) {
                    throw new Error('OpenRouterService not loaded');
                }
                return new window.OpenRouterService();

            default:
                throw new Error(`No service implementation for provider: ${providerId}`);
        }
    }

    /**
     * Get the currently selected service instance from storage
     * @param {string} [providerId] - Optional provider ID to override storage lookup
     * @returns {Promise<BaseAIService>}
     */
    static async getCurrentService(providerId = null) {
        try {
            // Check extension context before storage access
            if (!AIServiceFactory.isExtensionContextValid()) {
                // Fallback to default if context is invalid
                if (window.ETSY_AI_CONFIG?.defaultProvider) {
                    return await AIServiceFactory.createService(window.ETSY_AI_CONFIG.defaultProvider);
                }
                throw new Error('Extension context invalidated.');
            }

            // Use provided ID or get from storage
            let selectedProviderId = providerId;

            if (!selectedProviderId) {
                try {
                    const result = await chrome.storage.local.get(['selected_provider']);
                    selectedProviderId = result.selected_provider || window.ETSY_AI_CONFIG?.defaultProvider;
                } catch (e) {
                    if (e.message.includes('Extension context invalidated')) {
                        selectedProviderId = window.ETSY_AI_CONFIG?.defaultProvider;
                    } else {
                        throw e;
                    }
                }
            }

            return await AIServiceFactory.createService(selectedProviderId);
        } catch (error) {
            console.error('Failed to get current service, falling back to default:', error);
            // Fallback to default provider
            if (window.ETSY_AI_CONFIG?.defaultProvider) {
                return await AIServiceFactory.createService(window.ETSY_AI_CONFIG.defaultProvider);
            }
            throw error;
        }
    }

    /**
     * Gets the API key for a specific provider
     * @param {string} providerId - Provider ID
     * @returns {Promise<string|null>} API key or null if not found
     */
    static async getApiKey(providerId) {
        // Check extension context before storage access
        if (!AIServiceFactory.isExtensionContextValid()) {
            console.warn('⚠️ Extension context invalid when getting API key for:', providerId);
            return null;
        }

        try {
            const storageKey = `${providerId}_api_key`;
            const result = await chrome.storage.local.get([storageKey]);
            const apiKey = result[storageKey];
            return apiKey || null;
        } catch (e) {
            if (e.message.includes('Extension context invalidated')) {
                console.error('⚠️ Extension context invalidated when getting API key for:', providerId);
                return null;
            }
            throw e;
        }
    }

    /**
     * Gets the selected model ID for a provider
     * @param {string} providerId - Provider ID
     * @returns {Promise<string>} Model ID
     */
    static async getModelId(providerId) {
        // Check extension context before storage access
        if (!AIServiceFactory.isExtensionContextValid()) {
            const provider = window.ETSY_AI_CONFIG?.providers?.find(p => p.id === providerId);
            return provider?.defaultModel || provider?.models[0]?.id || AIServiceFactory.DEFAULT_MODELS[providerId] || '';
        }

        try {
            const storageKey = `${providerId}_model`;
            const result = await chrome.storage.local.get([storageKey]);

            // If no model selected, use default from config
            if (!result[storageKey]) {
                const provider = window.ETSY_AI_CONFIG?.providers?.find(p => p.id === providerId);
                return provider?.defaultModel || provider?.models[0]?.id || AIServiceFactory.DEFAULT_MODELS[providerId] || '';
            }

            return result[storageKey];
        } catch (e) {
            if (e.message.includes('Extension context invalidated')) {
                const provider = window.ETSY_AI_CONFIG?.providers?.find(p => p.id === providerId);
                return provider?.defaultModel || provider?.models[0]?.id || AIServiceFactory.DEFAULT_MODELS[providerId] || '';
            }
            throw e;
        }
    }
}

// Export as a global class
window.AIServiceFactory = AIServiceFactory;

