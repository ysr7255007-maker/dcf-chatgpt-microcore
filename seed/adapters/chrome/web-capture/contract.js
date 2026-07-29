/**
 * Web Capture Contract — SiteAdapter & CapturedEvent Zod Schemas (Node side)
 *
 * 类型驱动硬边界（spec §3.2）：
 * - SiteAdapterSchema：每个 sites/<site>.js 站点文件的合法形态（可执行规格/AI 验证器）
 * - CapturedEventSchema：入库前事件的合法形态
 *
 * 本文件仅供 Node 侧（测试笼子 / 构建期校验）使用，zod 不可用于页面运行时。
 * 页面运行时的同规则轻量断言见 runtime-check.js（双层 contract，spec §二 构建约束）。
 */
'use strict';

const { z } = require('zod');

// 站点适配器：sites/<site>.js 的合法形态
const SiteAdapterSchema = z.object({
    // 'claude.ai'
    host: z.string().min(1),
    // URL 匹配模式（manifest 用），至少 1 条
    matches: z.array(z.string().min(1)).min(1),
    // (url: URL) => string | null —— 从 URL 稳定提取会话 ID；null 表示不采集
    conversationId: z.function(),
    // 消息容器选择器，至少 2 个降级候选
    messageSelectors: z.array(z.string().min(1)).min(2),
    // (el: Element) => 'user' | 'assistant' | null
    roleOf: z.function(),
    // (el: Element) => string
    textOf: z.function(),
    // 可选：(el: Element) => string | null —— 消息稳定 ID（观测键去重用）
    messageIdOf: z.function().optional(),
    // 流式判停：停止按钮选择器，默认空数组
    stopButtonSelectors: z.array(z.string()).default([]),
    // 未经 BrowserClaw 真实验收前必须 false
    verified: z.boolean().default(false)
});

// 入库前事件：outbox append 前的合法形态（页面侧 CapturedEvent）
const CapturedEventSchema = z.object({
    // 必须 `站点前缀:会话ID`
    source_id: z.string().regex(/^[a-z0-9.-]+:[A-Za-z0-9_-]+$/, '必须 站点前缀:会话ID'),
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1),
    ts: z.number().int().positive()
});

module.exports = { SiteAdapterSchema, CapturedEventSchema };
