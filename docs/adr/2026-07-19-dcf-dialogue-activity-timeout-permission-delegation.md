# ADR: 对话闭环按可观察活动判断停滞，并把权限裁决交回当前对话

- 日期：2026-07-19
- 状态：已实现，待真实浏览器验收
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

## 验收条件

1. 持续产生可观察活动的任务超过旧墙钟阈值后仍继续运行；
2. permission 存在期间不会返回 timeout；
3. 权限请求包包含原生权限、关联工具输入和任务上下文；
4. 当前对话的权限决定自动送回原 session；
5. 权限处理后原任务继续，并且只回传一次最终结果。
