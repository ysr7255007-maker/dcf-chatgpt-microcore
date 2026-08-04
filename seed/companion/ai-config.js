/**
 * AI Digest Configuration Module
 *
 * Reads ~/.dcf/ai-config.json to determine AI model routing:
 *   1. API endpoint (火山方舟 etc.) — preferred
 *   2. Local fallback (Ollama) — secondary
 *   3. OpenCode task dispatch (phase 5 channel) — tertiary stub
 *
 * Missing config → { configured: false }, never silently fakes.
 * All options default to enabled; only explicit absence is "unconfigured".
 *
 * Zero npm dependencies (Node 18+ fs/path).
 */

const fs = require('fs');
const path = require('path');
const { validateAiConfig, isFullyAbsent, isFullyPresent } = require('./ai-config.contract');

/**
 * Default config file location.
 */
function getDefaultConfigPath() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.dcf', 'ai-config.json');
}

/**
 * Required fields for a "configured" state.
 * api_endpoint + api_key + model must all be present and non-empty.
 */
const REQUIRED_API_FIELDS = ['api_endpoint', 'api_key', 'model'];

/**
 * Read and parse the config file.
 * Returns null if file is missing or unreadable (honest absence).
 *
 * @param {string} [configPath] — override path (for testing)
 * @returns {Object|null} parsed config or null
 */
function readConfigFile(configPath) {
    const filePath = configPath || getDefaultConfigPath();
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        // File missing, unreadable, or invalid JSON — honest absence
        return null;
    }
}

/**
 * Get the full config object.
 * Returns { configured: false } when the config file is missing or
 * required API fields are absent.
 *
 * @param {string} [configPath] — override path (for testing)
 * @returns {Object} config with { configured: boolean, ... }
 */
function getConfig(configPath) {
    const raw = readConfigFile(configPath);

    if (!raw) {
        return { configured: false };
    }

    // 正确性体质：非法配置不可表示。
    // 三条不变量皆为跨字段约束，无论 API 是否存在都校验：
    //   1. api 三字段全有或全无（2. 本地兜底完整性（3. 兜底通道互斥
    // 违反 → fail loud（configured:false + invalid:true），不静默降级。
    const validation = validateAiConfig(raw);
    if (!validation.valid) {
        return {
            configured: false,
            invalid: true,
            errors: validation.errors
        };
    }

    // API 三字段全无 = 合法的无 API 态（可能仅启用本地/OpenCode 兜底）
    if (isFullyAbsent(raw) || !isFullyPresent(raw)) {
        return { configured: false };
    }

    return {
        configured: true,
        api_endpoint: raw.api_endpoint,
        api_key: raw.api_key,
        model: raw.model,
        local_fallback: raw.local_fallback || null,       // { ollama_url, model }
        opencode_fallback: raw.opencode_fallback !== false, // default true unless explicitly false
        opencode_server: raw.opencode_server || null      // { base_url, username, password }
    };
}

/**
 * Quick boolean: is AI digest configured (API available)?
 *
 * @param {string} [configPath] — override path (for testing)
 * @returns {boolean}
 */
function isConfigured(configPath) {
    return getConfig(configPath).configured === true;
}

/**
 * Get a human/machine-readable status for the Surface indicator.
 *
 * Status levels:
 *   - "api"       → 🟢 API configured and available
 *   - "local"     → 🔵 API missing but local fallback configured
 *   - "unconfigured" → ⚪ No AI capability configured
 *
 * @param {string} [configPath] — override path (for testing)
 * @returns {{ level: string, label: string, detail: Object }}
 */
function getStatus(configPath) {
    const config = getConfig(configPath);

    if (config.configured) {
        return {
            level: 'api',
            label: 'API 可用',
            indicator: '🟢',
            detail: {
                api_endpoint: config.api_endpoint,
                model: config.model,
                local_fallback: !!config.local_fallback,
                opencode_fallback: config.opencode_fallback
            }
        };
    }

    // 正确性体质：非法配置如实报告（fail loud，不静默降级）。
    // 非法配置 = 无可用 AI 能力 → 归入 ⚪未配置（spec 仅定义 🟢/🔵/⚪ 三态），
    // 但 detail 携带 invalid 标志与具体错误，供上层与用户定位。
    if (config.invalid) {
        console.warn('[ai-config] 非法配置（fail loud）:', JSON.stringify(config.errors));
        return {
            level: 'unconfigured',
            label: '未配置（配置非法）',
            indicator: '⚪',
            detail: {
                invalid: true,
                hint: 'ai-config.json 违反 contract，请修正后重试',
                errors: config.errors
            }
        };
    }

    // Check if local fallback alone is available
    const raw = readConfigFile(configPath);
    if (raw && raw.local_fallback && raw.local_fallback.enabled === true
        && raw.local_fallback.ollama_url && raw.local_fallback.model) {
        return {
            level: 'local',
            label: '本地可用',
            indicator: '🔵',
            detail: {
                ollama_url: raw.local_fallback.ollama_url,
                model: raw.local_fallback.model
            }
        };
    }

    return {
        level: 'unconfigured',
        label: '未配置',
        indicator: '⚪',
        detail: {
            hint: '请配置 ~/.dcf/ai-config.json（api_endpoint, api_key, model）'
        }
    };
}

module.exports = {
    getConfig,
    isConfigured,
    getStatus,
    readConfigFile,
    getDefaultConfigPath,
    REQUIRED_API_FIELDS
};
