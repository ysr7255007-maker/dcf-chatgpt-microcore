# E1 失败路径与坑清单

## F1 — resume 要求会话先产生持久化 rollout

- 现象：`session/new` 后未产生任何 turn 就调用 `session/resume`，codex-acp 返回
  `Internal error: no rollout found for thread id ...`。
- 解决：生命周期测试先产生真实 turn 再 resume；错误本身作为可观察行为证据记录。
- 教训：capability 声明（resume: {}）只说明方法存在，不说明前置条件；
  DCF 的 AgentSession 语义必须把"可恢复性"建模为运行态事实（有持久化才可恢复），
  而不是能力声明。

## F2 — PromptRequest 字段名漂移已在两个 Agent 上复核

- E0 F2 的补充证据：codex-acp@1.1.13 与 claude-agent-acp@0.65.0 的运行时 schema
  都要求消息体字段为 `prompt`（数组），而 SDK@1.3.0 的 TypeScript 类型使用 `content`。
- 处理：`AgentManifest.promptFieldName` 作为数据登记（本轮两个 Agent 恰好一致为 `prompt`）。
- 教训：字段漂移必须以运行时探针为准并数据化登记；若未来出现不一致，
  它属于"协议兼容数据"，仍然不需要在客户端写行为分支。

## F3 — 权限请求在只读探针下未被触发

- 现象：全部测试使用只读/无工具 prompt，`permission_requests_observed = 0`。
- 影响：permission request/decision 的 DCF 边界代码已实现（policy 注入 + 选项归一），
  但没有被真实 Agent 请求驱动过。
- 裁决处理：该子项记为 `PERMISSION_EXERCISE_INSUFFICIENT`，不冒充通过。
- 后续：正式施工中的文件修改类任务会自然触发权限请求，届时补测。

## F4 — 工具/文件变更事件覆盖受任务形态限制

- 现象：只读探针下活动类型仅覆盖 agent_message / agent_thought / raw_update；
  tool_call / file_change / plan / usage 归一代码存在但未被真实事件流经。
- 裁决处理：记为 `TOOL_EVENT_COVERAGE_PARTIAL`。E5 的真实文件修改任务会补充该证据。

## F5 — 宿主配置切面决定 ACP 可用性（继承 E0 F1）

- Codex 使用隔离 CODEX_HOME；Claude 使用本机 oauth 登录态。
- 教训：ACP Agent 的"可连接性"是环境属性；正式接入必须把 Agent 宿主配置纳入
  Source 健康检查（与 E4 的 Provider 生命周期语义衔接）。
