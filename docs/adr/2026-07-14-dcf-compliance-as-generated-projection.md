# ADR: 将正规化从人工平行维护改为自动辅助投影

Date: 2026-07-14  
Status: proposed

## Context

DCF 当前把正式性分散在源码、生成 userscript、Catalog、包 revision、测试、README、architecture-current、current-state、maintenance skill、ADR 和 PR 说明中。部分内容保护了系统，但大量信息由 AI 在每次修改中重复转述和同步，形成与功能改动无关的固定成本。最近局部改动的 PR 分别积累了 19、27、32 个提交，说明“保持正规”已经成为主要工作流，而不是功能改动的自动副产物。

正规化本身并不要求由 AI 手工维护所有正式文件。可确定性生成的材料应从少数权威事实派生出来，让 AI 把精力放在理解需求、控制修改范围、检查实现和承担最终判断上。

自动化的定位必须明确：它是 AI 的工具和执行器，不是独立于 AI 的第二套审核平台。系统是否合理、修改是否过度、架构是否应当变化以及结果是否可以接受，仍由维护这次修改的 AI 统一判断并负责。

## Proposed decision

- 把 DCF 的正规化改成“AI 统一判断 + 权威事实 + 自动辅助投影”，不再把多份手写文档当作并列真相。
- AI 先决定本次修改的目标、范围、实现方式、是否涉及架构，以及需要哪些验证；自动化不自行给修改分类，也不对 AI 建立另一套审批关系。
- 可以保留一份很小的 change note，用于告诉生成脚本本次用户可见结果和发布说明；它不是供 policy engine 审核的声明，也不与 diff 进行自治式裁决。
- 自动生成版本号关联材料、Catalog、hash、userscript/meta、包 JSON、发布事实、文档中的机器事实块和 ADR status index。
- 自动执行 AI 指定的相关测试、完整 verify、userscript 语法检查和确定性构建，并把结果、日志和 diff 汇总给 AI。
- 自动化可以发现机械不一致或测试失败，但它只报告事实。如何解释失败、是否修改、是否接受例外以及是否合并，由 AI 继续判断。
- README、current-state 和 architecture-current 中可从代码推导的内容使用生成块；块外只保留需要解释的稳定文字。
- ADR 只用于真正的长期决策变化。普通 bug、局部 UI、测试补强和既有契约内的 package revision 不自动创建 ADR。
- 快速修改路径允许 AI 先完成最小源码和相关测试，再调用一次自动收尾，把派生产物和机械证据补齐。

## Execution and location

- 自动辅助逻辑及模板随仓库版本化，放在 `scripts/` 和少量机器可读配置中；网页沙箱、Codex 工作区、本地 checkout 与 GitHub runner 都只是执行器，不保存唯一规则。
- GitHub Actions 的角色是远程执行仓库中的确定性命令：checkout、生成、构建、测试、汇总结果，必要时对严格白名单内的生成文件回写同一工作分支。
- GitHub Actions 不判断架构是否正确，不决定修改等级，不审批 AI，不拥有独立的合规真相，也不因一套自治政策替代 AI 的整体审查。
- Action 的失败只表示某个命令、测试或生成步骤没有成立；最终问题性质和处理方式由 AI 阅读源码、diff 与日志后判断。
- ChatGPT 的 GitHub 连接器用于读取和修改文件、创建分支/提交/PR、触发由提交带来的 Action、读取运行结果并继续修改。它不是 shell，因此需要 GitHub runner 或其他 checkout 环境执行仓库脚本。
- 若允许 Action 回写，只能写 userscript、meta、Catalog、包派生 JSON、自动文档块和自动报告；不得修改 `src/`、测试、ADR 正文、基本共识、架构解释或 workflow 自身。

## Intended workflow

```text
用户提出修改
→ AI 理解问题并审查当前实现
→ AI 选择最小修改范围
→ AI 修改源码与相关测试
→ 自动辅助脚本生成派生产物并执行命令
→ AI 阅读 diff、测试结果和浏览器现场证据
→ AI 修正或确认
→ AI 决定提交 / 合并
```

目标不是让修改通过另一套系统的许可，而是把机械劳动交给工具，使 AI 能更快、更完整地完成自己的审查与实现责任。

## What remains AI judgment

- 用户真正提出了什么问题，修改后的可观察结果是什么；
- 修改应当停留在局部实现，还是确实需要改变公共结构；
- 代码是否清楚、是否引入不必要抽象或重复状态；
- 测试是否证明了正确的东西，而不是只满足现有断言；
- 兼容历史是否值得保留；
- 自动生成结果与日志是否足以支持结论；
- 浏览器现场和用户体验是否符合意图；
- 最终是否提交、合并或继续修改。

## What should be automated

- userscript、meta、Catalog、hash 和 package JSON 的生成；
- 版本、包 revision 与生成物中的机械一致性；
- 文档中的版本、包、模块、命令、测试和发布事实块；
- ADR 索引和链接清单；
- AI 指定的测试、完整 verify、语法检查与确定性构建；
- 文件变化、生成物变化和测试输出的汇总；
- 手写源码增长、触及文件和变更扩散面的统计，供 AI 判断复杂度，而不是由工具自行裁决。

## Initial document audit

### 保留

- 源码与生成发布物分离并确定性构建；
- 自动测试、userscript 语法检查和远程执行能力；
- 单一权威状态、可恢复提交、用户数据与包默认值分离；
- Host 有界观察、禁止远程 JavaScript 和隐私边界；
- 真正改变长期架构决策时保留 ADR。

### 改为自动生成或辅助执行

- 版本号、Catalog、hash、package revision 与 userscript/meta；
- README、architecture-current 和 current-state 中的当前版本、包、模块、命令、测试与发布事实；
- ADR status index；
- PR 或提交说明中的文件变化、测试结果和生成物事实；
- 测试、构建、语法检查和结果汇总。

### 当前偏多或重复

- README、architecture-current、current-state、basic consensus 和 maintenance skill 同时复述当前架构；
- README 和 current-state 按版本重复保存已经由 ADR、Git 历史和 release diff 表达的变化；
- maintenance skill 同时承担操作纪律、架构说明、产品共识和版本新增规则；
- 普通局部修复被要求同步多份长期文档并新增 ADR；
- PR summary 由 AI 手工重述测试和生成物事实。

### 建议收缩后的职责

- `README.md`：产品入口、安装/构建命令和稳定边界；
- `architecture-current.md`：一份当前结构解释，机器事实使用生成块；
- `current-state.md`：只保存当前未完成事项、浏览器现场和下一步，不保存完整版本史；
- `dcf-maintenance-skill.md`：只保存维护动作与升级判定，不复述完整架构；
- `dcf-basic-consensus-prompt.md`：只保存价值目标和少量不可违背边界；
- ADR：只保存真实决策及其变化；status index 自动生成。

## Reconsideration condition

若自动辅助系统开始建立自治分类、审批门、复杂 policy、长期运行状态或大量例外规则，应立即收缩。它的成功标准是减少 AI 的机械劳动、让 AI 更容易完整审查修改，而不是把判断权转移给另一套平台。