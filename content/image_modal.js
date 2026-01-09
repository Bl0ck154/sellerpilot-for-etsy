// image_modal.js - Image Modal Viewer for Etsy Messages
// Opens images in a modal instead of new tab, with download functionality

(function () {
    'use strict';

    let modalElement = null;
    let currentImageUrl = null;
    let isZoomed = false;

    // Module API
    window.EtsyImageModal = {
        init: function () {
            createModal();
            attachImageInterceptors();
            attachDownloadAllButtons();
            console.log('🖼️ Image Modal: Initialized');
        },

        cleanup: function () {
            if (modalElement && modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
                modalElement = null;
            }
            console.log('🖼️ Image Modal: Cleaned up');
        }
    };

    // Create modal structure
    function createModal() {
        if (modalElement) return;

        modalElement = document.createElement('div');
        modalElement.id = 'etsy-image-modal';
        modalElement.className = 'etsy-image-modal';
        modalElement.innerHTML = `
            <div class="etsy-image-modal-backdrop"></div>
            <div class="etsy-image-modal-content">
                <button class="etsy-image-modal-close" title="Close (ESC)">✕</button>
                <img class="etsy-image-modal-img" src="" alt="Image">
                <button class="etsy-image-download-btn" title="Download">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(modalElement);

        // Event listeners
        const closeBtn = modalElement.querySelector('.etsy-image-modal-close');
        const backdrop = modalElement.querySelector('.etsy-image-modal-backdrop');
        const downloadBtn = modalElement.querySelector('.etsy-image-download-btn');

        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
        downloadBtn.addEventListener('click', downloadCurrentImage);

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalElement.classList.contains('active')) {
                closeModal();
            }
        });

        // Prevent image click from closing modal and handle zoom toggle
        modalElement.querySelector('.etsy-image-modal-img').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleZoom();
        });

        // Update cursor when image loads
        modalElement.querySelector('.etsy-image-modal-img').addEventListener('load', updateCursor);

        // Update cursor on mouse enter
        modalElement.querySelector('.etsy-image-modal-content').addEventListener('mouseenter', updateCursor);
    }

    // Open modal with image
    function openModal(imageUrl) {
        if (!modalElement) createModal();

        currentImageUrl = imageUrl;
        const img = modalElement.querySelector('.etsy-image-modal-img');
        img.src = imageUrl;

        modalElement.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        // Reset zoom state when opening new image
        isZoomed = false;
        img.classList.remove('zoomed');

        // Update cursor after image loads
        img.onload = () => {
            updateCursor();
        };
    }

    // Close modal
    function closeModal() {
        if (!modalElement) return;

        modalElement.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
        currentImageUrl = null;
        isZoomed = false;

        // Reset zoom
        const img = modalElement.querySelector('.etsy-image-modal-img');
        if (img) {
            img.classList.remove('zoomed');
        }
    }

    // Download current image
    function downloadCurrentImage() {
        if (!currentImageUrl) return;
        downloadImage(currentImageUrl);
    }

    // Check if image is larger than container
    function isImageLargerThanContainer() {
        if (!modalElement) return false;

        const img = modalElement.querySelector('.etsy-image-modal-img');
        const content = modalElement.querySelector('.etsy-image-modal-content');

        if (!img || !content) return false;

        // Check if natural size is larger than displayed size
        return img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight;
    }

    // Update cursor based on zoom state and image size
    function updateCursor() {
        if (!modalElement) return;

        const content = modalElement.querySelector('.etsy-image-modal-content');
        const img = modalElement.querySelector('.etsy-image-modal-img');

        if (!content || !img) return;


        // If already zoomed, always show zoom-out cursor
        if (isZoomed) {
            content.style.cursor = 'zoom-out';
            img.style.cursor = 'zoom-out';
        } else if (isImageLargerThanContainer()) {
            // Not zoomed but image is larger - show zoom-in cursor
            content.style.cursor = 'zoom-in';
            img.style.cursor = 'zoom-in';
        } else {
            // Image is not larger than container - default cursor
            content.style.cursor = 'default';
            img.style.cursor = 'default';
        }

        // Hide/show download button based on zoom state
        const downloadBtn = modalElement.querySelector('.etsy-image-download-btn');
        if (downloadBtn) {
            if (isZoomed) {
                downloadBtn.style.display = 'none';
            } else {
                downloadBtn.style.display = '';
            }
        }
    }

    // Toggle zoom in/out
    function toggleZoom() {
        if (!modalElement) return;

        const img = modalElement.querySelector('.etsy-image-modal-img');
        const content = modalElement.querySelector('.etsy-image-modal-content');

        if (!img || !content) return;



        if (isZoomed) {
            // Zoom out - return to fit
            img.classList.remove('zoomed');
            content.classList.remove('zoomed');
            isZoomed = false;
            console.log('🔍 Zoomed out');
        } else {
            // Only allow zoom IN if image is larger than container
            if (!isImageLargerThanContainer()) {
                console.log('⚠️ Image is not larger than container, zoom disabled');
                return;
            }

            // Zoom in - show at 100% size
            img.classList.add('zoomed');
            content.classList.add('zoomed');
            isZoomed = true;
            console.log('🔍 Zoomed in');
        }

        updateCursor();
    }

    // Get client name from Etsy page
    function getClientName() {
        // Try to find buyer name in the correct location
        const selectors = [
            'h3.buyer-name a.wt-text-link-no-underline',  // Primary: buyer name link
            'h3.buyer-name',  // Fallback: buyer name container
            'h3.wt-text-title-01.buyer-name a',  // Alternative: with full class
            'h1.wt-text-heading-01',  // Old fallback
            '[data-region="conversation-header"] h1',
            '.conversation-header h1'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                // Clean the name for filename use
                const clientName = element.textContent.trim()
                    .replace(/[<>:"/\\|?*]/g, '_')  // Remove invalid filename characters
                    .replace(/\s+/g, '_')  // Replace spaces with underscores
                    .substring(0, 50);  // Limit length

                console.log(`✅ Client name found using selector "${selector}":`, clientName);
                return clientName;
            }
        }

        console.warn('⚠️ Client name not found, using fallback');
        return 'etsy_client';  // Fallback
    }

    // Download image with proper filename
    function downloadImage(url) {
        const clientName = getClientName();
        const timestamp = Date.now();
        const filename = `${clientName}_${timestamp}.jpg`;

        // Send download request to background script to avoid CORS
        chrome.runtime.sendMessage({
            action: 'downloadImage',
            url: url,
            filename: filename
        }, (response) => {
            if (response && response.success) {
                console.log("✅ Download started:", filename);
            } else {
                console.error('Download failed:', response?.error || 'Unknown error');
                alert('Не вдалося завантажити зображення');
            }
        });
    }

    // Intercept clicks on Etsy message images
    function attachImageInterceptors() {
        document.addEventListener('click', (e) => {
            // Find if click was on an image link in Etsy messages
            const imageLink = e.target.closest('a[href*="etsystatic.com/icm"]');

            if (imageLink) {
                e.preventDefault();
                e.stopPropagation();

                // Get full-size image URL (replace thumbnail with fullxfull)
                const href = imageLink.href;
                const fullImageUrl = href.replace(/icm_\d+x\d+\./g, 'icm_fullxfull.');

                openModal(fullImageUrl);
            }
        }, true); // Use capture phase to intercept before other handlers
    }

    // Attach "Download All" buttons to image blocks
    function attachDownloadAllButtons() {
        // Observer to detect new image blocks
        const observer = new MutationObserver(() => {
            processImageBlocks();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial processing
        processImageBlocks();
    }

    function processImageBlocks() {
        // Find all image grid containers in Etsy messages
        const imageBlocks = document.querySelectorAll('.wt-grid.wt-grid--block');

        imageBlocks.forEach(block => {
            // Check if this block contains images
            const imageLinks = block.querySelectorAll('a[href*="etsystatic.com/icm"]');

            // Check if container already exists for this block
            const nextElement = block.nextElementSibling;
            const hasContainer = nextElement && nextElement.classList.contains('etsy-download-all-container');

            if (imageLinks.length >= 2 && !hasContainer) {
                // Add "Download All" button
                const downloadAllBtn = document.createElement('button');
                downloadAllBtn.className = 'etsy-download-all-btn';
                downloadAllBtn.title = 'Download all images';
                downloadAllBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                `;

                downloadAllBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadAllImages(block);
                });

                // Position button below the block
                const container = document.createElement('div');
                container.className = 'etsy-download-all-container';
                container.appendChild(downloadAllBtn);

                // Safely insert after the block
                if (block.parentNode) {
                    block.parentNode.insertBefore(container, block.nextSibling);
                }
            }
        });
    }

    // Download all images in a block
    function downloadAllImages(block) {
        const imageLinks = block.querySelectorAll('a[href*="etsystatic.com/icm"]');

        imageLinks.forEach((link, index) => {
            // Delay each download slightly to avoid overwhelming the browser
            setTimeout(() => {
                const fullImageUrl = link.href.replace(/icm_\d+x\d+\./g, 'icm_fullxfull.');
                downloadImage(fullImageUrl);
            }, index * 300); // 300ms delay between downloads
        });
    }

})();
