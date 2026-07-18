# ADR: 对话闭环按可观察活动判断停滞，并把权限裁决交回当前对话

- 日期：2026-07-19
- 状态：已接受，真实浏览器验收通过
- 范围：`dcf.firstparty.local-agent-dialogue`

## 背景

真实任务暴露了两个相互关联的问题：

1. 对话闭环把任务总运行时间当成超时依据。OpenCode 即使持续产生消息、工具状态和进展，或明确停在权限请求上，仍会在固定墙钟时间到达后被判为 `timeout`。
2. OpenCode 权限请求虽然能被观察到，但只以普通 `needs_user` 结果回传。用户需要自行理解孤立的权限名称和路径，插件也无法从当前对话取得判断并继续原 session。

权限等待不是任务停滞。同步 `/session/:id/message` 连接中断也不等于 session 失败。

## 决策

### 1. 超时改为无活动超时

对话闭环维护 `last_activity_at`，活动指纹由以下可观察事实组成：

- session 状态；
- message、text、reasoning 和 tool part 的变化；
- tool input/output/status/title/error 的变化；
- Todo 和 Diff；
- permission 和 question 集合；
- 同步 message 请求状态。

任一事实变化都会刷新最近活动时间。只有在没有 permission/question 等明确干预、并且超过 `idle_timeout_ms` 后，连续两次最终快照仍完全相同，才返回 `inactive_timeout`。

同步 message POST 不再使用任务墙钟时限主动 abort。若同步通道失败但 session 仍可观察，状态进入 `detached`，继续根据 session 事实判断。

### 2. 权限请求是中间协议，不是任务结果

OpenCode 的原生权限对象保持不变。DCF 使用权限对象中的 `messageID/callID` 关联具体 tool part，补充：

- 原始权限对象；
- 工具名称、状态和输入；
- 原始任务；
- 最近 Assistant 输出；
- Todo、Diff 和证据完整度。

随后自动发送 `dcf.local-agent.permission-request.v1` 到当前 ChatGPT 对话。

当前对话返回 `dcf.local-agent.permission-decision.v1`，只允许 `once / always / reject`。插件校验 request、session 和 permission 身份后，通过 OpenCode 原生权限回复接口把决定送回同一个 session，并继续观察原任务。

权限等待期间暂停无活动超时。权限请求包是中间事件，同一 DCF 任务只在 completed、failed、bridge_error 或 inactive_timeout 时发送最终 `dcf.local-agent.result.v1`。

## 本轮边界

本轮只打通一次权限请求的对话裁决和原 session 继续，不实现：

- Always 授权账本；
- 授权撤销；
- DCF deny/封锁规则；
- 自动过期；
- OpenCode 全局权限配置修改；
- question 的对话答复协议。

这些能力必须在本轮真实浏览器验收通过后，再由本机 AI 查询当前 OpenCode 版本的实际接口并单独决策。

## 真实浏览器验收

### 无活动超时

请求 `dcf-dialogue-v9-keepalive-live-20260719-01` 在 session `ses_0893de5a4ffeI9S0El9NFh5YVY` 中运行了 238.059 秒。任务超过测试用 90 秒阈值后仍继续运行，并只在最后一次可观察活动停止约 90 秒后返回 `inactive_timeout`。

结果明确包含：

- `timeout_basis: observable-idle-time`；
- `status_type: busy`；
- `idle_timeout_ms: 90000`；
- 所有 observation endpoint error 均为 `null`。

这证明旧的总墙钟时长超时已经移除。该任务最终停滞在 Step 2，说明 90 秒只适合机制测试，不适合正常长任务；正式默认仍为 20 分钟。

### 权限裁决

请求 `dcf-dialogue-v9-permission-live-20260719-01` 创建 session `ses_089396f11ffeNTMkgi4LPSIDKn`，OpenCode 为读取 `/Library/LaunchAgents` 产生原生 `external_directory` 权限请求。

DCF 回传的权限包完整包含：

- permission `per_f76c69998001gEa7XQJGhmCzQ5`；
- 精确 pattern `/Library/LaunchAgents/*`；
- 关联的 `messageID`、`callID`；
- `read` 工具及输入 `filePath: /Library/LaunchAgents`；
- 原始任务、最近 Assistant 输出、Todo、Diff 和证据完整度。

当前对话返回 `once` 决定。插件把决定送回同一个 session，OpenCode 完成读取，并只返回一份最终 `dcf.local-agent.result.v1`：

- status: `completed`；
- result: `DCF_PERMISSION_FLOW_OK NO_MATCH`；
- status_type: `idle`；
- permissions/questions/diff/todo 均为空；
- 所有 endpoint error 均为 `null`。

因此五项验收条件全部通过：

1. 任务总运行时间超过旧阈值时不会因总时长终止；
2. 权限等待不会被判为 timeout；
3. 权限请求包含原生权限、关联工具输入和任务上下文；
4. 当前对话的权限决定自动送回原 session；
5. 原任务继续，并且只回传一次最终结果。

## 后续

下一阶段先使用已经打通的本机 AI 查询当前 OpenCode 版本的真实权限保存、枚举、撤销和拒绝接口，再单独设计完整权限管理。不得根据最新源码或假设直接实现 Always 撤销与封锁。
