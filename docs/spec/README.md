# DCF 当前规范入口

更新：2026-08-09  
状态：**当前规范权威索引**

实现、设计、验收与人工阅读时，先读本文件，再按问题进入对应规范。

规范只描述**当前成立的结构与要求**；架构为什么发生变化，统一进入 `docs/adr/`。

## 当前权威顺序

1. `2026-08-08-DCF-当前架构与实施规范.md`
   - 当前整体实现架构最高权威；
   - 当前普通后台采用 Shared World / Mature ECS 体质；
   - Capability 边界采用 Executable Semantic Seam；
   - Standalone 使用 Minimal Realization 补齐缺失环境；
   - Composite Runtime 必须自动收敛唯一运行权威；
   - AI Workflow 与 Ordinary Backend 分离；
   - PostgreSQL 继续作为 durable state 重要底座；
   - Replaceable Surface Runtime / Surface Contract 继续成立；
   - Bevy ECS vs Flecs、Ordinary Backend 最终语言等仍保持开放。

2. `2026-08-07-DCF-Capability-Registry-v1与能力发现收口规范.md`
   - Capability 身份、产品主权与 Discovery 状态最高权威；
   - Registry v1 共 15 项；
   - `现实闭环行动` 为 `DISCOVERY_DEFERRED`；
   - 三种交互 Capability：`全景沉浸交互`、`嵌入式交互`、`环境微交互`。

3. `2026-08-08-DCF-沉浸式认知交互与游戏设计谱系规范.md`
   - `全景沉浸交互` 的当前专项产品与设计权威；
   - “游戏级认知交互”继续作为产品上限；
   - “剧本替换测试”、Reality Canon 与可编辑叙事继续有效；
   - 不决定最终 Surface Runtime。

4. `2026-08-07-DCF-Capability与公共设施当前规范.md`
   - Public Facility、Provider / Probe、Shared Semantic Component、ExternalOperation 等既有边界与历史实验结论来源；
   - 其中 Bun+Becsy / World 的具体实施要求，以第 1 项和最新 ADR 为准；
   - Public Facility 不得与 Executable Semantic Seam 混为一类。

5. `2026-08-07-DCF-证据采集与多源证据编译增量规范.md`
   - `证据源采集管理` 与 `多源证据编译` 的专项业务边界。

6. `2026-08-06-DCF-功能包络与施工控制规范.md`
   - Capability Envelope 与施工状态控制来源；
   - 后续逐项 Capability 施工需要补充 Executable Semantic Seam、Minimal Realization、Standalone / Composite / Minimal Emergence 验收信息；
   - 具体运行实现按第 1 项当前架构执行。

7. `2026-08-04-DCF-当前实施规范.md` 与其他专项规范
   - 长期价值、历史不可静默覆写、各 Capability 的产品需求继续有效；
   - 若涉及已经更新的运行结构或 UI 固定实现，以更高权威规范为准。

8. `../current-state.md`
   - 只记录当前确定事项、真实证据状态和下一步。

9. `../adr/`
   - 只记录为什么做出架构变化、替代了什么以及决策边界；
   - Capability World 历史实验 ADR：`2026-08-07-capability-world-composition-runtime-seam-absorption.md`；
   - 当前 Capability 组合方法 ADR：`2026-08-09-executable-semantic-seam-and-minimal-emergence-proof.md`；
   - 旧 Go + DBOS 转向 ADR：`2026-08-08-go-dbos-workflow-and-replaceable-ui.md`，现保留为历史，不再代表当前 Ordinary Backend 权威；
   - 当前沉浸式交互方法 ADR：`2026-08-09-editable-narrative-and-surface-runtime-boundary.md`。

## 文档职责

```text
当前架构 / 当前实施要求
→ docs/spec/

为什么这样改 / 替代过程 / 被拒绝方案
→ docs/adr/

当前做到哪里 / 下一步是什么
→ docs/current-state.md
```

禁止把上述三类内容重新混写在同一份“当前架构规范”中。

## 冲突处理

若旧规范与当前更高权威规范冲突：

> **旧文档保留历史价值，当前实施使用更新权威。**

若新想法尚未成为当前施工项：

> **不得写入当前架构规范；需要保留时进入讨论记录或新的候选 ADR。**

若未来正式改变当前架构：

> **先新增 ADR 记录原因，再更新当前规范为变化后的静态结构。**
