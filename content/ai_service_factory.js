// ai_service_factory.js - Factory for AI Service Provider Instantiation
// Dynamically loads and instantiates the appropriate AI service based on configuration

class AIServiceFactory {
    /**
     * Creates an instance of the appropriate AI service provider
     * @param {string} providerId - Provider ID (gemini, deepseek, grok)
     * @returns {Promise<BaseAIService>} Instance of the provider service
     */
    static async createService(providerId) {
        // Find provider configuration
        const provider = window.ETSY_AI_CONFIG.providers.find(p => p.id === providerId);

        if (!provider) {
            throw new Error(`Unknown AI provider: ${providerId}`);
        }

        console.log(`🏭 Creating AI service for provider: ${provider.name}`);

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
            // Use provided ID or get from storage
            let selectedProviderId = providerId;

            if (!selectedProviderId) {
                const result = await chrome.storage.local.get(['selected_provider']);
                selectedProviderId = result.selected_provider || window.ETSY_AI_CONFIG.defaultProvider;
            }

            console.log(`📌 Using AI provider: ${selectedProviderId}`);
            return await AIServiceFactory.createService(selectedProviderId);
        } catch (error) {
            console.error('Failed to get current service:', error);
            // Fallback to default provider
            return await AIServiceFactory.createService(window.ETSY_AI_CONFIG.defaultProvider);
        }
    }

    /**
     * Gets the API key for a specific provider
     * @param {string} providerId - Provider ID
     * @returns {Promise<string|null>} API key or null if not found
     */
    static async getApiKey(providerId) {
        const storageKey = `${providerId}_api_key`;
        const result = await chrome.storage.local.get([storageKey]);
        return result[storageKey] || null;
    }

    /**
     * Gets the selected model ID for a provider
     * @param {string} providerId - Provider ID
     * @returns {Promise<string>} Model ID
     */
    static async getModelId(providerId) {
        const storageKey = `${providerId}_model`;
        const result = await chrome.storage.local.get([storageKey]);

        // If no model selected, use default from config
        if (!result[storageKey]) {
            const provider = window.ETSY_AI_CONFIG.providers.find(p => p.id === providerId);
            return provider?.defaultModel || provider?.models[0]?.id;
        }

        return result[storageKey];
    }
}

// Export as a global class
window.AIServiceFactory = AIServiceFactory;

console.log('✅ AIServiceFactory loaded');
