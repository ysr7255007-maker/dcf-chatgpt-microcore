# E1 裁决

## 裁决

```text
ACP_STANDARD_CORE
```

附带两项如实登记的证据缺口（不构成结构例外，不需要窄扩展）：

```text
PERMISSION_EXERCISE_INSUFFICIENT   # 权限请求路径已实现但未被真实触发（只读探针限制）
TOOL_EVENT_COVERAGE_PARTIAL        # tool_call/file_change/plan/usage 归一代码待 E5 真实任务流经
```

## 依据

双真实 Agent（Codex codex-acp@1.1.13 + Claude claude-agent-acp@0.65.0）通过
**同一个 DcfAcpClient prototype** 完成全部核心互操作；两次独立复跑 10/10。

| 能力 | Codex | Claude | 证据 |
| --- | --- | --- | --- |
| initialize + capability discovery | PASS | PASS | T1：档案完全由 initialize 响应派生 |
| session/new + prompt streaming | PASS | PASS | T2：归一化活动流（message/thought/raw_update） |
| session/list | PASS（25 会话） | PASS（14 会话） | T3 |
| session/resume（同连接） | PASS | PASS | T3（须先有持久化 turn，见 failures F1） |
| session/close 隔离 | PASS | PASS | T3/T8：close 一个不影响另一个 |
| 跨进程重连 + resume | PASS | — | T9：codeword GREEN-77 追问命中 |
| cancel（流式中） | PASS | — | T4：stopReason=cancelled |
| 并发 session | PASS | — | T5：双会话独立 turn |
| kill 子进程故障 | PASS | — | T6：可观察 error + TaskState=error |
| 异常 JSON 注入 | PASS | — | T7：连接存活，后续 turn end_turn |
| permission request/decision | 已实现未触发 | 已实现未触发 | failures F3 |

## 关键指标

```text
共同 DCF Client LOC（acp-client.ts 非空行） : 305
DCF 语义层 LOC（dcf-semantics.ts）          : 58
Codex-specific 行为 LOC                     : 0
Claude-specific 行为 LOC                    : 0
Agent 接入数据（manifest 每条）              : ~9 行纯数据
客户端源码中 Agent 名称出现次数              : 0（结构扫描测试）
capability negotiation 消除的分支            : list/resume/close/delete/loadSession
                                              全部按能力档案降级，无一处 if agent==
```

## ACP v1 当前无法干净表达 / 生态风险清单

1. **PromptRequest 字段名漂移**：SDK 类型 `content` vs 运行时 schema `prompt`（两个 Agent 一致，
   但证明 schema 治理存在裂缝）→ 以 manifest 数据登记吸收。
2. **resume 前置条件不可由 capability 声明表达**：能力存在 ≠ 可恢复（需 rollout 持久化）。
3. **usage/工具事件形状未标准化流经**：本轮仅 message/thought 稳定覆盖；
   tool_call/file_change 的 sessionUpdate 形状按 ACP 规范归一但未被真实事件验证。
4. **宿主 CLI 配置兼容性不在协议范围**：Codex custom provider 使 ACP 不可用（E0 F1），
   协议本身无法表达此类环境前置。

## DCF 语义保持自有的证据

- `dcf-semantics.ts` 零 SDK import（结构扫描测试）；
- TaskState（8 态）为 DCF 定义，与 ACP 消息在边界映射；
- Activity/PermissionRequest/TurnResult 全部 DCF 形状，session/update 在客户端边界被压入。

## 对后续实验的约束

- E5 的 Agent 接入复用 DcfAcpClient + manifest；文件修改任务将顺路补 F3/F4 证据。
