# DCF 公共设施消歧实验 总裁决报告 v1

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》（2026-08-07）
执行分支：`experiment/prebuild-public-facilities-v1`（worktree `dcf-prebuild-pf`，基于 origin/main 732a0b6）
执行日期：2026-08-07
实验根目录：`labs/prebuild-public-facilities/`

---

## 总体裁决

```text
READY_WITH_EXPLICIT_EXCEPTIONS
```

六项实验全部完成且无 BLOCK；三项显式例外不阻塞正式 Capability 施工，
但必须在吸收进架构时一并登记（见 E 节与 decision.json `blocking_findings`=空、
`non_blocking_findings` 清单）。

## 裁决表

| Experiment | Verdict | Hard gates | 关键发现 |
| --- | --- | --- | --- |
| E0 World External Operation | `WORLD_EXTERNAL_OPERATION_PASS` | 7/7 | 14 场景 + 真实 AI Turn + 真实 ACP Session 同一骨架；核心桥 511 LOC、0 provider 分支 |
| E1 ACP | `ACP_STANDARD_CORE` | 9/10（permission 未触发如实登记） | Codex+Claude 双真实 Agent 同一客户端；跨重连 resume 记忆命中；字段漂移以数据吸收 |
| E2 AI Turn | `AI_SDK_CORE_ADOPT_WITH_THIN_DCF_LAYER` | 8/8 能力 ×2 路 PASS | A1/A2 功能等价；换 Provider 零上层改动；v7 output API 变化被 thin layer 挡住 |
| E3 Cognition Data | `SQLITE_AUTHORITY_PLUS_LANCEDB_DERIVED`（例外 CJK_FTS_TOKENIZER_PENDING）；7.6 子裁决 `SELF_CONTAINED_CHUNKS_EXPERIMENTAL` | 8/8 结构项 PASS，FTS 中文 PARTIAL | 破坏实验全过；dense Recall@5=0.875；中文 FTS 分词缺口 |
| E4 Evidence | `BORROW_PATTERNS_BUILD_THIN_INTAKE`；B/C `DIRECT_ADOPTION_REJECT / BORROW_PATTERNS_ONLY`（早停） | 6/6 | 继承机制逐条落码；WAL 按来源分治；时间四拆开行为证明 |
| E5 Reality Loop | `E5_REALITY_LOOP_PASS` | 9/9 组合门禁 | 真实 Agent 闭环；事实/认知分层落库；Glue 60 LOC、0 重复权威 |

每项实验均执行两次独立完整复跑（clean state），关键结论有独立复核
（直接查 SQLite / 检查 fixture repo / 重启进程 / 删除派生目录重建）。

---

## A. 最终推荐公共设施结构（只写实验真正支持的结构）

```text
AI Turn   → Vercel AI SDK Core（ai@7）+ DCF thin layer（Turn 契约 + reasoning 归一 + 工具失败语义）
Agent     → ACP（@agentclientprotocol/sdk）+ DcfAcpClient + AgentManifest 数据接入
Cognition → SQLite（bun:sqlite）权威 + LanceDB embedded 派生检索 + 极薄 QueryStrategy（RRF/temporal）
Evidence  → DCF 薄 Intake（借 HA 生命周期 / OTel ack 三段 / Redpanda cursor 机制）
World     → Becsy World + ExternalOperation 骨架统一管理所有外部异步能力的身份与生命周期
Fact      → Action/Evidence 事实权威（SQLite），与认知权威显式分离，无晋级通道
```

