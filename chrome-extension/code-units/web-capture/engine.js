/**
 * Web Capture Engine — 统一采集引擎（页面运行时，零依赖零 require）
 *
 * 职责（spec §3.5 统一算法）：
 * - 按当前 URL 选择站点适配器；conversationId(url) 为 null 时不采集、不上报无 ID 事件
 * - MutationObserver 观察 documentElement；messageSelectors 按序降级命中
 * - 基线语义：页面加载时已有消息只标记为已见（实时增量，历史由 data-import 覆盖）
 * - 流式完成检测：assistant 文本静默 >=1.5s 且 stopButtonSelectors 全部不存在 → 判完成，只入库一次
 * - 事件规范化为 CapturedEvent（source_id=站点前缀:会话ID, role, text, ts）
 * - 入库前过 assertCapturedEvent 笼子；经 chrome.runtime.sendMessage 交给背景 durable outbox
 * - SPA 导航：轮询 location.href，会话切换时重建基线会话
 *
 * 对外通信唯一通道：chrome.runtime.sendMessage({type:'web-capture.observation', ...})
 * 引擎零 require，由 tests/chrome-web-capture.unit.test.js 机器断言。
 */
(function (global) {
    'use strict';

    const CHECK = global.__DCF_WEB_CAPTURE_CHECK__;
    if (!CHECK) {
        console.error('[web-capture] runtime-check 未加载，引擎中止');
        return;
    }

    const SILENCE_THRESHOLD_MS = 1500;   // 流式判停：characterData 静默阈值
    const SCAN_DEBOUNCE_MS = 300;        // mutation 去抖
    const URL_POLL_MS = 1000;            // SPA URL 轮询
    const SEEN_CAP = 500;                // 每会话已见键上限
    const RETRY_FLUSH_MS = 5000;         // 发送失败重试间隔

    const adapters = new Map();          // host -> adapter
    const sessions = new Map();          // convKey -> session state
    let currentConvKey = null;
    let observer = null;
    let scanTimer = null;
    let urlTimer = null;
    let retryTimer = null;
    let lastUrl = location.href;
    const pendingOutbox = [];            // 发送失败暂存（内存，量小）
    const diagnostics = { emitted: 0, dropped_invalid: 0, send_failures: 0, baselined: 0 };

    function log(...args) { console.log('[web-capture]', ...args); }
    function warn(...args) { console.warn('[web-capture]', ...args); }

    // DOM 信标：main world 可读，用于验收诊断（isolated world 状态外显）
    function beacon(patch) {
        try {
            const el = document.documentElement;
            const prev = JSON.parse(el.getAttribute('data-dcf-web-capture') || '{}');
            el.setAttribute('data-dcf-web-capture', JSON.stringify(Object.assign(prev, patch, { at: Date.now() })));
        } catch (_) { /* 信标失败不影响采集 */ }
    }

    // djb2 文本散列（消息内容去重用，零依赖）
    function hashText(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    // ------------------------------------------------------------------
    // 适配器注册（index.js 加载期笼子之后调用）
    // ------------------------------------------------------------------
    function registerAdapter(adapter) {
        adapters.set(adapter.host, adapter);
    }

    function resolveAdapter() {
        const host = location.hostname.replace(/^www\./, '');
        for (const [adapterHost, adapter] of adapters) {
            if (host === adapterHost || host.endsWith('.' + adapterHost)) return adapter;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 会话状态
    // ------------------------------------------------------------------
    function getSession(convKey) {
        let s = sessions.get(convKey);
        if (!s) {
            s = {
                convKey,
                seenKeys: new Set(),          // observation_key 级别去重（有界）
                processedUser: new WeakSet(), // 已处理的 user 元素
                assistantState: new WeakMap(),// el -> {lastText, lastChange, emitted}
                userHashCount: new Map(),     // user 同文计数（observation_key 区分重复发送）
                baselineDone: false
            };
            sessions.set(convKey, s);
        }
        return s;
    }

    function rememberSeen(session, key) {
        session.seenKeys.add(key);
        if (session.seenKeys.size > SEEN_CAP) {
            const first = session.seenKeys.values().next().value;
            session.seenKeys.delete(first);
        }
    }

    // ------------------------------------------------------------------
    // 消息发现：选择器降级 + role 判定
    // ------------------------------------------------------------------
    function findMessageElements(adapter) {
        const found = [];
        const seenEl = new Set();
        for (const selector of adapter.messageSelectors) {
            let nodes;
            try { nodes = document.querySelectorAll(selector); } catch (_) { continue; }
            for (const el of nodes) {
                if (seenEl.has(el)) continue;
                seenEl.add(el);
                found.push(el);
            }
            if (found.length > 0) break; // 命中第一个存在的选择器层级即停（降级语义）
        }
        // 去重嵌套命中：同一逻辑消息被选择器内外层同时命中时只保留最外层，
        // 否则角色计数虚高（>1 轮误判为历史对话触发 baseline，真实新消息被吞）
        return found.filter((el) => !found.some((other) => other !== el && typeof other.contains === 'function' && other.contains(el)));
    }

    function stopButtonPresent(adapter) {
        const selectors = adapter.stopButtonSelectors || [];
        for (const sel of selectors) {
            try { if (document.querySelector(sel)) return true; } catch (_) { /* 非法选择器忽略 */ }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // 事件规范化 + 出库
    // ------------------------------------------------------------------
    function buildEvent(adapter, convId, role, text) {
        return {
            source_id: adapter.host + ':' + convId,
            role,
            text: text.trim(),
            ts: Date.now()
        };
    }

    function emit(adapter, session, convId, role, text, el) {
        const event = buildEvent(adapter, convId, role, text);
        try {
            CHECK.assertCapturedEvent(event); // 入库前笼子：非法丢弃并记诊断
        } catch (err) {
            diagnostics.dropped_invalid += 1;
            warn('事件非法，已丢弃:', err.message);
            return;
        }

        const messageId = typeof adapter.messageIdOf === 'function' ? safeMessageId(adapter, el) : null;
        let observationKey;
        if (messageId) {
            observationKey = role + ':' + messageId;
        } else if (role === 'user') {
            const h = hashText(text.slice(0, 512));
            const count = session.userHashCount.get(h) || 0;
            session.userHashCount.set(h, count + 1);
            observationKey = role + ':' + h + ':' + count;
        } else {
            observationKey = role + ':' + hashText(text.slice(0, 512));
        }
        if (session.seenKeys.has(observationKey)) return;
        rememberSeen(session, observationKey);

        const conversationKey = adapter.host + '/c/' + convId;
        const eventType = role === 'user' ? 'conversation.message.sent' : 'conversation.message.received';
        const payload = {
            role,
            text: event.text,
            ts: event.ts,
            site: adapter.host,
            conversation_id: convId,
            conversation_path: location.pathname,
            observation_key: observationKey,
            transport: 'web-capture'
        };
        sendObservation({
            conversation_key: conversationKey,
            observation_key: observationKey,
            event_type: eventType,
            payload
        });
        diagnostics.emitted += 1;
        beacon({ emitted: diagnostics.emitted, last_role: role, conv: convId });
    }

    function safeMessageId(adapter, el) {
        try { return adapter.messageIdOf(el) || null; } catch (_) { return null; }
    }

    function sendObservation(obs) {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
            pendingOutbox.push(obs);
            scheduleRetry();
            return;
        }
        chrome.runtime.sendMessage(Object.assign({ type: 'web-capture.observation' }, obs))
            .then(() => flushPending())
            .catch(() => {
                pendingOutbox.push(obs);
                diagnostics.send_failures += 1;
                scheduleRetry();
            });
    }

    function flushPending() {
        if (!pendingOutbox.length) return;
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
        const batch = pendingOutbox.splice(0, pendingOutbox.length);
        for (const obs of batch) sendObservation(obs);
    }

    function scheduleRetry() {
        if (retryTimer) return;
        retryTimer = setInterval(() => {
            if (!pendingOutbox.length) { clearInterval(retryTimer); retryTimer = null; return; }
            flushPending();
        }, RETRY_FLUSH_MS);
    }

    // ------------------------------------------------------------------
    // 扫描与流式判停
    // ------------------------------------------------------------------
    function scan(adapter, session, convId) {
        const elements = findMessageElements(adapter);
        const now = Date.now();
        beacon({ scan: convId, elements: elements.length, baseline_done: session.baselineDone });

        if (!session.baselineDone) {
            // 基线判定（spec：只采实时增量，历史由 data-import 覆盖）：
            // - 历史对话（>1 轮消息）：全部标记为已见不上报
            // - 新对话（<=1 轮，engine 存活期间创建）：走正常上报路径
            //   （发送首条消息后 SPA 才跳 /chat/{id}，消息是实时产生的）
            //   边界（仅 1 轮的历史对话被刷新）由 companion event_id 幂等吸收
            const roles = elements.map((el) => safeRole(adapter, el));
            const userCount = roles.filter((r) => r === 'user').length;
            const aiCount = roles.filter((r) => r === 'assistant').length;
            session.baselineDone = true;
            if (userCount > 1 || aiCount > 1) {
                for (const el of elements) {
                    const role = safeRole(adapter, el);
                    if (role !== 'user' && role !== 'assistant') continue;
                    // 不因 text 暂空跳过：元素既存即标记，防后续渲染完成被误报为增量
                    if (role === 'user') session.processedUser.add(el);
                    else session.assistantState.set(el, { lastText: safeText(adapter, el), lastChange: now, emitted: true });
                    diagnostics.baselined += 1;
                }
                beacon({ baseline: diagnostics.baselined });
                return;
            }
            // 新对话：落入正常处理路径
        }

        const stopped = stopButtonPresent(adapter);
        for (const el of elements) {
            const role = safeRole(adapter, el);
            if (role !== 'user' && role !== 'assistant') continue;
            const text = safeText(adapter, el);
            if (!text) continue;

            if (role === 'user') {
                if (session.processedUser.has(el)) continue;
                session.processedUser.add(el);
                emit(adapter, session, convId, 'user', text, el);
                continue;
            }

            // assistant：跟踪流式文本变化
            let st = session.assistantState.get(el);
            if (!st) {
                st = { lastText: '', lastChange: now, emitted: false };
                session.assistantState.set(el, st);
            }
            if (text !== st.lastText) {
                st.lastText = text;
                st.lastChange = now;
            }
            // 判停：静默 >=1.5s 且无停止按钮 → 入库一次
            if (!st.emitted && !stopped && now - st.lastChange >= SILENCE_THRESHOLD_MS) {
                st.emitted = true;
                emit(adapter, session, convId, 'assistant', st.lastText, el);
            }
        }
    }

    function safeRole(adapter, el) {
        try { return adapter.roleOf(el); } catch (_) { return null; }
    }
    function safeText(adapter, el) {
        try { return (adapter.textOf(el) || '').trim(); } catch (_) { return ''; }
    }

    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            tick();
        }, SCAN_DEBOUNCE_MS);
    }

    // 定期 tick：驱动流式判停（即使没有新 mutation）
    function tick() {
        const adapter = resolveAdapter();
        if (!adapter) return;
        const convId = safeConvId(adapter);
        if (!convId) return;
        const convKey = adapter.host + ':' + convId;
        if (convKey !== currentConvKey) return; // 由 URL 轮询负责切换
        scan(adapter, getSession(convKey), convId);
    }

    function safeConvId(adapter) {
        try {
            const id = adapter.conversationId(new URL(location.href));
            return typeof id === 'string' && id.length > 0 ? id : null;
        } catch (_) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // SPA 导航：URL 变化 → 切换会话并重建基线
    // ------------------------------------------------------------------
    function checkUrlChange() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        const adapter = resolveAdapter();
        if (!adapter) { currentConvKey = null; return; }
        const convId = safeConvId(adapter);
        currentConvKey = convId ? adapter.host + ':' + convId : null;
        if (currentConvKey) log('会话切换:', currentConvKey);
        beacon({ conv: currentConvKey });
        scheduleScan();
    }

    // ------------------------------------------------------------------
    // 生命周期
    // ------------------------------------------------------------------
    function start() {
        if (observer) return; // 幂等
        const adapter = resolveAdapter();
        if (!adapter) {
            log('当前站点无适配器:', location.hostname);
            return;
        }
        const convId = safeConvId(adapter);
        currentConvKey = convId ? adapter.host + ':' + convId : null;
        log('引擎启动 host=%s conv=%s', adapter.host, convId || '(待会话)');
        beacon({ started: true, host: adapter.host, conv: convId || null });

        observer = new MutationObserver(scheduleScan);
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        urlTimer = setInterval(checkUrlChange, URL_POLL_MS);
        // 周期性 tick 驱动流式判停
        setInterval(tick, 500);
        scheduleScan();
    }

    function stop() {
        if (observer) { observer.disconnect(); observer = null; }
        if (urlTimer) { clearInterval(urlTimer); urlTimer = null; }
        if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    }

    global.__DCF_WEB_CAPTURE_ENGINE__ = {
        registerAdapter,
        start,
        stop,
        diagnostics,
        adapterCount: () => adapters.size,
        _internals: { hashText, buildEvent } // 测试钩子（不依赖则勿用）
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
