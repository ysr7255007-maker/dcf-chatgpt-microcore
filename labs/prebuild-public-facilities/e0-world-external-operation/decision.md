# E0 裁决

## 裁决

```text
WORLD_EXTERNAL_OPERATION_PASS
```

## 依据

任务书 §4 的全部 14 个必测场景 + 7 条硬门禁 + 真实验证（1 个真实异步 AI HTTP Turn
+ 1 个真实 ACP Codex Session）在同一骨架上通过；两次独立完整复跑 20/20。

| 硬门禁 | 结果 | 关键证据 |
| --- | --- | --- |
| World 主循环不被外部 I/O 阻塞 | PASS | G1 测试：挂起 op 存在期间 40 帧最大 execute <10ms；R1 真实网络等待期间世界持续跑帧 |
| AI 和 ACP 不需要各自平行生命周期 | PASS | R1/R2 同一 ExternalExecutor 接口 + 同一 WorldHost；G2 结构扫描证明执行器不自带状态机 |
| 取消后迟到结果不能复活已结束操作 | PASS | S4：迟到结果被拒，cancelled 稳定，resultApplyCount=0 |
| 重复事件不会产生重复业务结果 | PASS | S5：eventId 去重，resultApplyCount=1，重复单独计数 |
| Worker/Provider 死亡进入可观察状态 | PASS | S6（crash 事件）+ S13（沉默死亡 lease 兜底）双路径 |
| 不依赖 ECS Entity ID 作为长期身份 | PASS | 全链路 opId 索引；ledger 快照只含领域字段；跨 World 重建身份连续 |
| 核心桥接零 provider 业务分支 | PASS | G7 源码扫描：核心四文件零 provider 关键词、零 provider== 分支 |

## 形成的结构（候选，待人工吸收）

```text
ExternalOperation = World 内的运行身份 + 状态机 + lease + 结果应用计数
OperationGateway  = 有界事件队列（背压）+ 命令 outbox + 可观察守卫计数
ExternalExecutor  = 外部执行器唯一接口（AI/ACP/DB/Probe 同构）
守卫顺序          = cancel → duplicate(eventId) → terminal → apply
恢复语义          = terminated 事件 / lease 超时 / 重建 orphaned / 重试新 opId
```

## 明确不宣称

- 未证明该骨架在大量并发 op（>百级）下的调度性能；
- 未证明跨进程 World（多进程部署）下的事件总线形态；
- Responses API 等具体 AI 协议的正确性不在 E0 范围（归 E2）；
- ACP 协议生态的字段漂移风险已在 failures.md F2 记录，归 E1 深入。

## 对后续实验的约束

- E1 的 ACP Client 作为 ExternalExecutor 接入本骨架，不得另建生命周期；
- E4 的 Intake 背压设计必须继承 F4 教训（生产者持有事件直到交付确认）；
- E5 的 AgentSession/ExternalOperation 复用本结构。
