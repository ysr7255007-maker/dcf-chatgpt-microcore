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
