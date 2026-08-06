# dcf-chatgpt-microcore

DCF 是用户与 AI 共同维护的长期个人认知基础设施。

它的核心不是永久保存一份“绝对正确的过去”，而是让现实持续留下足以唤醒回忆的记录，让 AI 形成当前理解，让用户在复盘中补充和纠正，并把这些认知变化按时间追加保存。

> **记录负责唤醒，AI 负责起草，用户负责校准，时间负责纠错。**

## 当前仓库应怎样理解

当前 `main` 同时保存：

```text
当前设计权威
当前运行 / 实验证据
历史实现
旧产品回退材料
未来新实现入口
```

因此：

> **`main` 是历史与事实母线，不等于新 DCF 的代码结构母本。**

当前新施工继承 `main` 的历史，不继承旧 Chrome / Electron / userscript / legacy engine 的架构惯性。

## 当前权威入口

新 AI / 新施工任务首先读取 `AGENTS.md`。

当前设计与状态按以下顺序理解：

1. `docs/spec/2026-08-04-DCF-当前实施规范.md`  
   当前最高层总体实施权威。
2. `docs/spec/2026-08-06-DCF-功能包络与施工控制规范.md`  
   当前施工控制专项规范；对施工顺序、通路验证、依赖解锁和执行层权限，明确替代总规范旧第 19～20 节的 P0～P9 / G0～G9 阶段式调度语义。
3. `docs/spec/2026-08-05-DCF-macOS-AI实验宿主规范.md`  
   macOS 专用宿主与原生公共能力边界。
4. `docs/spec/2026-08-06-DCF-个人叙事功能块实施规范.md`  
   第一条正式认知产品闭环。
5. `docs/spec/2026-08-06-DCF-锚定认知世界与查询求解公共能力规范.md`  
   SQLite 锚定认知世界、查询诱导语义场与约束求解公共能力。
6. `docs/current-state.md`  
   当前已经冻结什么、旧代码真实处在哪里、下一步从哪里施工。
7. `docs/adr/`  
   历史推演与被替代路线。

旧愿景、旧 G1～G7、生长路线、Chrome `1.0.0-rc.3`、legacy、旧控制平面继续保留为历史、证据、回退和零件来源，但不得覆盖当前 `docs/spec/`。

## 当前施工模型

正式施工单位是：

> **功能包络（Capability Envelope）**

整个项目按能力有向无环图（Capability DAG）推进。

阶段名 / P0～P9 可以继续作为产品成熟度或人类理解视图，但不再决定实际施工顺序。

每个功能包络在交给执行层之前，设计层必须已经冻结：

```text
输入契约
输出契约
错误契约
状态变化
功能需求
质量 / 性能要求
依赖关系
最小功能通路验证
完整验收
```

执行 AI 只负责实现、验证、修复本包络和提供失败证据；无权为了降低施工难度修改功能契约或上游职责。

## 新原生实现

新的原生 DCF 实现统一从：

```text
native/
```

开始。

`native/` 不代表旧产品迁移目录，而是：

> **按照当前规范和正式功能包络重新生长的新实现世界。**

旧实现保持原位，不因为新施工而搬迁或重构。

复用方向只能是：

```text
新功能包络
↓
旧代码是否满足既定契约
↓
满足 → 复用
不满足 → 不继承
```

不得因为旧代码已经存在而修改新功能定义。

## 当前已经确定的底层方向

当前架构已经冻结的关键事实包括：

- 系统尽量拥有现实，DCF 自己拥有认知；
- macOS 公共事实面优先借用 `FSEvents + Spotlight`、`KnowledgeC / CoreDuet + NSWorkspace`、`IMK + Unified Logging Persist`、`launchd + XPC` 等系统能力；
- 正式长期认知采用 SQLite；
- 正式认知采用稳定对象 + 不可变修订 + revision/span 锚点；
- 语义索引和模型表示属于可重算投影；
- 个人叙事、项目叙事、Wiki、知识卡、语言弹药等认知功能不形成唯一中央流水线；
- 开放语义由查询 / AI 处理，明确封闭规则在需要时进入求解器。

详细边界以 `docs/spec/` 为准。

## 旧实现

仓库仍保存：

```text
chrome-extension/
dcf-chatgpt-microcore.user.js
engine/
packages/desktop-electron/
packages/target-adapter-chrome/
以及此前控制平面、Surface、Companion、seed 等实现与证据
```

这些内容继续用于：

- 历史追溯；
- 已验证旧行为；
- 可构建旧基线；
- 必要时回退；
- 经新功能包络验证后复用局部零件。

但它们默认属于：

> **legacy / historical implementation**

而不是新 DCF 的结构模板。

## 验证纪律

始终区分：

```text
observed
hypothesized
implemented_unverified
runtime_verified
behavior_passed
failed
not_tested
```

源码存在、旧测试通过、候选生成、通路验证通过和完整功能包络 `PASSED` 都不是同一层证据。

原则：

> **功能包络决定代码；代码不得反向定义功能包络。**
