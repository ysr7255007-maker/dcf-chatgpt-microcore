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

    // Validate required API fields
    const apiValid = REQUIRED_API_FIELDS.every(
        f => raw[f] && typeof raw[f] === 'string' && raw[f].trim() !== ''
    );

    if (!apiValid) {
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

    // Check if local fallback alone is available
    const raw = readConfigFile(configPath);
    if (raw && raw.local_fallback && raw.local_fallback.ollama_url && raw.local_fallback.model) {
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
