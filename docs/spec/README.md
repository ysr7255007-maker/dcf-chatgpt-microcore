# DCF 当前规范入口

更新：2026-08-08  
状态：**当前规范权威索引**

本目录存在多轮连续推演留下的规范。实现、设计、验收与人工阅读时，**先读本文件，再按作用域读取对应最高权威**。旧文件保留历史价值，但不得与更新裁决争夺当前实施权威。

## 当前权威顺序

1. `2026-08-08-DCF-Workflow执行底座、机器特化后置与可替换UI架构规范.md`
   - 当前运行时、Workflow、主实现语言、机器优化演化与 UI 可替换性的最高增量权威；
   - 冻结当前方向：Go 默认执行宿主 + DBOS Go 长期 Workflow + PostgreSQL durable state；
   - 冻结 `Late Machine Specialization`：普通 Effect 默认 Go，真实瓶颈出现后再晋升专用 P0 Backend；
   - 不要求前期穷举 Effect，不建立全局 ECS，不建立中央上帝优化器；
   - 冻结 `Function Hard, UI Soft` 与 `Replaceable UI`：Shell / Navigation / Panel / Layout / Controls / Theme 都可替换；
   - 明确旧 Bun+Becsy / 全局 ECS 运行前提降级为历史证据与局部候选；
   - 该规范**不修改 Capability Registry v1 身份**，也不静默推翻既有 Cognition Data SQLite Authority。
2. `2026-08-07-DCF-Capability-Registry-v1与能力发现收口规范.md`
   - 当前 Capability（能力）发现、产品主权与 Registry 身份最高权威；
   - 正式关闭本轮开放式 Capability Discovery；
   - 冻结 Capability Registry v1：15 项进入定型，`现实闭环行动` 状态为 `DISCOVERY_DEFERRED`；
   - 冻结三种交互能力名称：`全景沉浸交互`、`嵌入式交互`、`环境微交互`；
   - 其中把 ECS / World / Bun 写成全局当前运行切线的部分，已被第 1 项更新；Capability 身份与产品主权结论继续有效。
3. `2026-08-07-DCF-Capability与公共设施当前规范.md`
   - Public Facility（公共设施）、Provider（提供者）、Shared Semantic Component（共享语义组件）、ExternalOperation（外部操作）等高层边界与 E0–E5 历史证据来源；
   - 其中 `Standalone/Composite Becsy World`、`World 内唯一运行主权` 与 Bun+Becsy 作为默认正式组合的表述，按第 1 项解释为上一阶段已验证路线，不再拥有当前全局运行主权；
   - AI Turn、ACP Agent、Evidence Intake、Cognition Data 等专项证据仍继续有效，除非有更新专项规范显式替代。
4. `2026-08-07-DCF-证据采集与多源证据编译增量规范.md`
   - `证据源采集管理` 与 `多源证据编译` 的最新专项边界；
   - 明确采集侧负责输入复杂度、编译侧负责输出复杂度；
   - 其中依赖 ECS 作为全局公共语义运行面的表述，按第 1 项降级；“上游不硬编码消费者、下游不硬编码生产者”的关系解耦目标继续保留，但实现机制重新开放。
5. `2026-08-06-DCF-功能包络与施工控制规范.md`
   - 当前 Capability Envelope 与施工状态控制来源；
   - Registry 身份与 Envelope 施工状态分离继续有效；
   - Capability Discovery 已收口，后续逐项关闭 Envelope；
   - 若施工步骤要求必须进入 Becsy Standalone / Composite World，以第 1 项新的 Workflow / Go 执行底座为准重新解释。
6. `2026-08-04-DCF-当前实施规范.md`
   - DCF 长期价值、现实 / 认知 / 行动分层、历史不可静默覆写等仍有效；
   - 其中与 08-07 / 08-08 新规范冲突的内部流水与旧施工结构降级为历史推演。
7. `2026-08-06-DCF-锚定认知世界与查询求解公共能力规范.md`
   - 认知对象、修订、锚点、求解器等业务语义仍是重要来源；
   - 查询与持久化采用其专项最新裁决；DBOS 使用 PostgreSQL 不自动迁移既有 Cognition Data SQLite Authority。
8. `2026-08-06-DCF-个人叙事功能块实施规范.md` 及 2026-08-05 各专项规范
   - 继续作为功能需求和历史产品设计来源；
   - 具体 Sidebar / Panel / 三列布局 / 视觉交互若与“可替换 UI”原则冲突，视为第一版设计方案，不得获得不可修改架构地位。
9. `../current-state.md`
   - 只记录当前已经确定什么、证据真实处在哪里、下一步做什么。
10. `../adr/`
   - 保存为什么发生这些变化、实验依据和被替代路线；
   - 2026-08-08 当前运行时转向依据：`2026-08-08-workflow-go-dbos-postgresql-late-specialization-replaceable-ui.md`；
   - 2026-08-07 Capability 收口依据：`2026-08-07-capability-discovery-closure-product-sovereignty-three-cuts.md`。

## 作用域优先原则

DCF 不再把“最新文档”机械解释成可以覆盖所有旧专项结论。

例如：

```text
Capability 身份
→ 读 Registry v1

Workflow / 主运行时 / UI 可替换性
→ 读 2026-08-08 新规范

Cognition Data 当前权威存储
→ 读对应专项规范
```

新规范只能在自己的作用域内拥有更高权威；跨作用域修改必须显式声明。

## 冲突处理

若旧规范与当前更高权威规范冲突：

> **保留旧文本作为历史，不做静默覆写；实施时以对应作用域的更新裁决为准。**

若新想法尚无行为证据：

> **明确写成架构方向 / 候选 / 待验证，不得冒充 behavior_passed。**

若未来实验推翻当前裁决：

> **新增显式 ADR / 新规范记录转变，不删除本轮历史。**
