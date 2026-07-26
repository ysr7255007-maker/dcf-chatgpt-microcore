/**
 * G1 Chrome Adapter - Content Script (chatgpt.com)
 *
 * Silent, read-only DOM observation (DORC compliant):
 *   - never mutates page state
 *   - never infers authoritative facts from the page; only reports
 *     observations to the service worker, which forwards them to companion
 *   - respects boundary state: NOT_OBSERVE => nothing is captured at all
 *
 * ChatGPT DOM contract used (verified against chatgpt.com 2026-07):
 *   - each message: [data-message-author-role="user"|"assistant"]
 *   - stable per-message id: data-message-id
 * If these attributes disappear, observation degrades to zero events; this
 * is recorded as an honest unknown, never guessed around.
 */
(function () {
    'use strict';

    const SCAN_INTERVAL_MS = 3000;
    const STABLE_SCANS_REQUIRED = 2; // text unchanged for N scans => final

    // conversation key: host + path identifies one ChatGPT conversation
    function conversationKey() {
        return location.host + location.pathname;
    }

    // G4 explicit binding: the platform conversation id is the /c/{id} path
    // segment. Extraction is literal — when the path carries no /c/{id}
    // (home page, new chat) the field is honestly null, never guessed.
    function extractConversationId(pathname) {
        const m = /^\/c\/([^\/?#]+)/.exec(pathname || '');
        return m ? m[1] : null;
    }

    // message_id -> { text, stableCount, sentFinal }
    const tracked = new Map();
    let currentKey = conversationKey();
    let boundaryState = 'OBSERVE_CURRENT_ONLY';

    function sendToWorker(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || {});
                });
            } catch (e) {
                resolve({ error: e.message });
            }
        });
    }

    async function refreshBoundary() {
        const res = await sendToWorker({
            type: 'dcf.get_boundary',
            conversation_key: currentKey
        });
        if (res && res.boundary_state) {
            boundaryState = res.boundary_state;
        }
    }

    /**
     * One observation pass: enumerate messages, report new/finalized ones.
     * Read-only; no DOM mutation of any kind.
     */
    function scan() {
        if (boundaryState === 'NOT_OBSERVE') {
            // Content zero residue: do not even read message text
            return;
        }

        const key = conversationKey();
        if (key !== currentKey) {
            // Navigated to another conversation: reset local tracking
            tracked.clear();
            currentKey = key;
            refreshBoundary();
            return;
        }

        const nodes = document.querySelectorAll('[data-message-author-role]');
        nodes.forEach((node) => {
            const role = node.getAttribute('data-message-author-role');
            const messageId = node.getAttribute('data-message-id');
            if (!messageId || (role !== 'user' && role !== 'assistant')) return;

            const text = (node.textContent || '').trim();
            if (text === '') return;

            const state = tracked.get(messageId);
            if (!state) {
                tracked.set(messageId, { text: text, stableCount: 0, sentFinal: false });
                return;
            }
            if (state.sentFinal) {
                // Message changed after being reported final => updated event
                if (state.text !== text) {
                    state.text = text;
                    state.stableCount = 0;
                    state.sentFinal = false;
                    reportMessage(role, messageId, text, 'conversation.message.updated');
                    state.sentFinal = true;
                }
                return;
            }
            if (state.text === text) {
                state.stableCount++;
                if (state.stableCount >= STABLE_SCANS_REQUIRED) {
                    state.sentFinal = true;
                    const eventType = role === 'user'
                        ? 'conversation.message.sent'
                        : 'conversation.message.received';
                    reportMessage(role, messageId, text, eventType);
                }
            } else {
                state.text = text;
                state.stableCount = 0;
            }
        });
    }

    function reportMessage(role, messageId, text, eventType) {
        // observation_key is stable across page reloads: same message +
        // same event type => same key => same event_id in the worker =>
        // duplicate delivery absorbed by companion (idempotency).
        const observationKey = messageId + ':' + eventType;
        sendToWorker({
            type: 'dcf.observation',
            conversation_key: currentKey,
            observation_key: observationKey,
            event_type: eventType,
            payload: {
                role: role,
                message_id: messageId,
                text: text,
                conversation_id: extractConversationId(location.pathname),
                conversation_path: location.pathname,
                observed_at: new Date().toISOString()
            }
        }).then((res) => {
            if (res && res.enqueued) {
                console.log('[DCF observe]', eventType, 'seq', res.sequence_number, 'id', res.event_id);
            } else if (res && res.reason && res.reason !== 'duplicate_observation') {
                console.log('[DCF observe] not enqueued:', res.reason);
            }
        });
    }

    // Periodic scan (survives SPA rerenders that MutationObserver may miss)
    setInterval(scan, SCAN_INTERVAL_MS);

    // MutationObserver triggers an early scan on DOM change (debounced)
    let scanTimer = null;
    const observer = new MutationObserver(() => {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            scan();
        }, 800);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Boundary refresh: at start and periodically (companion may have been
    // updated through the Surface toggle in the meantime)
    refreshBoundary();
    setInterval(refreshBoundary, 15000);

    console.log('[DCF observe] content script active on', currentKey);
})();
