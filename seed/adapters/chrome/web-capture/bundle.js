/**
 * Web Capture Runtime Check — 页面侧轻量校验（零依赖，content script 可用）
 *
 * 与 contract.js（Node/zod 全量校验）同规则的手写实现（双层 contract）。
 * 任何一方的规则变更必须同步另一方，由 tests/chrome-web-capture.unit.test.js
 * 的 parity 断言保证：同一组非法输入必须同时被两侧拒绝。
 *
 * 暴露：globalThis.__DCF_WEB_CAPTURE_CHECK__
 *   - assertSiteAdapter(adapter)   加载期笼子：非法站点配置抛错
 *   - assertCapturedEvent(event)   入库前笼子：非法事件抛错
 */
(function (global) {
    'use strict';

    // 站点注册表容器（构建期拼接的站点赋值依赖此对象先行存在）
    global.__DCF_WEB_CAPTURE__ = global.__DCF_WEB_CAPTURE__ || {};

    function fail(message) { throw new Error('[web-capture contract] ' + message); }

    function assertSiteAdapter(adapter) {
        if (!adapter || typeof adapter !== 'object') fail('adapter must be an object');
        if (typeof adapter.host !== 'string' || adapter.host.length === 0) fail('host must be a non-empty string');
        if (!Array.isArray(adapter.matches) || adapter.matches.length < 1) fail('matches must be an array with at least 1 pattern');
        for (const pattern of adapter.matches) {
            if (typeof pattern !== 'string' || pattern.length === 0) fail('matches entries must be non-empty strings');
        }
        if (typeof adapter.conversationId !== 'function') fail('conversationId must be a function');
        if (!Array.isArray(adapter.messageSelectors) || adapter.messageSelectors.length < 2) {
            fail('messageSelectors must have at least 2 fallback candidates');
        }
        for (const selector of adapter.messageSelectors) {
            if (typeof selector !== 'string' || selector.length === 0) fail('messageSelectors entries must be non-empty strings');
        }
        if (typeof adapter.roleOf !== 'function') fail('roleOf must be a function');
        if (typeof adapter.textOf !== 'function') fail('textOf must be a function');
        if (adapter.messageIdOf !== undefined && typeof adapter.messageIdOf !== 'function') fail('messageIdOf must be a function when present');
        if (adapter.stopButtonSelectors !== undefined && !Array.isArray(adapter.stopButtonSelectors)) fail('stopButtonSelectors must be an array');
        if (adapter.verified !== undefined && typeof adapter.verified !== 'boolean') fail('verified must be a boolean');
        return adapter;
    }

    function assertCapturedEvent(event) {
        if (!event || typeof event !== 'object') fail('event must be an object');
        if (typeof event.source_id !== 'string' || !/^[a-z0-9.-]+:[A-Za-z0-9_-]+$/.test(event.source_id)) {
            fail('source_id must match 站点前缀:会话ID, got ' + JSON.stringify(event.source_id));
        }
        if (event.role !== 'user' && event.role !== 'assistant') {
            fail('role must be user|assistant, got ' + JSON.stringify(event.role));
        }
        if (typeof event.text !== 'string' || event.text.length === 0) {
            fail('text must be a non-empty string');
        }
        if (!Number.isInteger(event.ts) || event.ts <= 0) {
            fail('ts must be a positive integer');
        }
        return event;
    }

    const api = { assertSiteAdapter, assertCapturedEvent };
    global.__DCF_WEB_CAPTURE_CHECK__ = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);


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
 * 对外通信唯一通道：chrome.runtime.sendMessage({type:'dcf.observation', ...})
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
        chrome.runtime.sendMessage(Object.assign({ type: 'dcf.observation' }, obs))
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


const __SITE_CLAUDE_AI = {
  host: 'claude.ai',
  
  // Matches: /c/uuid pattern for conversations
  matches: [
    'https://*.claude.ai/*',
    'http://localhost:*/*'
  ],
  
  // conversationId: 会话 URL 为 /chat/{uuid}；/c/ 为旧形态兑底
  conversationId: function(url) {
    const path = url.pathname;
    const chatMatch = path.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    if (chatMatch) return chatMatch[1];
    const legacyMatch = path.match(/^\/c\/([A-Za-z0-9_-]+)/);
    if (legacyMatch) return legacyMatch[1];
    return null;
  },
  
  // Message container selectors (at least 2 candidates for fallback)
  messageSelectors: [
    '[data-message-role="assistant"] .prose',   // primary selector
    '[data-testid="message-assistant"] .text', // fallback
    '.chat-message-assistant p'                // tertiary
  ],
  
  // Determine role of a DOM element
  roleOf: function(el) {
    const roleAttr = el.getAttribute('data-message-role');
    if (roleAttr === 'user') return 'user';
    if (roleAttr === 'assistant') return 'assistant';
    
    // Fallback heuristics
    const parentRole = el.closest('[data-message-role]')?.getAttribute('data-message-role');
    if (parentRole === 'user') return 'user';
    if (parentRole === 'assistant') return 'assistant';
    
    return null;
  },
  
  // Extract text content from message element
  textOf: function(el) {
    // Get all text nodes, join and trim
    const texts = [];
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text) texts.push(text);
    }
    return texts.join(' ').trim();
  },
  
  // Stop button selectors for stream completion detection
  stopButtonSelectors: [
    '[aria-label="Stop generating"]',
    'button:contains("Stop")'
  ],
  
  verified: false // Must pass BrowserClaw acceptance before setting true
};const __SITE_DEEPSEEK = {
  host: 'chat.deepseek.com',

  matches: [
    'https://chat.deepseek.com/*',
    'https://*.deepseek.com/*'
  ],

  // /a/chat/s/{uuid} 提取会话 ID；/c/{id} 旧形态兜底
  conversationId: function (url) {
    let match = url.pathname.match(/^\/a\/chat\/s\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return null;
  },

  messageSelectors: [
    '.ds-message',
    '[class*="ds-message"]',
    '.fbb737a4'
  ],

  roleOf: function (el) {
    // 用户：元素自身或后代/祖先含 fbb737a4（用户文本类）
    if (el.matches && el.matches('.fbb737a4')) return 'user';
    if (el.querySelector && el.querySelector('.fbb737a4')) return 'user';
    if (el.closest && el.closest('.fbb737a4')) return 'user';
    if (el.matches && el.matches('[class*="d29f3d7d"]')) return 'user';
    // 助手：ds-message / ds-markdown 正文
    const cls = (el.className || '').toString();
    if (cls.includes('ds-message') || cls.includes('ds-markdown')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="ds-markdown"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    // 排除思维链与操作按钮
    clone.querySelectorAll('[class*="think"], [class*="reasoning"], button, [class*="action"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '已思考' && !line.startsWith('思考过程'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 816fea68-23be-45a4-9de7-a313a885d695，6/6 断言）
};const __SITE_DOUBAO = {
  host: 'doubao.com',

  matches: [
    'https://www.doubao.com/*',
    'https://*.doubao.com/*'
  ],

  // /chat/{id} 提取会话 ID；首页 /chat/ 无 ID 返回 null（不采集）
  conversationId: function (url) {
    const match = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // 消息级容器（降级：行容器 → 消息列表子级 → 用户气泡）
  messageSelectors: [
    '[class*="max-w-(--content-max-width)"]',
    '[class*="message-list"] > div',
    '[class*="bg-g-send-msg-bubble-bg"]'
  ],

  roleOf: function (el) {
    if (el.matches && el.matches('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    if (el.querySelector && el.querySelector('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    if (el.closest && el.closest('[class*="bg-g-send-msg-bubble-bg"]')) return 'user';
    // 排除快捷操作栏/建议区：按钮或链接文本占主导的容器不是消息
    const text = (el.textContent || '').replace(/\s+/g, '');
    if (!text) return null;
    const btnText = Array.from(el.querySelectorAll('button, a'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ''))
      .join('');
    if (btnText.length > 0 && btnText.length >= text.length * 0.6) return null;
    return 'assistant';
  },

  // 克隆排除法：去掉建议追问/登录引导/下载推广，取正文
  textOf: function (el) {
    const clone = el.cloneNode(true);
    const junk = clone.querySelectorAll('[class*="suggest-"], [class*="login"], a[href*="download"], [class*="download"], [class*="think"], [class*="Collapsible"], [class*="collapsible"]');
    junk.forEach((n) => n.remove());
    const text = (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('下载豆包') && line !== '已完成思考' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 38436223105438466，6/6 断言）
};const __SITE_GEMINI = {
  host: 'gemini.google.com',

  matches: [
    'https://gemini.google.com/*',
    'https://*.gemini.google.com/*'
  ],

  // /app/{id} 提取会话 ID；新对话首页 /app 无 ID 返回 null（不采集）
  conversationId: function (url) {
    const match = url.pathname.match(/^\/app\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // 消息级容器（自定义元素最稳定，class 降级兜底）
  messageSelectors: [
    'user-query, model-response',
    '[class*="user-query-container"], [class*="response-container"]',
    '[class*="query-content"], [class*="model-response"]'
  ],

  roleOf: function (el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'user-query') return 'user';
    if (tag === 'model-response') return 'assistant';
    const cls = (el.className || '').toString();
    if (cls.includes('user-query')) return 'user';
    if (cls.includes('response-container') || cls.includes('model-response')) return 'assistant';
    if (el.closest && el.closest('user-query')) return 'user';
    if (el.closest && el.closest('model-response')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    // 去掉「Gemini 说」「你说」无障碍播报前缀，保留正文
    const text = (el.textContent || '')
      .replace(/^\s*Gemini 说\s*/, '')
      .replace(/^\s*你说\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop-button"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（docs/acceptance/web-capture/gemini-acceptance.json）
};const __SITE_GROK = {
  host: 'grok.com',

  matches: [
    'https://grok.com/*',
    'https://*.grok.com/*'
  ],

  conversationId: function (url) {
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.message-bubble',
    '[data-role="user-message"], [data-role="assistant-message"]',
    '.response-content-markdown'
  ],

  roleOf: function (el) {
    // grok 用 data-role 标记角色（侦察实测：message-bubble 上 data-role="user-message"）
    const role = (el.getAttribute && (el.getAttribute('data-role') || el.getAttribute('data-testid') || el.getAttribute('role'))) || '';
    if (role.includes('user')) return 'user';
    if (role.includes('assistant')) return 'assistant';
    const parent = el.closest && (el.closest('[data-role]') || el.closest('[data-testid]'));
    const parentRole = parent ? (parent.getAttribute('data-role') || parent.getAttribute('data-testid') || '') : '';
    if (parentRole.includes('user')) return 'user';
    if (parentRole.includes('assistant')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="think"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 0fe7980f-c2a7-4091-9db6-1d14f5e6b590，6/6 断言）
};const __SITE_KIMI = {
  host: 'kimi.com',

  matches: [
    'https://www.kimi.com/*',
    'https://*.kimi.com/*',
    'https://*.kimi.moonshot.cn/*'
  ],

  // /chat/{uuid} 提取会话 ID；/messages/{id} 兼容；首页返回 null
  conversationId: function (url) {
    let match = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    match = url.pathname.match(/^\/messages\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return null;
  },

  messageSelectors: [
    '.chat-content-item-user, .chat-content-item-assistant',
    '.chat-content-item[class*="user"], .chat-content-item[class*="assistant"]',
    '.segment-user, .chat-content-item'
  ],

  roleOf: function (el) {
    const cls = ((el.className || '') + ' ' + (el.closest && el.closest('[class*="chat-content-item"]') ? el.closest('[class*="chat-content-item"]').className : '')).toString();
    if (cls.includes('user')) return 'user';
    if (cls.includes('assistant')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    // 排除思维链块与操作按钮区
    clone.querySelectorAll('[class*="thinking"], [class*="thought"], [class*="reasoning"], [class*="action"], button').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '思考已完成' && line !== '已完成思考' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 19faf17e-6242-8a5a-8000-0928b04dce6f，6/6 断言）
};const __SITE_MINIMAX = {
  host: 'agent.minimaxi.com',

  matches: [
    'https://agent.minimaxi.com/*',
    'https://*.minimaxi.com/*'
  ],

  // 会话 ID 在 ?id= 查询参数；无则返回 null
  conversationId: function (url) {
    const id = url.searchParams.get('id');
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  },

  messageSelectors: [
    '.message-container-user-text, .message-animate-in',
    '[class*="message-container-user"], [class*="message-animate-in"]',
    '.message-container-chat-content [class*="message"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    // 自身或后代含用户文本容器 → user（兼容最外层去重后的容器元素）
    if (cls.includes('message-container-user')) return 'user';
    if (el.querySelector && el.querySelector('[class*="message-container-user"]')) return 'user';
    if (el.closest && el.closest('[class*="message-container-user"]')) return 'user';
    if (cls.includes('message-animate-in')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="message-animate-in"]')) return 'assistant';
    if (el.closest && el.closest('[class*="message-animate-in"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="think"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^\d{2}:\d{2}$/.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*\d{2}:\d{2}$/, '')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 425157680432342，6/6 断言）
};const __SITE_XIAOMIMIMO = {
  host: 'aistudio.xiaomimimo.com',

  matches: [
    'https://aistudio.xiaomimimo.com/*',
    'https://*.xiaomimimo.com/*'
  ],

  // hash 路由提取会话 ID：#/chat/{hex}
  conversationId: function (url) {
    const match = (url.hash || '').match(/#\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.bg-mimo-bg-message, .markdown-prose',
    '[class*="bg-mimo-bg-message"], [class*="Markdown_markdown"]',
    '[class*="markdown-prose"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    if (cls.includes('bg-mimo-bg-message')) return 'user';
    if (el.querySelector && el.querySelector('[class*="bg-mimo-bg-message"]')) return 'user';
    if (el.closest && el.closest('[class*="bg-mimo-bg-message"]')) return 'user';
    if (cls.includes('markdown-prose') || cls.includes('Markdown_markdown')) return 'assistant';
    if (el.querySelector && el.querySelector('[class*="markdown-prose"], [class*="Markdown_markdown"]')) return 'assistant';
    if (el.closest && el.closest('[class*="markdown-prose"], [class*="Markdown_markdown"]')) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"], [class*="Collapsible"], [class*="collapsible"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('已深度思考') && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="停止"]',
    '[class*="stop"]',
    '[data-testid*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv 957943e69161854490547ddaebb4f43a，6/6 断言）
};const __SITE_YUANBAO = {
  host: 'yuanbao.tencent.com',
  
  matches: [
    'https://*.yuanbao.tencent.com/*',
    'http://localhost:*/*'
  ],
  
  // conversationId: extract from URL or localStorage
  conversationId: function(url) {
    const path = url.pathname;
    // Pattern: /chat/{chat_id} or /conv/{conversation_id}
    let match = path.match(/^\/chat\/([A-Za-z0-9_-]+)$/);
    if (match && match[1]) return match[1];
    
    match = path.match(/^\/conv\/([A-Za-z0-9_-]+)$/);
    if (match && match[1]) return match[1];
    
    // Fallback to localStorage/sessionStorage
    try {
      const currentConv = window.localStorage?.getItem('current_conversation');
      if (currentConv && currentConv !== 'null') return currentConv;
    } catch (e) {
      // Storage unavailable
    }
    
    return null;
  },
  
  messageSelectors: [
    '[class*="message-user"] .bubble-text',      // user messages
    '[class*="message-ai"] .bubble-text',          // AI responses
    '.user-bubble .text',                          // fallback user
    '.assistant-bubble .text'                       // fallback assistant
  ],
  
  roleOf: function(el) {
    if (el.closest('[class*="message-user"]')) return 'user';
    if (el.closest('[class*="message-ai"]')) return 'assistant';
    
    const parentClass = el.closest('div')?.className || '';
    if (parentClass.includes('user-bubble')) return 'user';
    if (parentClass.includes('assistant-bubble')) return 'assistant';
    if (parentClass.includes('me-message')) return 'user';
    if (parentClass.includes('tao-message')) return 'assistant';
    
    return null;
  },
  
  textOf: function(el) {
    let text = el.textContent.trim();
    // Remove UI elements, emojis, formatting artifacts
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 3) return '';
    return text;
  },
  
  stopButtonSelectors: [
    'button:contains("停止")',
    'button[aria-label*="stop"]',
    '[class*="stop-btn"]',
    '.stop-button'
  ],
  
  verified: false
};const __SITE_Z_AI = {
  host: 'chat.z.ai',

  matches: [
    'https://chat.z.ai/*',
    'https://*.z.ai/*'
  ],

  conversationId: function (url) {
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },

  messageSelectors: [
    '.user-message, div[class*="message-"]',
    '.chat-user, [class*="message-"]',
    '[class*="markdown-prose"]'
  ],

  roleOf: function (el) {
    const cls = (el.className || '').toString();
    if (cls.includes('user-message') || cls.includes('chat-user')) return 'user';
    if (el.closest && el.closest('.user-message, .chat-user')) return 'user';
    if (/message-[a-f0-9]{8}/.test(cls)) return 'assistant';
    return null;
  },

  textOf: function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [class*="action"], [class*="toolbar"]').forEach((n) => n.remove());
    return (clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '正在思考' && line !== '跳过' && line !== '思考已完成' && !line.startsWith('思考中'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  stopButtonSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    '[class*="stop"]'
  ],

  verified: true // 2026-07-29 BrowserClaw 验收通过（conv c434f3f0-a22f-4a59-9091-2c0def764bbf，6/6 断言）
};
(function(g){ g.__DCF_WEB_CAPTURE__ = g.__DCF_WEB_CAPTURE__ || {}; const __DCF_WEB_CAPTURE__ = g.__DCF_WEB_CAPTURE__;
__DCF_WEB_CAPTURE__["claude-ai"] = __SITE_CLAUDE_AI;
__DCF_WEB_CAPTURE__["deepseek"] = __SITE_DEEPSEEK;
__DCF_WEB_CAPTURE__["doubao"] = __SITE_DOUBAO;
__DCF_WEB_CAPTURE__["gemini"] = __SITE_GEMINI;
__DCF_WEB_CAPTURE__["grok"] = __SITE_GROK;
__DCF_WEB_CAPTURE__["kimi"] = __SITE_KIMI;
__DCF_WEB_CAPTURE__["minimax"] = __SITE_MINIMAX;
__DCF_WEB_CAPTURE__["xiaomimimo"] = __SITE_XIAOMIMIMO;
__DCF_WEB_CAPTURE__["yuanbao"] = __SITE_YUANBAO;
__DCF_WEB_CAPTURE__["z-ai"] = __SITE_Z_AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/**
 * Web Capture Entry — code-unit 入口（页面运行时）
 *
 * 加载期笼子（spec §3.3 强约束 + 隔离）：
 * - 逐个读取构建期注入的站点适配器（__DCF_WEB_CAPTURE__['<site>']）
 * - 每个适配器过 assertSiteAdapter；坏配置抛错并隔离，不影响其余站点
 * - 合法适配器注册进引擎；最后启动统一采集引擎
 *
 * 可丢弃：站点文件就是 contract 的实现体，AI 可按 contract 整体重写单站点，
 * 不需要动 engine / runtime-check / 本入口。
 */
(function (global) {
    'use strict';

    const CHECK = global.__DCF_WEB_CAPTURE_CHECK__;
    const ENGINE = global.__DCF_WEB_CAPTURE_ENGINE__;
    const REGISTRY = global.__DCF_WEB_CAPTURE__;

    if (!CHECK || !ENGINE || !REGISTRY) {
        console.error('[web-capture] runtime-check/engine/registry 未就绪，入口中止');
        return;
    }

    const SITE_KEYS = ['claude-ai', 'gemini', 'doubao', 'kimi', 'deepseek', 'yuanbao', 'grok', 'z-ai', 'minimax', 'xiaomimimo'];

    let loaded = 0;
    let isolated = 0;

    for (const key of SITE_KEYS) {
        const candidate = REGISTRY[key];
        try {
            CHECK.assertSiteAdapter(candidate); // 加载期笼子：坏配置抛错
            ENGINE.registerAdapter(candidate);
            loaded += 1;
        } catch (err) {
            isolated += 1;
            console.error(`[web-capture] 隔离非法站点配置 ${key}:`, err.message);
            // 只隔离该站点，继续加载其他 —— 隔离优先
        }
    }

    console.log(`[web-capture] 适配器加载完成 loaded=${loaded} isolated=${isolated}`);

    if (loaded > 0) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => ENGINE.start(), { once: true });
        } else {
            ENGINE.start();
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);

