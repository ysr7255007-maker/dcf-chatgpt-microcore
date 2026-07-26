/**
 * G1 Chrome Adapter - Service Worker (MV3, classic worker)
 *
 * Thin glue over OutboxCore:
 *   - chrome.storage.local as the durable store
 *   - chrome.alarms drives periodic non-blocking flush + boundary sync
 *   - chrome.runtime messages from the content script feed observations
 *
 * The outbox is transport custody only; the companion (localhost:8472) is
 * the single authoritative writer of material facts.
 */

importScripts('ulid.js', 'outbox-core.js');

const FLUSH_ALARM = 'dcf-outbox-flush';
const FLUSH_PERIOD_MINUTES = 0.5;

// chrome.storage.local adapter matching the OutboxCore storage contract
const storage = {
    get(keys) {
        return chrome.storage.local.get(keys);
    },
    set(obj) {
        return chrome.storage.local.set(obj);
    }
};

const outbox = new DCF_OUTBOX.OutboxCore({
    storage: storage,
    fetchFn: fetch.bind(globalThis),
    ulid: DCF_ULID,
    log: console.log.bind(console, '[DCF SW]')
});

/**
 * Ensure the periodic flush alarm exists. MV3 alarms survive service worker
 * termination, so this is safe to call on every wake-up.
 */
function ensureAlarm() {
    chrome.alarms.get(FLUSH_ALARM, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
            console.log('[DCF SW] flush alarm created, period(min):', FLUSH_PERIOD_MINUTES);
        }
    });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== FLUSH_ALARM) return;
    // Non-blocking: failures stay in the outbox for the next cycle
    outbox.flush()
        .then((report) => console.log('[DCF SW] alarm flush:', JSON.stringify(report)))
        .catch((err) => console.warn('[DCF SW] alarm flush error:', err.message));
    outbox.syncBoundariesFromCompanion()
        .catch((err) => console.warn('[DCF SW] boundary sync error:', err.message));
});

/**
 * Message API for the content script.
 * All handlers respond asynchronously; `return true` keeps the port open.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.type !== 'string') return false;

    if (request.type === 'dcf.observation') {
        outbox.recordObservation({
            conversation_key: request.conversation_key,
            observation_key: request.observation_key,
            event_type: request.event_type,
            payload: request.payload || null
        }).then((result) => {
            // Opportunistic flush right after intake so events reach the
            // companion quickly when it is reachable; alarm remains the
            // guaranteed retry path.
            if (result.enqueued) {
                outbox.flush().catch(() => {});
            }
            sendResponse(result);
        }).catch((err) => {
            sendResponse({ enqueued: false, reason: 'error: ' + err.message });
        });
        return true;
    }

    if (request.type === 'dcf.get_boundary') {
        outbox.ensureSource(request.conversation_key)
            .then((sourceId) => outbox.getBoundary(sourceId)
                .then((state) => sendResponse({ source_id: sourceId, boundary_state: state })))
            .catch((err) => sendResponse({ error: err.message }));
        return true;
    }

    if (request.type === 'dcf.get_stats') {
        outbox.getStats()
            .then((stats) => sendResponse(stats))
            .catch((err) => sendResponse({ error: err.message }));
        return true;
    }

    if (request.type === 'dcf.flush_now') {
        outbox.flush()
            .then((report) => sendResponse(report))
            .catch((err) => sendResponse({ error: err.message }));
        return true;
    }

    return false;
});

console.log('[DCF SW] service worker loaded');
