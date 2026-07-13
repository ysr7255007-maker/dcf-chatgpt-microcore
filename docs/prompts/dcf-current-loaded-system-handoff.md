# 当前已加载 DCF 系统接手提示词

下面这段提示词用于把新的维护窗口或 Agent 接入当前 DCF 项目与用户浏览器现场。

---

接手 `ysr7255007-maker/dcf-chatgpt-microcore`，把它视为当前已经在用户 ChatGPT 页面中运行的个人认知基础设施，而不是一个等待从零设计的普通油猴脚本。

开始工作前，按顺序完整读取：

1. `README.md`
2. `docs/architecture-current.md`
3. `docs/dcf-basic-consensus-prompt.md`
4. `docs/dcf-maintenance-skill.md`
5. `docs/adr/status-index.md`
6. 当前 accepted ADR，尤其是：
   - `docs/adr/2026-07-13-dcf-unified-capability-reconciliation.md`
   - `docs/adr/2026-07-13-dcf-conversation-environment-architecture.md`
7. `docs/current-state.md`
8. 与用户当前需求直接相关的源码、测试和包定义

理解实现时以 `src/`、构建输入、Catalog 和测试为准；根 `dcf-chatgpt-microcore.user.js` 是生成发布物，不要把它当作首要源码入口。

当前仓库和用户浏览器已经完成 DCF `0.13.0` 迁移。用户浏览器最近一次真实 Runtime 体检结果为：

```text
schema: dcf.runtime.health.diff.v1
version: 0.13.0
primary_backend: gm
status: healthy
deviations: []
```

这证明当前体检覆盖的存储、内存 Runtime、真实 Shadow DOM、Host、observer、composer 和最近失败之间没有发现偏差；它不单独证明 Environment Profile、具体模块命令或弹药正文隔离等业务行为。后续若用户反馈与体检冲突，优先调查观察口径和真实调用链，不要修改产品去迎合诊断字段。

DCF 的价值目标是低摩擦语言弹药闭环：有价值的对话产生可复用语言，DCF 自动装填、更新并让它在未来对话中低摩擦发射。项目整体已经通过高维概念内联收拢为“对话驱动的个人认知环境回流运行时”：对话产生的内容、能力、界面和政策被编译回未来对话的条件。语言弹药拥有价值主权，通用内核拥有工程结构主权；底座可以重构，但不能削弱自动提取、自动装填、自动安装、自动更新和低摩擦发射。

当前架构必须这样理解：

- `dcf.state.root.v1` 是唯一权威状态，GM storage 是唯一权威写后端；
- `dcf.environment.snapshot.v1` 是从 root 和 registry 动态推导的只读期望对话环境，不是第二份状态；
- 所有持续影响未来对话的生产操作都必须编译为有限的 `dcf.intent.v1` Environment Intent，并经 Environment Reconciler 完成候选、验证、原子提交、Runtime 重投影和回执；
- 对话工件、包管理按钮、弹药增删、设置、外观、模块分区、Profile 和历史恢复不得因入口不同建立旁路；
- composer、clipboard、notification 等一次性 Host Effect 与环境事务分离；
- `DCF_MODULE_PACK` 是按值交付，`DCF_PACKAGE_UPDATE` 是按引用交付；GitHub Catalog 只是可信 Resolver，不执行远程 JavaScript；
- 包是不可变交付容器，content、action、view、style、policy 资源才是进入 Runtime 的能力单位；同一 package/revision 不得原地改写；
- 弹药、功能、包管理、维护是同一期望环境的内容、行动、构成、观察投影，正常页面由 `ui-view:*` 包资源拥有，Core 只保留安全宿主和最低恢复渲染；
- Environment Profile 保存包选择、政策和产品组织，不复制用户弹药正文；Profile 激活和快照恢复都是普通环境迁移；
- Runtime 体检只观察真实浏览器现场，并且必须独立于被检查的 UI 推导逻辑。

当前正式 Catalog 至少包含：

```text
dcf.standard.ammo@1.1.0
dcf.ui.runtime-workspace@1.0.0
dcf.ui.package-management@1.0.0
dcf.standard.shell-adjuster@1.0.0
```

已有 revision 不可变。普通功能、中文文案、布局、页面组织、控制顺序和声明式样式变化，优先发布对应能力包的新 revision，并通过对话完整包或 `DCF_PACKAGE_UPDATE` 让 DCF 自更新；不要默认提升整份 userscript。只有包协议、Resolver/Reconciler、存储、Host Adapter、权限、启动和恢复边界无法表达变化时，才升级 bootstrap 版本。

接到具体需求后，先判断它属于 Environment Intent、Action Intent、Artifact/Resolver、Resource Compiler、View Projection、Host Effect、Runtime Observation，还是 bootstrap 边界。先做源头检查和高维概念内联：确认现有环境语言是否已经能表达变化，避免为表面不同的入口或对象新增平行机制；同时保留真实边界，不得把权威状态与 Runtime、持久变化与一次性 Effect、用户成果与包默认、可信启动器与可更新资源混为一体。

实际修改时持续推进到真实阻塞，不要只给方案。生产持久入口不得绕过 Environment Reconciler，不得直接修改 registry，不得恢复双权威存储、整页历史扫描、远程代码执行或硬编码 UI 旁路。源码修改完成后更新必要测试与架构文档，执行 `npm run verify` 和 userscript 语法检查，回读生成版本、Catalog revision/hash，再通过 PR 合入。程序行为变化最后还要区分三类证据：源码与 CI、对应功能行为验收、当前浏览器 Runtime 体检。

当前没有已知 Runtime deviation。先以用户下一条需求为当前事项，在理解现有机制后继续工作，不要重新发明项目方向，也不要要求用户重复已经写入仓库的背景。