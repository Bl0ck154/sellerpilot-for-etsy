// options.js - Options Page Logic
console.log('⚙️ Options page loaded');

const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const deepseekApiKeyInput = document.getElementById('deepseekApiKeyInput');
const grokApiKeyInput = document.getElementById('grokApiKeyInput');
const customInstructionsTextarea = document.getElementById('customInstructions');
const chatManagerToggle = document.getElementById('chatManagerToggle');
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

// Toggle API key visibility for all inputs
document.querySelectorAll('.toggle-visibility-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);

        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
            btn.title = 'Hide API Key';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
            btn.title = 'Show API Key';
        }
    });
});

// Get base instruction from shared config
function getBaseInstruction() {
    if (window.ETSY_AI_BASE_INSTRUCTION) {
        return window.ETSY_AI_BASE_INSTRUCTION;
    }
    console.error('❌ BASE_INSTRUCTION not found!');
    return '';
}

// Load all settings
async function loadSettings() {
    // Load chat manager toggle
    chrome.storage.sync.get(['chatManagerEnabled'], (result) => {
        const isEnabled = result.chatManagerEnabled !== undefined ? result.chatManagerEnabled : true;
        chatManagerToggle.checked = isEnabled;
        console.log('📖 Loaded chat manager setting:', { chatManagerEnabled: isEnabled });
    });

    // Load API keys for all providers
    chrome.storage.local.get(['gemini_api_key', 'deepseek_api_key', 'grok_api_key'], (result) => {
        if (result.gemini_api_key) {
            geminiApiKeyInput.value = result.gemini_api_key;
            console.log('📖 Loaded Gemini API key');
        }
        if (result.deepseek_api_key) {
            deepseekApiKeyInput.value = result.deepseek_api_key;
            console.log('📖 Loaded DeepSeek API key');
        }
        if (result.grok_api_key) {
            grokApiKeyInput.value = result.grok_api_key;
            console.log('📖 Loaded Grok API key');
        }
    });

    // Load custom instructions
    chrome.storage.local.get(['custom_instructions'], (result) => {
        const baseInstruction = getBaseInstruction();

        if (result.custom_instructions && result.custom_instructions.trim()) {
            customInstructionsTextarea.value = result.custom_instructions;
            console.log('📖 Loaded custom instructions (user modified)');
        } else {
            customInstructionsTextarea.value = baseInstruction;
            console.log('📖 Loaded default instructions from code');
        }
    });

    // Backward compatibility: migrate old Gemini API key
    chrome.storage.local.get(['custom_api_keys'], (result) => {
        if (result.custom_api_keys && result.custom_api_keys.google) {
            const oldGeminiKey = result.custom_api_keys.google;
            chrome.storage.local.set({ gemini_api_key: oldGeminiKey }, () => {
                console.log('🔄 Migrated old Gemini API key to new format');
                geminiApiKeyInput.value = oldGeminiKey;
                // Remove old format
                chrome.storage.local.remove('custom_api_keys');
            });
        }
    });
}

// Save API keys
function saveGeminiApiKey() {
    const apiKey = geminiApiKeyInput.value.trim();
    chrome.storage.local.set({ gemini_api_key: apiKey }, () => {
        console.log('💾 Gemini API key saved');
        showStatus('Gemini API Key saved');
    });
}

function saveDeepSeekApiKey() {
    const apiKey = deepseekApiKeyInput.value.trim();
    chrome.storage.local.set({ deepseek_api_key: apiKey }, () => {
        console.log('💾 DeepSeek API key saved');
        showStatus('DeepSeek API Key saved');
    });
}

function saveGrokApiKey() {
    const apiKey = grokApiKeyInput.value.trim();
    chrome.storage.local.set({ grok_api_key: apiKey }, () => {
        console.log('💾 Grok API key saved');
        showStatus('Grok API Key saved');
    });
}

// Save custom instructions
function saveCustomInstructions() {
    const instructions = customInstructionsTextarea.value.trim();
    const baseInstruction = getBaseInstruction();

    if (!instructions || instructions === baseInstruction) {
        chrome.storage.local.remove('custom_instructions', () => {
            console.log('💾 Using default instructions (will auto-update)');
            showStatus('Using default instructions');
        });
    } else {
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

// Save API keys on blur
geminiApiKeyInput.addEventListener('blur', saveGeminiApiKey);
deepseekApiKeyInput.addEventListener('blur', saveDeepSeekApiKey);
grokApiKeyInput.addEventListener('blur', saveGrokApiKey);

// Auto-save custom instructions with debounce
const debouncedSaveInstructions = debounce(saveCustomInstructions, 1000);
customInstructionsTextarea.addEventListener('input', debouncedSaveInstructions);

// Initial load
loadSettings();
