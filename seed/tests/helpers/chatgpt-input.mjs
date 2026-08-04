#!/usr/bin/env node
// ChatGPT 输入注入唯一真值源（Tier 2/3 共用，ESM，零 npm 依赖）。
//
// 背景（为什么存在这个文件）：
//   旧"真实 E2E"使用 BrowserClaw act(fill) 只改 contenteditable 的 DOM 文本，
//   不触发 React 受控状态 → 消息从未真实发送 → 测试读预存旧消息冒充成功。
//   本模块是输入注入的唯一入口：所有测试必须经由这里注入文本，且每一步
//   失败都显式 throw，绝不静默。
//
// exec 契约（适配 CDP Runtime.evaluate 或 BrowserClaw evaluate 工具）：
//   async exec(expression: string) => any
//   - expression 是一个页内 JS 表达式（本模块只生成 IIFE 表达式），
//     求值结果必须以 JSON 可序列化的值返回给 Node 侧。
//   - CDP 适配：Runtime.evaluate({ expression, returnByValue: true })
//     → result.result.value
//   - BrowserClaw 适配：把 expression 包成 () => { return (expression); }
//     交给 evaluate 工具，解析其返回的 JSON。
//
// 方法优先级（g3 证据 B3 已证明 execCommand 路径有效）：
//   (1) 聚焦后 document.execCommand('insertText', false, text)
//       —— contenteditable 首选，走浏览器编辑管线，React 能收到 input 事件，
//          且不触发提交（多行文本不会像 act(fill)+Enter 那样被截断发送）。
//   (2) contenteditable 降级：innerText 赋值 +
//       dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))
//   (3) textarea/input：原型链 value setter
//       Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text)
//       + input/change 事件（绕过 React 对实例属性的劫持）。

