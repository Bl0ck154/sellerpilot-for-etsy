chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ETSY_DATA_PARSED") {
        chrome.storage.local.set({ 'current_context': message.payload })
            .then(() => {
                sendResponse({ status: "success" });
            });
        return true;
    }

    // Handle image downloads
    if (message.action === 'downloadImage') {
        const { url, filename } = message;

        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('Download failed:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log('✅ Download started:', filename);
                sendResponse({ success: true, downloadId: downloadId });
            }
        });

        return true; // Keep message channel open for async response
    }
});