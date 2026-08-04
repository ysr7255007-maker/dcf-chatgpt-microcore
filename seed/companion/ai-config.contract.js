#!/usr/bin/env node

/**
 * seed/companion/ai-config.contract.js — AI Config Zod Contract (正确性体质)
 *
 * 非法状态不可表示（Spec Wave 2 correctness constitution）：
 *   1. api_endpoint / api_key / model 三字段全有或全无（部分缺失 = 非法配置）
 *   2. local_fallback.enabled=true 时 ollama_url + model 必填
 *   3. opencode_fallback 与 local_fallback.enabled 不得同时为 true
 *
 * 该 schema 是 ai-config.js 加载 ~/.dcf/ai-config.json 后的合法形态硬边界。
 * 配置校验失败 → fail loud（抛出 ZodError），不静默降级、不伪造能力。
 */

const { z } = require('zod');

/**
 * 本地兜底（Ollama）配置：enabled=true 时 ollama_url + model 必填。
 * 非法状态不可表示：不允许 enabled=true 但缺 ollama_url/model。
 */
const LocalFallbackSchema = z.object({
    enabled: z.boolean().default(false),
    ollama_url: z.string().optional(),
    model: z.string().optional()
}).refine(
    (lf) => {
        if (lf.enabled !== true) return true; // 未启用则不校验子字段
        return typeof lf.ollama_url === 'string' && lf.ollama_url.trim() !== ''
            && typeof lf.model === 'string' && lf.model.trim() !== '';
    },
    { message: 'local_fallback.enabled=true 时 ollama_url 与 model 必填' }
);

/**
 * OpenCode 服务器配置（可选，阶段 5 通道）。
 */
const OpenCodeServerSchema = z.object({
    base_url: z.string().optional(),
    username: z.string().optional(),
    password: z.string().nullable().optional()
}).optional();

/**
 * 完整 AI 配置 schema（三条不变量，皆为跨字段约束）：
 *   1. api_endpoint/api_key/model 三字段全有或全无（部分缺失 = 非法）
 *   2. local_fallback.enabled=true 时 ollama_url+model 必填（由 LocalFallbackSchema 保证）
 *   3. opencode_fallback 与 local_fallback.enabled 不得同时为 true
 *
 * 三字段均为 optional，但“全有或全无”由 superRefine 强制；
 * 这样“仅启用本地兜底、无 API”也是合法配置，但仍受规则 2/3 约束。
 */
const AiConfigSchema = z.object({
    description: z.string().optional(),
    api_endpoint: z.string().optional(),
    api_key: z.string().nullable().optional(),
    model: z.string().optional(),
    local_fallback: LocalFallbackSchema.optional(),
    opencode_fallback: z.boolean().optional(),
    opencode_server: OpenCodeServerSchema,
    _note: z.array(z.string()).optional()
}).superRefine((cfg, ctx) => {
    // 规则 1：api_endpoint/api_key/model 全有或全无
    const present = (v) => typeof v === 'string' && v.trim() !== '' && v !== 'YOUR_API_KEY_HERE';
    const apiFields = [present(cfg.api_endpoint), present(cfg.api_key), present(cfg.model)];
    const apiCount = apiFields.filter(Boolean).length;
    if (apiCount !== 0 && apiCount !== 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'api_endpoint/api_key/model 三字段必须全有或全无（部分缺失 = 非法配置）',
            path: ['api_endpoint']
        });
    }

    // 规则 3：opencode_fallback 与 local_fallback.enabled 不得同时为 true
    const localEnabled = cfg.local_fallback && cfg.local_fallback.enabled === true;
    const opencodeEnabled = cfg.opencode_fallback === true;
    if (localEnabled && opencodeEnabled) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'opencode_fallback 与 local_fallback.enabled 不得同时为 true（兜底通道互斥）',
            path: ['opencode_fallback']
        });
    }
});

/**
 * 校验一个配置对象（完整 3 条不变量）。
 *
 * @param {Object} raw — 从 ~/.dcf/ai-config.json 读取的对象
 * @returns {{ valid: boolean, data?: Object, errors?: Array }}
 */
function validateAiConfig(raw) {
    const result = AiConfigSchema.safeParse(raw);
    if (result.success) {
        return { valid: true, data: result.data };
    }
    return {
        valid: false,
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    };
}

/**
 * 判定 API 三字段是否全无（无 API 态，合法）。
 * @param {Object|null} raw
 * @returns {boolean} true 表示三字段全部缺失
 */
function isFullyAbsent(raw) {
    if (!raw || typeof raw !== 'object') return true;
    const present = (v) => typeof v === 'string' && v.trim() !== '' && v !== 'YOUR_API_KEY_HERE';
    return !present(raw.api_endpoint) && !present(raw.api_key) && !present(raw.model);
}

/**
 * 判定 API 三字段是否全有（已配置 API 态）。
 * @param {Object|null} raw
 * @returns {boolean}
 */
function isFullyPresent(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const present = (v) => typeof v === 'string' && v.trim() !== '' && v !== 'YOUR_API_KEY_HERE';
    return present(raw.api_endpoint) && present(raw.api_key) && present(raw.model);
}

module.exports = {
    AiConfigSchema,
    LocalFallbackSchema,
    validateAiConfig,
    isFullyAbsent,
    isFullyPresent
};
