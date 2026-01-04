// options.js - Options Page Logic
console.log('⚙️ Options page loaded');

const chatManagerToggle = document.getElementById('chatManagerToggle');
const statusElement = document.getElementById('status');
const statusText = statusElement.querySelector('.status-text');

// Load saved settings
chrome.storage.sync.get(['chatManagerEnabled'], (result) => {
    // Default to enabled if not set
    const isEnabled = result.chatManagerEnabled !== undefined ? result.chatManagerEnabled : true;
    chatManagerToggle.checked = isEnabled;
    console.log('📖 Loaded settings:', { chatManagerEnabled: isEnabled });
});

// Save settings on change
chatManagerToggle.addEventListener('change', () => {
    const isEnabled = chatManagerToggle.checked;

    chrome.storage.sync.set({ chatManagerEnabled: isEnabled }, () => {
        console.log('💾 Settings saved:', { chatManagerEnabled: isEnabled });

        // Show status message
        statusText.textContent = isEnabled
            ? 'Chat Manager увімкнено'
            : 'Chat Manager вимкнено';
        statusElement.classList.remove('hidden');

        // Hide status after 2 seconds
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 2000);

        // Notify all tabs about settings change
        chrome.tabs.query({ url: 'https://www.etsy.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'CHAT_MANAGER_TOGGLE',
                    enabled: isEnabled
                }).catch(err => {
                    // Silently ignore if content script not loaded
                    console.log('Tab not ready:', tab.id);
                });
            });
        });
    });
});
