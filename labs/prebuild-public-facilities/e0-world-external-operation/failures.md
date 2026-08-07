# E0 失败路径与坑清单

失败路径是本轮最有价值的产物之一。以下全部为实验中真实触发的问题。

## F1 — Codex custom provider 导致 ACP session/new 无模型可用

- 现象：`codex-acp@1.1.13` 的 `session/new` 返回 `Internal error: Codex did not return any models`。
- 根因链：本机 `~/.codex/config.toml` 使用 `model_provider = "custom"` + `model_catalog_json`；
  该配置下 `codex app-server` 的 `model/list` 返回空数组（已用独立探针复现：
  `scratch/app-server-probe.ts`）。`codex-acp` 在 session/new 时强制枚举模型，空列表即失败。
  `codex exec` CLI 路径不受影响（同一配置可正常跑通），说明这是 app-server 模型枚举路径
  与 custom provider catalog 之间的兼容缺口，不是凭据或网络问题。
- 解决：为实验建立隔离 `CODEX_HOME`（`scratch/codex-home-e0`，仅 ChatGPT 登录态 + 最小 config），
  `model/list` 正常返回，`session/new`/`session/prompt` 全链路通过。
- 教训：ACP Agent 可用性依赖宿主 CLI 的配置切面；DCF 未来把 Agent 纳入 Evidence/Action 设施时，
  必须把"宿主配置兼容性"作为 Source 健康检查的一部分，而不是假设 CLI 可用 = ACP 可用。

## F2 — ACP SDK 类型与 codex-acp 运行时 schema 的字段名漂移

- 现象：`@agentclientprotocol/sdk@1.3.0` 的 `prompt()` 按类型发送 `content` 字段，
  codex-acp 服务端 zod 校验报 `Invalid params: prompt: expected array, received undefined`。
- 根因：同一协议版本（protocolVersion=1）内，客户端 SDK 与服务端 Agent 对 PromptRequest
  消息体字段名不一致（`content` vs `prompt`）。
- 解决：以服务端运行时 schema 为准（发送 `prompt` 数组），执行器内注释标记。
- 教训：这是 E1 的直接研究输入——"ACP v1 无法表达的语义 / 生态一致性风险"清单第一条：
  协议 schema 的版本治理尚不稳定，客户端必须对字段漂移做运行时探测或按 Agent 版本固定组合。

## F3 — Becsy entity 句柄跨帧无效

- 现象：缓存 entity 句柄跨帧访问抛 `Entity handle no longer valid`。
- 解决：Drain 每帧以 `opId → entity` 重建索引。
- 教训：强化硬门禁 G6 的正当性——长期身份必须使用领域稳定 ID；这也使 World 重建恢复
  （ledger 快照只含领域字段）成为自然设计。

## F4 — 背压下执行器过早销毁导致事件滞留

- 现象：synthetic worker 在 burst 剧本后立即从 active 表移除 op，队列满时滞留的
  12+ 个事件无人再 flush，op 最终被 lease 判为 worker_lost（假阳性故障）。
- 解决：引入 `done` 标记：剧本演完后继续 flush，直到 pendingEvents 清空才移除。
- 教训：背压语义要求生产者持有事件直到交付确认；"发完即忘"在有界队列下会制造
  与真实 Worker 死亡无法区分的假信号。正式 Intake（E4）必须把这条作为设计约束。

## F5 — 重复结果守卫与终态守卫的顺序歧义

- 现象：同一 eventId 的结果第二次到达时 op 已是 completed，先判 terminal 会把它记为
  "迟到新结果"而非"重复投递"，诊断语义混淆。
- 解决：守卫顺序固定为 cancel → duplicate(eventId) → terminal；两类忽略分别计数。
- 教训：守卫顺序本身是语义契约的一部分，必须在 decision/metrics 中显式记录。

## F6 — 状态迁移断言必须折叠观测帧

- 现象：Readback 每帧记录快照，`running` 状态跨多帧重复出现，直接比较迁移序列失败。
- 解决：断言使用"折叠连续重复"的迁移序列。
- 教训：可观察快照（每帧真值）与迁移视图（派生）是两层证据，不可互相替代。
