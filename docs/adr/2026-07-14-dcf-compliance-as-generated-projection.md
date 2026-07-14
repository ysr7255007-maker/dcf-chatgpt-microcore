# ADR: 将合规从人工平行维护改为自动生成投影

Date: 2026-07-14  
Status: proposed

## Context

DCF 当前把正式性分散在源码、生成 userscript、Catalog、包 revision、测试、README、architecture-current、current-state、maintenance skill、ADR 和 PR 说明中。部分内容保护了系统，但大量信息由 AI 在每次修改中重复转述和同步，形成与功能改动无关的固定成本。最近局部改动的 PR 分别积累了 19、27、32 个提交，说明“保持合规”已经成为主要工作流，而不是功能改动的自动副产物。

正规化本身并不要求由 AI 手工维护所有正式文件。可机器判定的事实应从少数权威输入编译出来；只有涉及目标、边界、权衡和不可自动推导的决策才需要人或 AI 书写。

## Proposed decision

- 把 DCF 合规体系改成“权威事实 + 自动投影 + 例外决策”，不再把多份手写文档当作并列真相。
- 建立一个机器可读的 change manifest，记录本次变更类型、影响能力、是否改变公共契约、是否改变持久状态、是否需要迁移、对应测试和用户可见结果。
- 根据 change manifest 与源码 diff 自动选择 fast / package / core / architecture 四种验证路径，而不是由 AI 每次自由扩张流程。
- 自动生成或校验版本号、Catalog、不可变 package revision、hash、生成 userscript/meta、发布摘要、PR 验证区、current-state 的版本与能力清单、ADR status index 和架构清单中的可推导部分。
- 把架构不变量写成可执行检查，例如单一权威状态、禁止生产旁路、禁止远程 JavaScript、生成物确定性、旧 revision 不可变、Host 观察有界和隐私字段禁止出现。
- README、current-state 和 architecture-current 中由代码或 manifest 可得的部分使用生成块；块外只保留需要解释的稳定文字。
- ADR 只用于无法由源码和测试推出的真实决策变化。普通 bug、局部 UI、测试补强和既有契约内的 package revision 不自动创建 ADR。
- AI 的职责改为实现功能、填写最小 change manifest、处理无法自动判定的例外和解释失败；合规工具负责派生、检查和生成正式材料。
- 快速修改路径允许先修改最小源码和相关测试，随后一次命令自动补齐所有适用合规产物并拒绝不一致提交。

## Intended workflow

```text
用户需求
→ 最小实现与相关测试
→ change manifest
→ policy engine 识别变更等级
→ 自动生成发布物和文档投影
→ 分级验证
→ 一次干净提交 / PR
```

目标不是降低保护标准，而是让保护标准成为修改的护栏和自动收尾器，而不是每次修改前后都要人工重建的工程主体。

## What remains human or AI judgment

- 是否改变产品目标、责任边界或权威状态模型；
- 两个真实方案之间的权衡；
- 兼容历史是否值得保留；
- 新抽象是否已有足够真实消费者；
- 浏览器现场验收和用户体验是否符合意图。

## What should be automated

- 版本与包 revision 一致性；
- 生成物、Catalog 与 hash；
- 受影响测试集合和最终完整 verify；
- 架构不变量；
- 文档中的版本、模块、包、命令、测试和发布清单；
- PR summary 的事实部分；
- ADR 索引生成和链接有效性；
- 复杂度预算，包括手写源码增长、触及层数、状态新增和变更扩散面。

## Reconsideration condition

若自动生成系统本身开始要求维护大量新的 schema、同步层和例外规则，应回退到更小的脚本集合。该机制的成功标准是局部修改的人工步骤和完成时间显著下降，而不是生成更多形式完整的文件。