// 与 seed/adapters/chrome/content.js 一致的消息选择器契约
export const SELECTORS = Object.freeze({
    message: '[data-message-author-role]',
    assistantMessage: '[data-message-author-role="assistant"]',
    messageIdAttr: 'data-message-id',
    // ChatGPT composer 候选（依次尝试）
    composerCandidates: [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'textarea[data-testid="prompt-textarea"]',
        'textarea'
    ],
    // 发送按钮候选（依次尝试）
    sendButtonCandidates: [
        '[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]'
    ]
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 页内公共工具函数（以源码字符串形式拼进每个 IIFE，保持 exec 单表达式契约）
const PAGE_UTILS = `
    const isVisible = (el) => {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const findFirst = (sels) => {
        for (const s of sels) {
            const el = document.querySelector(s);
            if (el && isVisible(el)) return { el, selector: s };
        }
        return { el: null, selector: null };
    };
    const isEditable = (el) => !!el && (el.isContentEditable || el.getAttribute('contenteditable') === 'true');
    const readComposer = (el) => isEditable(el) ? (el.innerText || el.textContent || '') : (el.value || '');
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
`;

/**
 * 把文本注入 ChatGPT composer（不触发提交）。
 * @param {(expr: string) => Promise<any>} exec 页内求值回调（见文件头 exec 契约）
 * @param {string} text 待注入文本
 * @param {object} [opts]
 * @param {string[]} [opts.composerSelectors] 覆盖 composer 候选选择器
 * @returns {Promise<{ok: true, method: string, selector: string, readBackLength: number}>}
 * @throws 所有策略失败时抛错（附带各策略失败原因），绝不静默
 */
export async function injectText(exec, text, opts = {}) {
    if (typeof exec !== 'function') throw new Error('injectText: exec 必须是函数');
    if (typeof text !== 'string' || text.length === 0) throw new Error('injectText: text 必须是非空字符串');
    const selectors = opts.composerSelectors || SELECTORS.composerCandidates;

    const expr = `(() => {
        ${PAGE_UTILS}
        const text = ${JSON.stringify(text)};
        const target = norm(text);
        const { el, selector } = findFirst(${JSON.stringify(selectors)});
        if (!el) return { ok: false, error: 'composer not found', tried: ${JSON.stringify(selectors)} };
        el.focus();
        const attempts = [];
        const readBack = () => readComposer(el);
        const settled = () => norm(readBack()).includes(target);

        if (isEditable(el)) {
            // 方法 1：execCommand insertText（先全选，替换旧内容；不触发提交）
            try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);
                const applied = document.execCommand('insertText', false, text);
                if (applied && settled()) {
                    return { ok: true, method: 'execCommand.insertText', selector, readBackLength: readBack().length };
                }
                attempts.push('execCommand.insertText: applied=' + applied + ', readBack mismatch');
            } catch (e) { attempts.push('execCommand.insertText: ' + e.message); }

            // 方法 2：contenteditable 降级（innerText + InputEvent）
            try {
                el.innerText = text;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                if (settled()) {
                    return { ok: true, method: 'contenteditable.innerText+InputEvent', selector, readBackLength: readBack().length };
                }
                attempts.push('contenteditable fallback: readBack mismatch');
            } catch (e) { attempts.push('contenteditable fallback: ' + e.message); }

            return { ok: false, error: 'all contenteditable strategies failed', attempts, readBackHead: readBack().slice(0, 200) };
        }

        // 方法 3：textarea/input 原型链 value setter（绕过 React 实例属性劫持）
        try {
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            desc.set.call(el, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (settled()) {
                return { ok: true, method: 'nativeValueSetter', selector, readBackLength: readBack().length };
            }
            attempts.push('nativeValueSetter: readBack mismatch');
        } catch (e) { attempts.push('nativeValueSetter: ' + e.message); }

        return { ok: false, error: 'all strategies failed', attempts, readBackHead: readBack().slice(0, 200) };
    })()`;

    const report = await expectObject(exec, expr, 'injectText');
    if (!report.ok) {
        throw new Error('injectText 失败: ' + JSON.stringify(report));
    }
    return report;
}

/**
 * 回读输入区，验证内容完整且发送按钮真实 enabled。
 * 内容比较做空白归一化（contenteditable 会引入结构性空白，g3 证据已记录）。
 * @param {(expr: string) => Promise<any>} exec
 * @param {string} expectedText 期望完整出现在输入区的文本
 * @returns {Promise<{ok: true, composerLength: number, buttonSelector: string}>}
 * @throws 内容不完整或按钮不可用时抛错（附页面实况），绝不静默
 */
export async function verifyInputReady(exec, expectedText) {
    if (typeof expectedText !== 'string' || expectedText.length === 0) {
        throw new Error('verifyInputReady: expectedText 必须是非空字符串');
    }
    const expr = `(() => {
        ${PAGE_UTILS}
        const expected = norm(${JSON.stringify(expectedText)});
        const { el, selector } = findFirst(${JSON.stringify(SELECTORS.composerCandidates)});
        const composerText = el ? readComposer(el) : null;
        const textComplete = el ? norm(composerText).includes(expected) : false;
        const { el: btn, selector: btnSelector } = findFirst(${JSON.stringify(SELECTORS.sendButtonCandidates)});
        const btnEnabled = !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && !btn.hasAttribute('disabled');
        return {
            composerFound: !!el, composerSelector: selector,
            composerLength: composerText === null ? 0 : composerText.length,
            composerHead: composerText === null ? null : composerText.slice(0, 200),
            textComplete,
            buttonFound: !!btn, buttonSelector: btnSelector, buttonEnabled: btnEnabled
        };
    })()`;

    const state = await expectObject(exec, expr, 'verifyInputReady');
    if (!state.composerFound) {
        throw new Error('verifyInputReady 失败: composer 未找到，候选=' + JSON.stringify(SELECTORS.composerCandidates));
    }
    if (!state.textComplete) {
        throw new Error('verifyInputReady 失败: 输入区内容不完整（可能只改了 DOM 未进入编辑器状态）。实况=' + JSON.stringify(state));
    }
    if (!state.buttonFound) {
        throw new Error('verifyInputReady 失败: 发送按钮未找到，候选=' + JSON.stringify(SELECTORS.sendButtonCandidates));
    }
    if (!state.buttonEnabled) {
        throw new Error('verifyInputReady 失败: 发送按钮存在但未 enabled —— 说明输入未被页面真实接收（React 状态未更新）。实况=' + JSON.stringify(state));
    }
    return { ok: true, composerLength: state.composerLength, buttonSelector: state.buttonSelector };
}

/**
 * 点击真实发送按钮。
 * @param {(expr: string) => Promise<any>} exec
 * @returns {Promise<{ok: true, buttonSelector: string}>}
 * @throws 按钮缺失或 disabled 时抛错
 */
export async function clickSend(exec) {
    const expr = `(() => {
        ${PAGE_UTILS}
        const { el: btn, selector } = findFirst(${JSON.stringify(SELECTORS.sendButtonCandidates)});
        if (!btn) return { ok: false, error: 'send button not found' };
        const enabled = !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && !btn.hasAttribute('disabled');
        if (!enabled) return { ok: false, error: 'send button disabled' };
        btn.click();
        return { ok: true, buttonSelector: selector };
    })()`;

    const report = await expectObject(exec, expr, 'clickSend');
    if (!report.ok) throw new Error('clickSend 失败: ' + JSON.stringify(report));
    return report;
}

/**
 * 读取当前所有消息（content.js 同款契约）。
 * @param {(expr: string) => Promise<any>} exec
 * @returns {Promise<Array<{role: string, messageId: string|null, text: string}>>}
 */
export async function readMessages(exec) {
    const expr = `(() => {
        const nodes = document.querySelectorAll(${JSON.stringify(SELECTORS.message)});
        return Array.from(nodes)
            .map(n => ({
                role: n.getAttribute('data-message-author-role'),
                messageId: n.getAttribute('data-message-id'),
                text: (n.textContent || '').trim()
            }))
            .filter(m => m.role === 'user' || m.role === 'assistant');
    })()`;
    const messages = await exec(expr);
    if (!Array.isArray(messages)) {
        throw new Error('readMessages 失败: 页面返回非数组: ' + JSON.stringify(messages));
    }
    return messages;
}

/**
 * 等待新的 assistant 回复：跳过占位符节点（如"正在思考"），通过多信号判定真实回复：
 *   (a) 出现不含 placeholder 的 assistant message_id 且文本非空，短稳定窗口内不变；
 *   (b) 发送按钮恢复可点击状态（replyStarted 且 sawButtonBusy 后再启用）；
 *   (c) 文本长度 > 阈值且长稳定窗口内不变。
 * 超时从 60s 提升至 120s（o-系列模型思考可能较长）。轮询间隔保持 1s。
 * @param {(expr: string) => Promise<any>} exec
 * @param {object} opts
 * @param {number} opts.baselineCount 发送前 assistant 消息数量（必填）
 * @param {number} [opts.timeoutMs=120000]
 * @returns {Promise<{count: number, text: string, messageId: string|null}>}
 * @throws 超时抛错（附占位符诊断与最后观测状态）
 */
export async function waitForNewAssistantReply(exec, { baselineCount, timeoutMs = 120000 } = {}) {
    if (!Number.isInteger(baselineCount) || baselineCount < 0) {
        throw new Error('waitForNewAssistantReply: baselineCount 必须是非负整数');
    }
    const POLL_MS = 1000;
    const STABLE_SHORT_MS = 2000;      // 信号 (a) 短稳定窗口
    const STABLE_LONG_MS = 5000;       // 信号 (c) 长稳定窗口 + 长度阈值
    const TEXT_LEN_THRESHOLD = 10;     // 信号 (c) 文本长度阈值
    const expr = `(() => {
        const nodes = document.querySelectorAll(${JSON.stringify(SELECTORS.assistantMessage)});
        const arr = Array.from(nodes).map(n => ({
            messageId: n.getAttribute('data-message-id'),
            text: (n.textContent || '').trim()
        }));
        const last = arr.length ? arr[arr.length - 1] : null;
        // realReply = 最后一个不含 placeholder 且文本非空的 assistant 消息
        let realReply = null;
        for (let i = arr.length - 1; i >= 0; i--) {
            const m = arr[i];
            if (m.messageId && !/placeholder/i.test(m.messageId) && m.text) { realReply = m; break; }
        }
        // 发送按钮状态（用于信号 b：流式完成）
        const btn = document.querySelector(${JSON.stringify(SELECTORS.sendButtonCandidates[0])});
        const btnEnabled = !!btn && !btn.disabled 
            && btn.getAttribute('aria-disabled') !== 'true' 
            && !btn.hasAttribute('disabled');
        return {
            count: arr.length,
            lastMessageId: last ? last.messageId : null,
            lastText: last ? last.text : null,
            realReplyMessageId: realReply ? realReply.messageId : null,
            realReplyText: realReply ? realReply.text : null,
            sendButtonFound: !!btn,
            sendButtonEnabled: btnEnabled
        };
    })()`;

    const start = Date.now();
    let replyStarted = false;          // count > baseline 已观测（placeholder 或 realReply 开始）
    let sawButtonBusy = false;         // 曾观测到按钮不可用（transitioned to busy）
    let realStableSnap = null;         // {text, messageId} for signal (a)
    let realStableSince = 0;
    let longStableSnap = null;
    let longStableSince = 0;
    let lastObs = null;
    let sawPlaceholder = null;         // {messageId, text} for timeout diagnostic

    while (Date.now() - start < timeoutMs) {
        const cur = await exec(expr);
        lastObs = cur;
        if (cur && typeof cur.count === 'number' && cur.count > baselineCount) {
            if (!replyStarted) { replyStarted = true; }
            
            // 跟踪占位符（用于超时诊断）
            if (cur.lastMessageId && /placeholder/i.test(cur.lastMessageId)) {
                sawPlaceholder = { messageId: cur.lastMessageId, text: (cur.lastText || '').slice(0, 80) };
            }
            
            // 信号 (b)：发送按钮恢复可点击（streaming done）—— 需先看到按钮 busy/absent
            if (replyStarted && sawButtonBusy && cur.sendButtonEnabled && cur.realReplyText) {
                return { count: cur.count, text: cur.realReplyText, messageId: cur.realReplyMessageId };
            }
            if (replyStarted && !cur.sendButtonEnabled) { sawButtonBusy = true; }
            
            const realText = cur.realReplyText || null;
            const realId = cur.realReplyMessageId || null;
            
            // 信号 (a)：出现非占位符且非空的 assistant 回复，短稳定窗口内不变
            if (realText && realId) {
                const sameShort = realStableSnap && realStableSnap.text === realText && realStableSnap.messageId === realId;
                if (sameShort) {
                    if (Date.now() - realStableSince >= STABLE_SHORT_MS) {
                        return { count: cur.count, text: realText, messageId: realId };
                    }
                } else {
                    realStableSnap = { text: realText, messageId: realId };
                    realStableSince = Date.now();
                }
                
                // 信号 (c)：文本长度 > 阈值且长稳定窗口不变
                if (realText.length > TEXT_LEN_THRESHOLD) {
                    const sameLong = longStableSnap && longStableSnap.text === realText;
                    if (sameLong) {
                        if (Date.now() - longStableSince >= STABLE_LONG_MS) {
                            return { count: cur.count, text: realText, messageId: realId };
                        }
                    } else {
                        longStableSnap = { text: realText };
                        longStableSince = Date.now();
                    }
                }
            }
        }
        await sleep(POLL_MS);
    }
    
    // 超时：如实报告，附占位符诊断（若有）
    const ph = sawPlaceholder ? `占位符 message_id=${sawPlaceholder.messageId}, 文本片段="${sawPlaceholder.text}"。` : '';
    throw new Error(
        `waitForNewAssistantReply 超时 (${timeoutMs}ms): 未捕获到真实 assistant 回复（非占位符、文本非空、稳定或发送按钮恢复）。` +
        `基线=${baselineCount}。${ph}最后观测=${JSON.stringify(lastObs)}`
    );
}

// 内部：执行 exec 并要求返回一个对象（对不合契约的返回显式报错）
async function expectObject(exec, expr, label) {
    const value = await exec(expr);
    if (!value || typeof value !== 'object') {
        throw new Error(`${label} 失败: exec 返回非对象值（检查 exec 适配器是否 returnByValue/解析 JSON）: ${JSON.stringify(value)}`);
    }
    return value;
}
