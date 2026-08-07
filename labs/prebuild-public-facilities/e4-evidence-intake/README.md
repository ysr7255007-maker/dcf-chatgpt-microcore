# E4 — Evidence Source 管理 × 可靠采集实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§8。

## 研究问题

怎样让新增 Source 只增加 Provider/Probe，而不让 DCF 核心监管、恢复和数据
可靠性复杂度随来源数量线性增长？

## 三路线与早停门禁（计划 [修订6]）

| 路线 | 处理 | 结果 |
| --- | --- | --- |
| A 薄 Intake（Bun，借 HA/OTel/Redpanda 机制） | 全量实现 + 6 组行为测试 | PASS（两次复跑 6/6） |
| B OTel Collector 数据面 | 早停：`DIRECT_ADOPTION_REJECT / BORROW_PATTERNS_ONLY` | 见 decision.md 早停依据 |
| C Redpanda Connect sidecar | 早停：`DIRECT_ADOPTION_REJECT / BORROW_PATTERNS_ONLY` | 见 decision.md 早停依据 |

B/C 本机无二进制；按早停纪律，结构性触发条件（语义强扭 / 第二套运行权威 /
需 Go 定制组件）一旦确认即记录裁决，不为"公平"堆无效工程量。
证据等级如实标注：`STRUCTURAL_ASSESSMENT`（非活管道运行）。

## Route A 结构

```text
ThinIntake（约 230 非空 LOC）
 ├─ Source 注册表：内容派生 identity，双 discovery 去重（HA 纪律）
 ├─ 生命周期状态机：discovered→configured→started→healthy→unavailable→recovered→stopped→removed
 ├─ 数据面：有界队列 + ack（生产者持有到确认）+ WAL（仅非重放来源）+ 持久 cursor
 └─ RawEvidence：occurrence_time / source_sequence / ingestion_time / processing_order 四轴显式分离
Providers：SyntheticProvider（剧本注入）/ GitProvider（可重放，cursor=SHA，无 WAL）
          / ProbeProvider（真独立子进程，可 kill/重启）
```

## 运行

```bash
bun test tests/    # 6 tests：生命周期/时间拆开/probe 崩溃恢复/重复背压重启/Git cursor/慢下游
```

裁决见 [decision.md](./decision.md)。
