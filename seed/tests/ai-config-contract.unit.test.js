#!/usr/bin/env node

/**
 * seed/tests/ai-config-contract.unit.test.js
 *
 * Spec Wave 2 correctness constitution (正确性体质):
 *   验证 ai-config.contract.js 的三条不变量（非法状态不可表示）:
 *     1. api_endpoint/api_key/model 三字段全有或全无（部分缺失 = 非法）
 *     2. local_fallback.enabled=true 时 ollama_url + model 必填
 *     3. opencode_fallback 与 local_fallback.enabled 不得同时为 true
 */

const assert = require('assert');
const { validateAiConfig, isFullyAbsent, isFullyPresent } = require('../companion/ai-config.contract');

const results = { passed: 0, failed: 0, failures: [] };
function test(name, fn) {
    try {
        fn();
        results.passed++;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        results.failed++;
        results.failures.push({ name, error: error.message });
        console.log(`  ✗ ${name}: ${error.message}`);
    }
}

console.log('\n=== 规则 1：api 三字段全有或全无 ===');

test('三字段全有 → valid', () => {
    const r = validateAiConfig({ api_endpoint: 'https://x', api_key: 'k', model: 'm' });
    assert.strictEqual(r.valid, true);
});

test('三字段全无 → valid（无 API 态，合法）', () => {
    const r = validateAiConfig({});
    assert.strictEqual(r.valid, true);
});

test('仅 api_endpoint（部分缺失）→ invalid', () => {
    const r = validateAiConfig({ api_endpoint: 'https://x' });
    assert.strictEqual(r.valid, false);
});

test('仅 api_key + model（缺 endpoint）→ invalid', () => {
    const r = validateAiConfig({ api_key: 'k', model: 'm' });
    assert.strictEqual(r.valid, false);
});

test('YOUR_API_KEY_HERE 占位符视为缺失（部分缺失 → invalid）', () => {
    const r = validateAiConfig({ api_endpoint: 'https://x', api_key: 'YOUR_API_KEY_HERE', model: 'm' });
    assert.strictEqual(r.valid, false);
});

console.log('\n=== 规则 2：local_fallback.enabled=true 时 ollama_url+model 必填 ===');

test('local enabled + ollama_url + model → valid', () => {
    const r = validateAiConfig({ local_fallback: { enabled: true, ollama_url: 'http://x', model: 'llama' } });
    assert.strictEqual(r.valid, true);
});

test('local enabled 但缺 ollama_url → invalid', () => {
    const r = validateAiConfig({ local_fallback: { enabled: true, model: 'llama' } });
    assert.strictEqual(r.valid, false);
});

test('local enabled 但缺 model → invalid', () => {
    const r = validateAiConfig({ local_fallback: { enabled: true, ollama_url: 'http://x' } });
    assert.strictEqual(r.valid, false);
});

test('local disabled 时不校验子字段 → valid', () => {
    const r = validateAiConfig({ local_fallback: { enabled: false } });
    assert.strictEqual(r.valid, true);
});

console.log('\n=== 规则 3：opencode_fallback 与 local_fallback.enabled 互斥 ===');

test('两者同时 true → invalid（互斥违规）', () => {
    const r = validateAiConfig({
        opencode_fallback: true,
        local_fallback: { enabled: true, ollama_url: 'http://x', model: 'llama' }
    });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.message.includes('互斥')), '错误信息须指出互斥');
});

test('仅 opencode_fallback=true → valid', () => {
    const r = validateAiConfig({ opencode_fallback: true, local_fallback: { enabled: false } });
    assert.strictEqual(r.valid, true);
});

test('仅 local enabled（opencode 未设）→ valid', () => {
    const r = validateAiConfig({ local_fallback: { enabled: true, ollama_url: 'http://x', model: 'llama' } });
    assert.strictEqual(r.valid, true);
});

console.log('\n=== 辅助判定：isFullyAbsent / isFullyPresent ===');

test('isFullyAbsent 空对象 → true', () => {
    assert.strictEqual(isFullyAbsent({}), true);
});

test('isFullyAbsent 含占位符 → true', () => {
    assert.strictEqual(isFullyAbsent({ api_key: 'YOUR_API_KEY_HERE' }), true);
});

test('isFullyPresent 三字段全有 → true', () => {
    assert.strictEqual(isFullyPresent({ api_endpoint: 'x', api_key: 'k', model: 'm' }), true);
});

test('isFullyPresent 部分缺失 → false', () => {
    assert.strictEqual(isFullyPresent({ api_endpoint: 'x' }), false);
});

console.log('\n================ 汇总 ================');
console.log(`通过 ${results.passed}，失败 ${results.failed}`);
if (results.failed > 0) {
    for (const f of results.failures) console.log(`  ✗ ${f.name}: ${f.error}`);
    process.exit(1);
}
console.log('✓ 全部 ai-config contract 单测通过');
