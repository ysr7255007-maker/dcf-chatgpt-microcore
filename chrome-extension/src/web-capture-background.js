'use strict';
/**
 * Web Capture Background — 采集事件的 durable outbox 接线（MV3 service worker）
 *
 * 链路（spec §二 现状盘点对齐）：
 *   content script (web-capture engine)
 *     → chrome.runtime.sendMessage({type:'web-capture.observation', ...})
 *     → OutboxCore.recordObservation（source ULID 映射 / 边界 / 去重 / 序列号）
 *     → durable outbox（chrome.storage.local，容量 8）
 *     → alarms 冲刷 + 摄入后 opportunistic flush
 *     → POST companion /rpc/events/batch（失败回退 /rpc/events/ingest 逐条）
 *     → raw_events
 *
 * 消息由 host-main.handleMessage 委派（H.webCapture*），避免多 onMessage 监听器竞态。
 * ulid.js / outbox-core.js 由构建流程从 seed/adapters/chrome/ 逐字复制（单一事实源）。
 */
importScripts('ulid.js', 'outbox-core.js');

(function initWebCaptureBackground(root) {
    const H = root.DCFHost = root.DCFHost || {};

    const FLUSH_ALARM = 'dcf-web-capture-flush';
    const FLUSH_PERIOD_MINUTES = 0.5;

    const storage = {
        get(keys) { return chrome.storage.local.get(keys); },
        set(obj) { return chrome.storage.local.set(obj); }
    };

    const outbox = new root.DCF_OUTBOX.OutboxCore({
        storage,
        fetchFn: fetch.bind(root),
        ulid: root.DCF_ULID,
        log: console.log.bind(console, '[web-capture-bg]')
    });

    function ensureFlushAlarm() {
        chrome.alarms.get(FLUSH_ALARM, (alarm) => {
            if (!alarm) chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
        });
    }

    chrome.runtime.onInstalled.addListener(ensureFlushAlarm);
    chrome.runtime.onStartup.addListener(ensureFlushAlarm);
    ensureFlushAlarm();

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== FLUSH_ALARM) return;
        outbox.flush()
            .then((report) => console.log('[web-capture-bg] alarm flush:', JSON.stringify(report)))
            .catch((err) => console.warn('[web-capture-bg] alarm flush error:', err.message));
    });

    // host-main 委派：content script 摄入单条观测
    H.webCaptureRecordObservation = async function webCaptureRecordObservation(message) {
        const result = await outbox.recordObservation({
            conversation_key: String(message && message.conversation_key || ''),
            observation_key: String(message && message.observation_key || ''),
            event_type: String(message && message.event_type || ''),
            payload: message && message.payload || null
        });
        if (result.enqueued) {
            outbox.flush().catch(() => {}); // opportunistic flush；alarms 兜底
        }
        return { ok: true, result };
    };

    // host-main 委派：验收/诊断用手动冲刷
    H.webCaptureFlushNow = async function webCaptureFlushNow() {
        return { ok: true, result: await outbox.flush() };
    };

    // host-main 委派：验收/诊断用状态
    H.webCaptureStats = async function webCaptureStats() {
        return { ok: true, stats: await outbox.getStats() };
    };
})(self);
