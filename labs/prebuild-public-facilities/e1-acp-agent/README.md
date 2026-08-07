# E1 — ACP × 外部长任务 Agent 实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§5。

## 研究问题

ACP 能否成为 DCF 与 Codex / Claude / 未来 AI IDE 之间的标准公共接缝，
从而避免每增加一个 Agent 就新增一套 Adapter？

## 结构

```text
AgentManifest（纯数据：command/env/promptFieldName）
      ↓ 新增 Agent = 新增一条记录
DcfAcpClient（唯一客户端：能力发现、会话生命周期、流式归一、权限边界）
      ↓ 边界转换
DCF 自有语义：TaskState / AgentSessionHandle / Activity / PermissionRequest / TurnResult
```

双真实 Agent：

| Agent | 包 | 版本 |
| --- | --- | --- |
| Codex | `@agentclientprotocol/codex-acp` | 1.1.13 |
| Claude | `@agentclientprotocol/claude-agent-acp` | 0.65.0 |
| 协议 SDK | `@agentclientprotocol/sdk` | 1.3.0 |

均 exact pin。Codex 使用实验隔离 CODEX_HOME（E0 failures F1）。

## 运行

```bash
bun install
bun test tests/     # 10 tests：能力发现/流式归一/生命周期/取消/并发/故障注入/结构扫描
```

## 关键结果（两次独立复跑 10/10）

- 双 Agent 同一客户端代码完成 initialize/new/prompt 流式/list/resume/close；
- **跨进程重连 + resume 后追问 codeword 命中**（真实记忆持久化证据）；
- 流式中取消 → stopReason=cancelled；kill 子进程 → 可观察 error；异常 JSON 注入后连接存活；
- capability 档案完全由 initialize 响应派生，客户端源码零 Agent 名称分支（结构扫描测试）。

裁决与指标见 [decision.md](./decision.md)、[results/e1-measurements.json](./results/e1-measurements.json)。
