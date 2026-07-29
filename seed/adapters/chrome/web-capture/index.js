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
