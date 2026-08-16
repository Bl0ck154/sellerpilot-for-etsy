// agent_context_manager.js - Compact active-context orientation and conversation enrichment.
(() => {
    'use strict';

    if (!window.BaseAIService) return;

    const ACTIVE_FACTS_KEY = 'ETSY_AI_ACTIVE_CONTEXT_FACTS';
    const MAX_ASSISTANT_HISTORY_MESSAGES = 32;
    const FIRST_ASSISTANT_HISTORY_MESSAGES = 6;
    const MAX_ASSISTANT_MESSAGE_CHARS = 4000;
    const MAX_SNAPSHOT_MESSAGE_CHARS = 900;

    function trimText(value, maxChars = MAX_SNAPSHOT_MESSAGE_CHARS) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
    }

    function getLiveConversationId() {
        return location.pathname.match(/^\/messages\/(\d+)/)?.[1] || null;
    }

    function getMessageBody(message) {
        return trimText(
            message?.message_body || message?.message || message?.body || message?.text || ''
        );
    }

    function getSenderId(message) {
        return String(
            message?.sender_user_id || message?.sender_id || message?.user_id || message?.from_user_id || ''
        ).trim();
    }

    function participantRole(message, chatHistory) {
        const senderId = getSenderId(message);
        const customerId = String(chatHistory?.customer_user_id || '').trim();
        if (customerId && senderId) return customerId === senderId ? 'CUSTOMER' : 'OWNER';

        const roleText = `${message?.sender_type || ''} ${message?.role || ''} ${message?.author_role || ''}`
            .toLowerCase();
        if (/\b(buyer|customer)\b/.test(roleText)) return 'CUSTOMER';
        if (/\b(seller|shop|owner|merchant)\b/.test(roleText)) return 'OWNER';
        if (message?.is_customer === true) return 'CUSTOMER';
        if (message?.is_seller === true || message?.is_shop_member === true || message?.from_owner === true) {
            return 'OWNER';
        }
        return 'PARTICIPANT';
    }

    function messageTimestampMs(message) {
        const raw = Number(message?.create_date || message?.created_at || message?.timestamp || 0);
        if (!raw) return 0;
        return raw < 10_000_000_000 ? raw * 1000 : raw;
    }

    function formatTimestamp(message) {
        const ms = messageTimestampMs(message);
        if (!ms) return '';
        try { return new Date(ms).toLocaleString(); }
        catch (_) { return ''; }
    }

    function attachmentCount(message) {
        if (Array.isArray(message?.attachments)) return message.attachments.length;
        if (Array.isArray(message?.images)) return message.images.length;
        return message?.has_images ? 1 : 0;
    }

    async function storageGet(keys) {
        if (!chrome.runtime?.id) return {};
        try { return await chrome.storage.local.get(keys); }
        catch (error) {
            console.warn('AgentContext: storage read failed', error);
            return {};
        }
    }

    async function storageSet(values) {
        if (!chrome.runtime?.id) return false;
        try {
            await chrome.storage.local.set(values);
            return true;
        } catch (error) {
            console.warn('AgentContext: storage write failed', error);
            return false;
        }
    }

    function findLatestByRole(messages, chatHistory, role) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (participantRole(messages[index], chatHistory) === role) return messages[index];
        }
        return null;
    }

    function formatSnapshotMessage(label, message, chatHistory) {
        if (!message) return `${label}: none available`;
        const sender = trimText(message.sender_display_name || message.sender_name || '', 80);
        const time = formatTimestamp(message);
        const body = getMessageBody(message);
        const attachments = attachmentCount(message);
        return `${label}${sender ? ` (${sender})` : ''}${time ? ` [${time}]` : ''}: ` +
            `${body || '[no text]'}${attachments ? ` [${attachments} attachment(s)]` : ''}`;
    }

    async function buildActiveContextSnapshot() {
        const liveConvoId = getLiveConversationId();
        if (!liveConvoId) return '';

        const state = await storageGet([
            'ETSY_CHAT_HISTORY',
            'ETSY_CURRENT_LISTING_ID',
            ACTIVE_FACTS_KEY
        ]);
        const chatHistory = state.ETSY_CHAT_HISTORY || null;
        const storedConvoId = String(chatHistory?.convo_id || '').trim();
        const historyMatches = !!chatHistory?.messages?.length && storedConvoId === String(liveConvoId);

        let snapshot = '\n\n### ACTIVE_CONTEXT_SNAPSHOT\n';
        snapshot += '(Compact deterministic orientation for the currently open Etsy conversation. Use it as an index; raw conversation/listing/image sections remain authoritative. Never borrow data from a mismatched conversation.)\n';
        snapshot += `Live conversation: convo_id=${liveConvoId}\n`;

        if (!historyMatches) {
            snapshot += `Conversation data: not ready or mismatched (stored=${storedConvoId || 'none'}). Do not infer customer/order facts from stale storage.\n`;
            return snapshot;
        }

        const messages = chatHistory.messages || [];
        const latestCustomer = findLatestByRole(messages, chatHistory, 'CUSTOMER');
        const latestOwner = findLatestByRole(messages, chatHistory, 'OWNER');
        const latest = messages[messages.length - 1] || null;
        const latestRole = latest ? participantRole(latest, chatHistory) : 'UNKNOWN';
        const customerName = trimText(chatHistory.customer_display_name || '', 100) || 'unknown';
        const ageMs = Math.max(0, Date.now() - Number(chatHistory.timestamp || Date.now()));
        const totalAttachments = messages.reduce((sum, message) => sum + attachmentCount(message), 0);

        snapshot += `Customer: ${customerName}\n`;
        snapshot += `Conversation messages: ${messages.length}; context age: ${BaseAIService.INSTRUCTIONS.formatAge(ageMs)}; latest speaker: ${latestRole}\n`;
        snapshot += formatSnapshotMessage('Latest CUSTOMER message', latestCustomer, chatHistory) + '\n';
        snapshot += formatSnapshotMessage('Latest OWNER Etsy message', latestOwner, chatHistory) + '\n';
        snapshot += `Structured conversation attachments: ${totalAttachments}\n`;

        const listingId = String(state.ETSY_CURRENT_LISTING_ID || '').trim();
        if (listingId) {
            const listingState = await storageGet([`RAG_LISTING_${listingId}`]);
            const listing = listingState[`RAG_LISTING_${listingId}`];
            snapshot += `Active listing: listing_id=${listingId}${listing?.title ? ` — ${trimText(listing.title, 220)}` : ' (details not cached yet)'}\n`;
        } else {
            snapshot += 'Active listing: none resolved for this conversation\n';
        }

        const facts = state[ACTIVE_FACTS_KEY];
        if (facts?.convoId === String(liveConvoId)) {
            if (facts.receiptId) snapshot += `Current receipt: ${facts.receiptId}\n`;
            if (facts.transactionIds?.length) snapshot += `Current transaction id(s): ${facts.transactionIds.join(', ')}\n`;
        }

        const imageMetadata = window.ImageIntelligenceManager?.getMetadata?.();
        if (imageMetadata && Number.isFinite(Number(imageMetadata.imageIntelCount))) {
            snapshot += `Vision cache: ${Number(imageMetadata.imageIntelCount) || 0} analyzed image context item(s)` +
                `${imageMetadata.imageIntelErrors?.length ? `; ${imageMetadata.imageIntelErrors.length} recent analysis error(s)` : ''}\n`;
        }

        snapshot += 'Reasoning priority: answer the Owner\'s current request; use the latest Etsy corrections as current requirements; distinguish Owner↔assistant chat from Owner↔customer Etsy messages; consult listing, images, memory, and shop intelligence only when relevant.\n';
        return snapshot;
    }

    async function enrichDetailViewData(data) {
        const detail = data?.detail;
        if (!detail || !chrome.runtime?.id) return;

        const liveConvoId = getLiveConversationId();
        const convoId = String(detail.conversation_id || '').trim();
        if (!liveConvoId || convoId !== String(liveConvoId)) return;

        const state = await storageGet(['ETSY_GLOBAL_SHOP_ID']);
        const shopId = String(data.shop_id || detail.shop_id || state.ETSY_GLOBAL_SHOP_ID || '').trim();
        if (shopId && !state.ETSY_GLOBAL_SHOP_ID) {
            await storageSet({ ETSY_GLOBAL_SHOP_ID: shopId });
        }

        const receipt = detail.receipt_history?.[0] || null;
        const transactionIds = (receipt?.transactions || [])
            .map(item => item?.transaction_id)
            .filter(Boolean)
            .map(String);
        await storageSet({
            [ACTIVE_FACTS_KEY]: {
                convoId,
                receiptId: receipt?.receipt_id ? String(receipt.receipt_id) : null,
                transactionIds,
                updatedAt: Date.now()
            }
        });

        // The original interceptor historically reads detail.shop_id. Some Etsy payloads
        // expose shop_id at the response root instead. Only in that fallback shape, repair
        // the conversation with mission-control history so attachments/full history are not lost.
        if (detail.shop_id || !shopId || !receipt?.receipt_id) return;

        try {
            const response = await fetch(
                `https://www.etsy.com/api/v3/ajax/shop/${encodeURIComponent(shopId)}/mission-control/orders/convos/${encodeURIComponent(receipt.receipt_id)}`,
                {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
                }
            );
            if (!response.ok) return;
            const payload = await response.json();
            const fullMessages = Array.isArray(payload?.messages) ? payload.messages : [];
            if (!fullMessages.length) return;

            const normalized = fullMessages.map(message => ({
                ...message,
                attachments: message.attachments || message.images || []
            }));
            const latestState = await storageGet(['ETSY_CHAT_HISTORY']);
            const existing = latestState.ETSY_CHAT_HISTORY;
            if (existing && String(existing.convo_id || '') !== convoId) return;

            const existingMessages = existing?.messages || [];
            const existingAttachmentCount = existingMessages.reduce((sum, message) => sum + attachmentCount(message), 0);
            const enrichedAttachmentCount = normalized.reduce((sum, message) => sum + attachmentCount(message), 0);
            const isRicher = normalized.length > existingMessages.length || enrichedAttachmentCount > existingAttachmentCount;
            if (!isRicher) return;

            await storageSet({
                ETSY_CHAT_HISTORY: {
                    convo_id: convoId,
                    customer_display_name: String(detail.other_user?.display_name || existing?.customer_display_name || '').trim(),
                    customer_user_id: detail.other_user?.user_id
                        ? String(detail.other_user.user_id)
                        : (existing?.customer_user_id || null),
                    messages: normalized,
                    timestamp: Date.now()
                }
            });
            window.ShopIntelligenceManager?.maybeBootstrap?.('conversation_enriched');
            window.ImageIntelligenceManager?.analyzeCurrentCustomerImages?.().catch(() => {});
        } catch (error) {
            console.debug('AgentContext: optional conversation enrichment skipped', error?.message || error);
        }
    }

    window.addEventListener('message', event => {
        if (event.source !== window || event.data?.source !== 'etsy-page-interceptor') return;
        if (event.data?.type !== 'ETSY_DETAIL_VIEW_DATA') return;
        enrichDetailViewData(event.data.data).catch(error => {
            console.debug('AgentContext: detail-view enrichment failed', error?.message || error);
        });
    });

    const instructions = BaseAIService.INSTRUCTIONS;
    const originalBuildFullInstruction = instructions.buildFullInstruction;
    instructions.buildFullInstruction = async function (context) {
        const [baseInstruction, snapshot] = await Promise.all([
            originalBuildFullInstruction.call(this, context),
            buildActiveContextSnapshot()
        ]);
        if (!snapshot) return baseInstruction;

        const pageScopeIndex = baseInstruction.lastIndexOf('\n\n[PAGE_SCOPE:');
        if (pageScopeIndex === -1) return `${baseInstruction}${snapshot}`;
        return `${baseInstruction.slice(0, pageScopeIndex)}${snapshot}${baseInstruction.slice(pageScopeIndex)}`;
    };

    BaseAIService.prototype.buildConversationHistory = async function (userId, currentUserMessage) {
        const key = userId && String(userId).startsWith('current_chat_messages')
            ? String(userId)
            : 'current_chat_messages';
        const messages = [];

        try {
            const result = await chrome.storage.local.get([key]);
            const allHistory = (result[key] || []).filter(message => message?.type === 'user' || message?.type === 'ai');
            const history = allHistory.length <= MAX_ASSISTANT_HISTORY_MESSAGES
                ? allHistory
                : [
                    ...allHistory.slice(0, FIRST_ASSISTANT_HISTORY_MESSAGES),
                    ...allHistory.slice(-(MAX_ASSISTANT_HISTORY_MESSAGES - FIRST_ASSISTANT_HISTORY_MESSAGES))
                ];

            for (const message of history) {
                messages.push({
                    role: message.type === 'user' ? 'user' : 'assistant',
                    content: this.trimMessageText(message.text, MAX_ASSISTANT_MESSAGE_CHARS)
                });
            }
        } catch (error) {
            console.warn('AgentContext: failed to load assistant conversation history', error);
        }

        const currentContent = this.trimMessageText(currentUserMessage, MAX_ASSISTANT_MESSAGE_CHARS);
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== currentContent) {
            messages.push({ role: 'user', content: currentContent });
        }
        return messages;
    };

    window.AgentContextManager = {
        ACTIVE_FACTS_KEY,
        buildActiveContextSnapshot,
        enrichDetailViewData
    };
})();
