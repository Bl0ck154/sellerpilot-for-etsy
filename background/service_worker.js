chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ETSY_DATA_PARSED") {
        chrome.storage.local.set({ 'current_context': message.payload })
            .then(() => {
                sendResponse({ status: "success" });
            });
        return true;
    }
});