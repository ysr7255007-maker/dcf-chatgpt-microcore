# ADR: DCF Chrome 本机 AI 桥梁插件计划

Date: 2026-07-17  
Status: accepted as a follow-up capability; implementation pending

## Context

DCF Next 已经形成过一版 Local Agent 方案与原型，包括网页插件、本机 Bridge、任务协议、配对流程和结果回填。当前 Chrome `rc.2` 没有带入这项能力；现有 Chrome ADR 中的“拒绝 Local Agent expansion”只表示本轮不扩张底座范围，也不建设通用 Agent 平台，不表示永久放弃本机 AI 桥梁。

旧版原型依赖 Tampermonkey 的跨域请求能力。当前 Chrome 底座的清单没有 loopback 访问权限，Host API 也没有本机 Bridge 的受限消息接口，因此首次迁移不能只发布动态插件。

## Decision

1. 新能力作为第一方独立插件存在，暂定 ID 为 `dcf.firstparty.local-agent`。
2. 插件负责面板、配对、任务确认、进度、结果展示和回填 ChatGPT 输入框。
3. 本机 Bridge 是独立小进程，只监听 loopback，把工作区别名映射到本机配置，并调用一个已经配置好的工具型 AI。
4. 网页侧只提交工作区别名与自然语言任务，不保存本机真实路径、模型密钥、GitHub 登录或 Agent 凭据。
5. Bridge 离线是插件普通状态，不能影响其他 DCF 功能或触发整体回滚。
6. 第一版结果填入当前输入框供用户检查，不自动发送。
7. Chrome 底座只增加这项功能必需的受限 loopback 权限与固定协议消息，不扩展成通用网络或 Agent 平台。
8. 因此第一次交付包含一次小型底座升级、一个独立 Local Agent 插件和一个本机 Bridge；之后插件 UI 与任务行为可以继续独立更新。

## Reuse boundary

旧 DCF Next 的以下成果作为迁移依据：

- `dcf.local-instance.v1` 页面实例注册；
- `dcf.local-task.v1` 自然语言任务；
- 短期配对码与进程期会话令牌；
- 工作区别名映射；
- Echo 模式的端到端验证；
- 任务完成后把结果回填到原页面。

旧代码不能直接照搬，因为网络入口从 Tampermonkey 请求能力变为 Chrome 后台受限传输。

## Implementation order

1. 完成当前 Chrome 候选验收并关闭 `rc.2`；
2. 先实现底座的最小 loopback 传输与权限；
3. 移植 Local Agent 插件；
4. 移植 Bridge 的 Echo 模式并完成配对、注册、任务、结果回填闭环；
5. 最后接入一个真实本机 AI 命令入口。
