/**
 * dependency-cruiser 配置 — DCF 三级体质复合架构的机器强制（架构笼子）
 *
 * 依赖方向规则（对应 spec「依赖方向」一节）：
 *   1. functions/* 之间：禁止互相 require（只经 core/event-bus）
 *   2. functions → core：允许（注入接口）
 *   3. companion → functions：允许（仅经 index.js 入口）
 *   4. core → functions：禁止
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-functions-to-functions',
            comment: 'functions/* 模块之间禁止互相依赖（隔离优先：宁重复不耦合），集成只经 core/event-bus',
            severity: 'error',
            from: { path: '^seed/functions/([^/]+)/' },
            to: {
                path: '^seed/functions/([^/]+)/',
                pathNot: '^seed/functions/$1/' // 允许模块内部文件互相引用
            }
        },
        {
            name: 'no-core-to-functions',
            comment: 'core 共享内核禁止依赖 functions（依赖方向单向：functions → core）',
            severity: 'error',
            from: { path: '^seed/core/' },
            to: { path: '^seed/functions/' }
        },
        {
            name: 'companion-only-via-index',
            comment: 'companion 只允许经各模块 index.js 入口调用 functions，禁止直接引用 service/contract/adapters',
            severity: 'error',
            from: { path: '^seed/companion/' },
            to: {
                path: '^seed/functions/[^/]+/(service|contract|adapters|opencode-bridge)',
                pathNot: '\\.d\\.ts$'
            }
        },
        {
            name: 'no-orphan-functions-adapters',
            comment: 'functions 私有适配器只能被本模块引用',
            severity: 'error',
            from: { pathNot: '^seed/functions/([^/]+)/' },
            to: { path: '^seed/functions/([^/]+)/adapters/' }
        }
    ],
    options: {
        doNotFollow: {
            path: 'node_modules'
        },
        includeOnly: '^seed/(core|functions|companion)/',
        tsPreCompilationDeps: false,
        reporterOptions: {
            text: { highlightFocused: true }
        }
    }
};
