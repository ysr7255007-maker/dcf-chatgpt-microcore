# ADR: DCF Chrome 本机 AI 桥梁插件计划

Date: 2026-07-17  
Status: accepted as a follow-up capability; implementation pending

## Context

DCF Next 已经形成过一版 Local Agent 方案与原型，包括网页插件、本机 Bridge、任务协议、配对流程和结果回填。当前 Chrome `rc.2` 没有带入这项能力；现有 Chrome ADR 中的“拒绝 Local Agent expansion”只表示本轮不扩张底座范围，也不建设通用 Agent 平台，不表示永久放弃本机 AI 桥梁。

旧版原型依赖 Tampermonkey 的跨域请求能力。当前 Chrome 底座的清单没有 loopback 访问权限，Host API 也没有本机 Agent 的受限消息接口，因此首次迁移不能只发布动态插件。

OpenCode 当前提供 `opencode serve`：一个只需监听 loopback 的无界面 HTTP 服务，具有 OpenAPI、会话、消息、异步提示、状态、差异、终止、Agent、权限响应和事件接口。它已经承担了旧方案中“启动并承载工具型 AI Agent”的主要职责，因此 DCF 不应再重复实现一套通用 Agent 执行进程。

## Decision

1. 新能力作为第一方独立插件存在，暂定 ID 为 `dcf.firstparty.local-agent`。
2. 插件负责面板、连接状态、任务确认、进度、结果与差异展示，以及回填 ChatGPT 输入框。
3. 第一版工具型 Agent 暂定为 OpenCode；`opencode serve` 是首选本机 Agent 服务端。
4. Chrome 后台增加一个受限 OpenCode 适配器，而不是让 ChatGPT 页面或动态插件直接访问 localhost。适配器固定目标、认证和允许的 API，不暴露任意 URL、任意 OpenCode API 或任意 Shell 调用。
5. 第一版从一个固定工作区启动一个固定端口的 OpenCode 服务；网页侧只提交自然语言任务，不提交本机真实路径。
6. OpenCode 的服务器密码、模型凭据、GitHub 登录和本机路径不得进入页面插件、语言弹药、普通插件数据或 DCF 备份。
7. OpenCode 离线是插件普通状态，不能影响其他 DCF 功能或触发整体回滚。
8. 第一版结果填入当前输入框供用户检查，不自动发送。
9. 第一版使用独立 OpenCode Agent 权限配置，不采用默认宽松权限，也不启用无边界自动批准。读取、编辑、命令、外部目录和子 Agent 权限必须有明确规则。
10. Chrome 底座只增加这项功能必需的受限 loopback 权限与固定协议消息，不扩展成通用网络或 Agent 平台。
11. 第一次交付包含一次小型底座升级、一个独立 Local Agent 插件和 OpenCode 连接配置；不再把自研 Node Bridge 作为必需组件。
12. 只有当自动启动 OpenCode、多工作区映射、多个 Agent 宿主或跨平台共用确实成为阻塞时，才重新考虑额外的本机启动器或路由 Bridge。

## Proposed first workflow

```text
ChatGPT 页面中的 Local Agent 插件
→ Chrome 后台受限 OpenCode 适配器
→ http://127.0.0.1:4096
→ 创建 OpenCode session
→ 异步提交自然语言任务
→ 读取状态、消息与 diff
→ 在 DCF 面板展示
→ 用户确认后回填 ChatGPT 输入框
```

第一版不以 `/tui` 控制接口作为主链路。DCF 直接使用 session API，使任务具有独立 session ID、状态、终止、消息和 diff；OpenCode TUI 或 Web 客户端可以另外连接同一服务，供用户观察和接手同一组会话。

## Reuse boundary

旧 DCF Next 的以下成果作为迁移依据：

- `dcf.local-instance.v1` 页面实例注册思想；
- `dcf.local-task.v1` 自然语言任务边界；
- 页面侧明确确认后再执行；
- Bridge 离线不影响普通 DCF 功能；
- 任务完成后把结果回填到原页面。

以下旧实现被替换：

- 自研 Bridge 的 Agent 启动与任务执行由 OpenCode server/session API 取代；
- Tampermonkey `GM_xmlhttpRequest` 由 Chrome 后台受限传输取代；
- 旧配对码可简化为 OpenCode loopback 服务的 Basic Auth 与 DCF 本机连接配置。

旧代码不能直接照搬，因为网络入口、认证、会话生命周期和权限处理都已改变。

## Implementation order

1. 完成当前 Chrome 候选验收并关闭 `rc.2`；
2. 在固定 DCF 工作区手工启动受密码保护的 `opencode serve`，先验证健康检查和 OpenAPI；
3. 实现 Chrome 后台最小 OpenCode 适配器，只开放健康检查、创建 session、提交任务、查询状态、读取消息、读取 diff 和终止任务；
4. 实现 Local Agent 插件的连接、任务确认、进度、结果和 diff 面板；
5. 使用专用 OpenCode Agent 权限配置完成真实仓库低风险任务；
6. 验证 OpenCode TUI/Web 能连接同一服务并观察或接手 DCF 创建的 session；
7. 在出现第二个真实工作区或 Agent 宿主后，再评估目录映射和适配器扩展。
