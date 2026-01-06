// options.js - Options Page Logic
console.log('⚙️ Options page loaded');

const chatManagerToggle = document.getElementById('chatManagerToggle');
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleApiKeyBtn = document.getElementById('toggleApiKeyVisibility');
const customInstructionsTextarea = document.getElementById('customInstructions');
const statusElement = document.getElementById('status');
const statusText = statusElement.querySelector('.status-text');

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Show status message
function showStatus(message) {
    statusText.textContent = message;
    statusElement.classList.remove('hidden');
    setTimeout(() => {
        statusElement.classList.add('hidden');
    }, 2000);
}

// Toggle API key visibility
toggleApiKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleApiKeyBtn.textContent = '🙈';
        toggleApiKeyBtn.title = 'Hide API Key';
    } else {
        apiKeyInput.type = 'password';
        toggleApiKeyBtn.textContent = '👁️';
        toggleApiKeyBtn.title = 'Show API Key';
    }
});

// Get base instruction from shared config
function getBaseInstruction() {
    // Access the baseInstruction from the globally available config or AIService class
    if (window.ETSY_AI_BASE_INSTRUCTION) {
        return window.ETSY_AI_BASE_INSTRUCTION;
    }
    if (window.AIService && window.AIService.INSTRUCTIONS) {
        return window.AIService.INSTRUCTIONS.baseInstruction;
    }
    // This should never happen if scripts are loaded in correct order
    console.error('❌ BASE_INSTRUCTION not found!');
    return '';
}

// Load saved settings
async function loadSettings() {
    // Load chat manager toggle
    chrome.storage.sync.get(['chatManagerEnabled'], (result) => {
        const isEnabled = result.chatManagerEnabled !== undefined ? result.chatManagerEnabled : true;
        chatManagerToggle.checked = isEnabled;
        console.log('📖 Loaded chat manager setting:', { chatManagerEnabled: isEnabled });
    });

    // Load API key
    chrome.storage.local.get(['custom_api_keys'], (result) => {
        if (result.custom_api_keys && result.custom_api_keys.google) {
            apiKeyInput.value = result.custom_api_keys.google;
            console.log('📖 Loaded API key');
        }
    });

    // Load custom instructions
    // If user has custom instructions, show them. Otherwise show default from code.
    chrome.storage.local.get(['custom_instructions'], (result) => {
        const baseInstruction = getBaseInstruction();

        if (result.custom_instructions && result.custom_instructions.trim()) {
            // User has modified instructions
            customInstructionsTextarea.value = result.custom_instructions;
            console.log('📖 Loaded custom instructions (user modified)');
        } else {
            // Show default from code (will auto-update when code changes)
            customInstructionsTextarea.value = baseInstruction;
            console.log('📖 Loaded default instructions from code');
        }
    });
}

// Save API key
function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();

    chrome.storage.local.get(['custom_api_keys'], (result) => {
        const apiKeys = result.custom_api_keys || {};
        apiKeys.google = apiKey;

        chrome.storage.local.set({ custom_api_keys: apiKeys }, () => {
            console.log('💾 API key saved');
            showStatus('API Key saved');
        });
    });
}

// Save custom instructions
function saveCustomInstructions() {
    const instructions = customInstructionsTextarea.value.trim();
    const baseInstruction = getBaseInstruction();

    // If instructions match base, remove from storage (user is on default)
    if (!instructions || instructions === baseInstruction) {
        chrome.storage.local.remove('custom_instructions', () => {
            console.log('💾 Using default instructions (will auto-update)');
            showStatus('Using default instructions');
        });
    } else {
        // User has customized - save to storage
        chrome.storage.local.set({ custom_instructions: instructions }, () => {
            console.log('💾 Custom instructions saved (locked, won\'t auto-update)');
            showStatus('Custom instructions saved');
        });
    }
}

// Reset to default instructions
function resetToDefault() {
    const baseInstruction = getBaseInstruction();
    customInstructionsTextarea.value = baseInstruction;

    // Remove from storage to enable auto-updates
    chrome.storage.local.remove('custom_instructions', () => {
        console.log('🔄 Reset to default instructions');
        showStatus('Reset to default instructions');
    });
}

// Event listeners
const resetBtn = document.getElementById('resetInstructions');
resetBtn.addEventListener('click', resetToDefault);
chatManagerToggle.addEventListener('change', () => {
    const isEnabled = chatManagerToggle.checked;

    chrome.storage.sync.set({ chatManagerEnabled: isEnabled }, () => {
        console.log('💾 Settings saved:', { chatManagerEnabled: isEnabled });

        showStatus(isEnabled ? 'Chat Manager enabled' : 'Chat Manager disabled');

        // Notify all tabs about settings change
        chrome.tabs.query({ url: 'https://www.etsy.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'CHAT_MANAGER_TOGGLE',
                    enabled: isEnabled
                }).catch(err => {
                    console.log('Tab not ready:', tab.id);
                });
            });
        });
    });
});

// Save API key on blur
apiKeyInput.addEventListener('blur', saveApiKey);

// Auto-save custom instructions with debounce
const debouncedSaveInstructions = debounce(saveCustomInstructions, 1000);
customInstructionsTextarea.addEventListener('input', debouncedSaveInstructions);

// Initial load
loadSettings();