不能把本段读成实验前假设的复述：每一行都对应上表中的真实裁决与证据文件
（各实验 decision.md / metrics.json / results/*.json）。

## B. 第三方轮子继承表

| 轮子 | 直接采用 | 借机制 | 不采用 | 原因 |
| --- | ---: | ---: | ---: | --- |
| @lastolivegames/becsy 0.16.0 | ✓ | | | E0/上一轮实验双证；exact pin + 供应链风险已登记 |
| Vercel AI SDK（ai@7 + providers） | ✓ | | | E2 8 能力双路 PASS；thin layer 隔离上游 API 变化 |
| @agentclientprotocol/sdk + codex-acp + claude-agent-acp | ✓ | | | E1 双真实 Agent 互操作成立 |
| LanceDB embedded | ✓ | | | E3：永远只是派生检索，破坏实验全过 |
| @huggingface/transformers + bge-small-zh | ✓ | | | E3 固定 embedding backend（消变量裁决） |
| bun:sqlite | ✓ | | | 权威层零依赖 |
| OpenTelemetry Collector | | ✓ | ✓ | 早停：语义强扭 + 第二运行权威 + Go 定制（E4 B） |
| Redpanda Connect | | ✓ | ✓ | 早停：sidecar 运维面 + message 强扭（E4 C） |
| Home Assistant | | ✓ | ✓ | 只借生命周期状态机与注册去重纪律（E4 A） |
| LiteLLM | | | ✓ | 未触发对照组条件（无路由/池/fallback 缺口） |
| @ai-sdk/openai-compatible → Responses | | | ✓ | 计划禁止项（兼容层按 chat/completions 工作） |

## C. DCF 最终还必须自研什么（由实验结果重新生成，已压到最小）

1. **ExternalOperation 世界语义**（E0）：operation identity/状态机/lease/守卫顺序——
   511 LOC 核心桥，是所有外部能力的唯一生命周期权威；
2. **DCF AI Turn 契约 + thin adapter**（E2）：约 60 LOC——Turn 形状、reasoning 归一、
   工具失败的任务级语义（SDK 默认不判失败）；
3. **DcfAcpClient 边界语义**（E1）：TaskState/Activity/Permission 自有形状 +
   manifest 数据登记协议漂移；
4. **认知权威语义**（E3）：object/revision/anchor/relation 不可变模型 +
   build-manifest（索引状态可观察）+ QueryStrategy 组合规则；
5. **Evidence 语义**（E4）：四时间轴 RawEvidence、按来源分治的 WAL/cursor 策略、
   Source 生命周期监管；
6. **Reality Effect 语义**（E5）：ExpectedEffect/ObservedEffect 与执行状态的类型级分离；
7. **事实权威与认知权威的分层边界**（E5 [修订1]）：晋级路径必须显式不存在，
   直到正式定义认知形成/确认过程。

不再需要自研：AI Harness 工程（stream/tool/结构化/错误类型化）、Agent 适配器矩阵、
检索引擎内核、遥测管道、消息队列。

## D. 隐藏坑清单（本轮实际触发）

| 坑 | 归类 |
| --- | --- |
| Codex custom provider 使 app-server model/list 为空 → ACP 不可用（E0 F1） | 尚未解决（宿主配置兼容性需纳入 Source 健康检查） |
| ACP PromptRequest 字段名漂移 content vs prompt（E0 F2 / E1 F2） | 由 DCF manifest 数据吸收 |
| resume 能力声明 ≠ 可恢复（需 rollout 持久化）（E1 F1） | 由 DCF AgentSession 语义承担 |
| Becsy entity 句柄跨帧无效（E0 F3） | 由 opId 领域身份吸收 |
| 背压下"发完即忘"制造假丢失（E0 F4，E4 F1 独立复现） | 由 ack 契约吸收（必须写成接口约定） |
| 守卫顺序歧义（重复 vs 迟到）（E0 F5） | 由 DCF 守卫契约固定 |
| structured output API 形态变化（Output.object）（E2 F2） | 由 thin layer 吸收 |
| tool 失败被 SDK 回灌而非抛错（E2 F3） | 由 DCF thin layer 显式承担 |
| 中文 FTS 零召回（Lance tantivy / FTS5 同病）（E3 F1） | 尚未解决（P4 分词器选型前按精确/短语计） |
| LanceDB 句柄悬空 / teardown trace trap（E3 F2/F3） | 尚未解决（正式实现需 dispose 顺序或进程隔离） |
| Git 证据要求现实变化被提交（E5 F1） | 由 Evidence+Verifier 双通道设计吸收 |
| HF Hub 直连不可达（E3 F5） | 环境事实登记（镜像端点） |

## E. 架构变化建议

实验已经证明必须改变（accepted recommendation）：

1. 正式 Capability 施工的外部能力接入一律走 ExternalOperation 骨架，
   禁止 AI/ACP/DB/Probe 各自定义生命周期；
2. 认知数据面采用 SQLite 权威 + 派生世界分离，派生索引必须携带 build-manifest；
3. 事实（ObservedEffect）与认知对象分层落库，晋级通道在正式定义前保持不存在；
4. Evidence Source 的可靠性策略按"可否重放"分治，不统一上 WAL。

标记为 hypothesis（不得混入 accepted）：

- 语义引力场作为 QueryStrategy 的完整算法形态（本轮只证明架构位置）；
- ACP 未来覆盖更多 Agent 品牌时的字段漂移规模（样本=2 Agent）。

## F. 未测能力（如实登记，不用"理论上支持"替代）

- E1：permission request 真实触发路径（`PERMISSION_EXERCISE_INSUFFICIENT`）；
  tool_call/file_change/usage 事件的真实流经（`TOOL_EVENT_COVERAGE_PARTIAL`，
  E5 的 tool_call 活动部分补证）；OpenCode 等第三 Agent 未接入；
- E2：第二 Provider 为本机 Ollama（`SECOND_PROVIDER_LOCAL_ONLY`）；
  cache hit/miss 受控实验、多模态、真实 TCP 中断未做；
- E3：multivector/late interaction 未做（任务书允许不阻塞）；
  中文分词器到位后的 hybrid 重测；大规模语料性能；
- E4：B/C 路线无活管道（早停纪律允许，`STRUCTURAL_ASSESSMENT`）；
  跨机器/网络分区、>10k/s 速率未测；
- E5：长任务/多轮工具循环/并行任务；file/command 之外的现实断言类型；
- 全体：多进程 World 形态、生产安全加固、正式 migration（任务书 §10 明确本轮不测）。

---

## 证据索引

| 实验 | 目录 | 关键文件 |
| --- | --- | --- |
| E0 | e0-world-external-operation/ | decision.md / metrics.json / failures.md / tests(20) |
| E1 | e1-acp-agent/ | decision.md / metrics.json / results/e1-measurements.json |
| E2 | e2-ai-turn/ | decision.md / metrics.json / results/e2-matrix.json / probe-responses-shape.json |
| E3 | e3-cognition-data/ | decision.md / metrics.json / results/e3-results.json / e3-self-contained.json |
| E4 | e4-evidence-intake/ | decision.md / failures.md |
| E5 | e5-reality-loop/ | decision.md / failures.md / results/e5-results.json |

机器可读摘要：[decision.json](./decision.json)
