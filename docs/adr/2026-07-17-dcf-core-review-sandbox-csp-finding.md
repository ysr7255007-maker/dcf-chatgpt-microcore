# ADR: Core Review 沙箱与宿主页面 CSP

Date: 2026-07-17  
Status: accepted for experiment

## Context

Core Review `0.1.0-alpha.1` 已经成功导入官方插件包、持久化 12 个代码单元并建立 minimal 快照，但在第一枚插件真正执行前失败。错误来自 ChatGPT 页面 CSP 对动态代码执行的限制。

Tampermonkey 在省略 `@sandbox` 时优先使用页面上下文，因此 Core Review 的执行原语继承了宿主页面 CSP。该失败不是 Shell 插件故障，也不是插件包、哈希、持久化或快照机制故障。

## Decision

1. Core Review `0.1.0-alpha.2` 明确声明 `@sandbox DOM`，要求在可访问 DOM 的隔离沙箱中运行。
2. 在启动任何插件之前进行一次动态执行自检。
3. 自检失败时写入 `dynamic_execution_unavailable`，`boot.error.stage` 固定为 `dynamic_execution`，且 `boot.plugins` 保持为空。
4. 不增加页面脚本注入、Blob、Data URL 或多级 fallback 来绕过 CSP。
5. 若隔离沙箱仍不支持该执行原语，则把“userscript 内持久化源码并直接执行”判定为当前浏览器环境的根限制，重新选择插件交付方式。

## Consequences

- 下一次现场验收可以明确区分“运行环境不支持”与“业务插件启动失败”。
- 当前完整捆绑版不受影响，仍作为回滚基线。
- 只有隔离沙箱中的真实启动通过，任务包二才继续向后推进。
