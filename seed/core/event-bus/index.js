#!/usr/bin/env node

/**
 * seed/core/event-bus/index.js — DCF Event Bus (schema-enforced)
 *
 * 使用 contracts.js 的事件注册表进行 publish 校验：
 * - 事件名未注册 → 抛错
 * - payload parse 失败 → 抛错
 *
 * 用法保持不变：
 *   const { bus, EventType } = require('./event-bus');
 *   bus.on(EventType.ImportCompleted, handler);
 *   bus.publish(EventType.ImportCompleted, { result: {...} });
 */

const { bus, EventType } = require('./contracts.js');

module.exports = {
    bus,
    EventType
};
