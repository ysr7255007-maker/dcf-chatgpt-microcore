# E4 裁决

## 裁决

```text
BORROW_PATTERNS_BUILD_THIN_INTAKE
```

Route B/C：

```text
OTEL_DATA_PLANE      → DIRECT_ADOPTION_REJECT / BORROW_PATTERNS_ONLY
REDPANDA_DATA_PLANE  → DIRECT_ADOPTION_REJECT / BORROW_PATTERNS_ONLY
```

## 从三个成熟系统实际继承的已踩坑机制（任务书强制项）

| 来源 | 继承的机制 | 在本实验中的落点 |
| --- | --- | --- |
| Home Assistant | Source 生命周期状态机；unique_id 注册去重（双 discovery 不产生双实体）；非法迁移拒绝 | ThinIntake.discover/transition；T1 |
| Home Assistant | 监管轮询发现 unavailable，而非等调用失败 | supervise()；T3 kill 后可观察 |
| OTel Collector | receiver/processor/exporter 三段分离 | deliver（收）→ pump（处理/去重）→ store（落盘） |
| OTel Collector | ack/重试语义：未确认事件由生产者持有 | deliver 返回 false → Provider 重试；T4/T6 零丢失 |
| OTel Collector | event time vs observed time 分离（OTel 自身踩过的坑） | 时间四拆开；T2 |
| Redpanda Connect | 持久 cursor + checkpoint 恢复；可重放来源不建中间队列 | GitProvider cursor=SHA；T5 无 WAL、重启一致 |
| Redpanda Connect | 声明式 input→processor→output 边界 | Provider 只实现 EvidenceSource 接口，不触碰泵 |

这不是"参考了一下"：每一条都映射到具体代码路径与被测试证明的行为。

## 早停门禁依据（B/C）

### Route B — OTel Collector（证据等级 STRUCTURAL_ASSESSMENT，本机无二进制）

- (a) 自定义 Go 组件：DCF RawEvidence 没有现成 receiver；filelog/journald 只能采
  文本日志形态，Git/结构化 Probe 需要自写 receiver（contrib 构建，Go）。**触发。**
- (b) 语义强扭：RawEvidence 必须映射成 log record（body/attributes/resource），
  evidenceId 与四时间轴降级为属性约定，语义主权外流。**触发。**
- (c) 第二套运行权威：collector 的 file_storage 持久队列是必须独立备份的状态。**触发。**
- 三条全部触发 → 按早停纪律不建完整管道。借机制：见上表。

### Route C — Redpanda Connect（证据等级 STRUCTURAL_ASSESSMENT，本机无二进制）

- sidecar 独立进程 + 独立配置/升级/备份面（+1 daemon，运维负担维度失分）；
- RawEvidence 同样被压成通用 message + metadata 约定（b 触发）；
- 其 checkpoint/缓冲语义优秀，但以库形态不可用（Go 服务），只能借模式。
- → 早停。借机制：cursor/checkpoint 语义、声明式管道边界。

## WAL 问题的回答（任务书 §8.5）

> 我们是真的需要 WAL，还是 Source 自己能够重新播放，从而只需要持久 cursor？

**不同 Source 不同答案，已用行为证明：**

- Git（可重放）：只需持久 cursor，不落 WAL（T5：walExists=false，重启全量一致）；
- External Probe（不可重放）：未落盘缓冲需要 WAL 才能 at-least-once（intake.deliver 路径）；
- 没有把遥测领域 at-least-once 无条件复制到所有来源。

## 11 维统一评价

| 维度 | A 薄 Intake | B OTel | C Redpanda |
| --- | --- | --- | --- |
| 第三方代码复用 | 借机制（0 依赖） | 直接复用高 | 直接复用高 |
| DCF 自研 LOC | ≈230（intake）+ Provider 各 ≈60 | 少（配置为主）+ 定制 receiver（Go） | 少（配置为主） |
| 额外进程 | 0（Probe 本就是独立来源进程） | +1 collector daemon | +1 sidecar |
| 额外 runtime | 无 | Go/collector 发行版 | Go/redpanda-connect |
| 启动复杂度 | 低 | 中（配置+扩展） | 中 |
| 配置复杂度 | 代码内声明 | YAML + 扩展矩阵 | YAML |
| Provider 新增成本 | 实现一个接口（O(1)） | receiver 适配/开发 | input 适配 |
| 故障可观察性 | 状态机 + 计数器（T1-T6） | exporter 指标成熟 | 指标成熟 |
| 崩溃恢复 | cursor/WAL 双路径（T5） | file_storage | checkpoint |
| 语义适配损失 | 无（语义自有） | 高（log record 强扭） | 高（message 强扭） |
| 十年总复杂度 | **最低**：无 daemon、无第二权威、语义自有 | 高 | 中偏高 |

## 明确不宣称

- B/C 未跑活管道（早停纪律允许；证据等级已标注）；
- 未做跨机器/网络分区场景；
- 大规模事件速率（>10k/s）未测。

## 对后续实验/施工的约束

- E5 的 Evidence Source（Git fixture 观察）按 EvidenceSource 接口接入；
- 正式施工时 Source 监管必须纳入 World 的 ExternalOperation 骨架（E0），
  Provider 死亡 = 可观察状态，不允许静默。
