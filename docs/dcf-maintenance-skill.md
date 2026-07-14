# DCF 维护技能

本文件维护 DCF 的实际改动纪律。维护目标不是保持某一版代码形状，而是在不把内部复杂度交还给用户的前提下，持续维护“低摩擦语言弹药闭环”及其期望对话环境。

## 一、开始维护前先建立两份事实

先分别确认：

1. **仓库事实**：读取 `README.md`、`docs/architecture-current.md`、`docs/dcf-basic-consensus-prompt.md`、本文件、`docs/adr/status-index.md`、相关 ADR 和 `docs/current-state.md`。理解源码时以 `src/` 与构建输入为准，根 `.user.js` 只是生成发布物。
2. **当前浏览器事实**：用户当前加载的 userscript 版本、主存储后端、当前 Runtime 体检和实际操作反馈。仓库最新版本不等于用户已经加载该版本；健康体检也只证明其覆盖的 Runtime 观察面无偏差，不替代具体功能行为验收。

两份事实冲突时，先判断是未更新、迁移未完成、Runtime 偏差，还是诊断口径错误，不得根据仓库推断浏览器已经处于相同状态。

## 二、先判断变化属于哪一层

维护前把需求归入：

- 第一方语言弹药产品能力；
- Environment Intent 或 Action Intent；
- Artifact / Resolver / transport；
- content、action、view、style、policy Resource Compiler；
- 声明式 View Projection；
- ChatGPT Host Adapter 与一次性 Host Effect；
- Core 状态、事务、启动、权限或恢复边界；
- 构建与发布流程。

先做源头检查：现有 Intent、资源类型、View、Profile 或适配器是否已经能表达该变化。只有多个真实能力共同需要且现有环境语言无法表达时，才扩展 Core。语言弹药体验优先改 ammo 包；普通文案、布局、页面组织和控制顺序优先改对应能力包 revision；ChatGPT DOM 变化只进入 Host Adapter。

## 三、期望对话环境是统一架构对象

`dcf.state.root.v1` 继续是唯一权威状态；`dcf.environment.snapshot.v1` 只是从 root 与 registry 动态推导的只读 Facade，不得成为第二份需要同步的状态。

所有持续影响未来对话的生产操作都必须表达为有限的 `dcf.intent.v1` Environment Intent，并经 Environment Reconciler 进入：

```text
Intent / Artifact
→ 候选环境迁移
→ 根与资源不变量验证
→ 确定性投影
→ 旧根快照
→ 单根原子提交
→ Runtime 重投影
→ 协调回执
```

包安装、启停、revision 切换、用户内容增删、设置、偏好、外观、模块分区、Profile 和历史恢复不得因入口不同建立业务旁路。UI、模块命令、维护工具、对话工件和菜单只负责发出 Intent。生产入口不得直接修改 root、registry，或绕过 Reconciler 调用独立保存路径。

一次性 composer、clipboard、notification 等 Action / Host Effect 与环境事务分离。Effect 失败只形成 effect receipt，不回滚已经独立成立的环境变化，也不得把一次性结果写成长期环境事实。

## 四、工件、包与资源必须分清

外部 `DCF_AMMO`、完整 `DCF_MODULE_PACK`、引用式 `DCF_PACKAGE_UPDATE`、手动 JSON、内嵌第一方包和 GitHub Catalog 都只是工件输入或寻址方式。

- 完整包是按值交付；
- 更新控制是按引用交付；
- GitHub 只解析可信 Catalog、下载并校验 JSON；
- 取得完整工件后统一编译为 Intent 并进入 Environment Reconciler；
- 禁止远程 JavaScript、`eval`、运行时分块引擎和 localStorage-as-code。

包 revision 不可变。同一 package/revision 内容不同必须拒绝。修改正式包内容时创建新 revision，不能原地重写 Catalog 中已有 revision。包只是交付容器；进入 Runtime 的能力单位是具有稳定地址、提供者、替换/扩展规则、投影目标和观察契约的 content、action、view、style、policy 资源。

包默认资源与用户成果分离。可选包卸载或 Profile 切换不得删除用户弹药、用户设置和其他用户生成结果。`dcf.standard.ammo` 是价值闭环所需第一方核心包，不通过正常包管理停用或卸载。

## 五、页面与产品组织

弹药、功能、包管理、维护是同一期望环境的内容、行动、构成、观察投影。正常页面由包声明的 `ui-view:*` 资源拥有；Core 只保留安全宿主、稳定操作协议、HTML 转义、最低回退与恢复渲染。

安装包、Runtime 模块、日常功能和维护工具是不同事实：

- 包管理只表达包、来源和 revision；
- 功能承载日常行动资源；
- 维护承载观察、诊断、作者、布局和恢复工具；
- 弹药承载内容资源和低摩擦发射；
- `hidden` 不是产品角色，所有非弹药模块都必须在日常或维护保留可发现标题。

界面密度使用展开/折叠。折叠状态只写可丢弃的 `dcf.ui.session.v1`，不得进入权威根、Profile、moduleDisplay 或包定义。

## 六、语言弹药调用与更新协议

语言弹药正文是长期沉淀的高密度意图，不应在脱离原始语境后被当作用户此刻逐字确认的机械命令。

发射时使用轻量调用包络：

```text
〔DCF·语言弹药〕

<弹药正文>
```

调用标志要求接收窗口先进行当前语境重解释：识别弹药想解决的核心问题，对照当前项目阶段、对象和约束，再把它转换成当前对话中的具体要求。落地清楚时直接适配并执行；只有关键含义与现场冲突，或存在无法可靠选择的多种落地方式时才确认。调用协议不得演化成“所有弹药都先提问”的固定摩擦。

更新是对同一长期资源的修订，不是普通文本润色。更新请求必须同时携带：

- `〔DCF·弹药更新〕` 标志；
- 当前弹药的完整身份与正文；
- 以当前对话为修订语境的说明；
- 保留仍成立部分、吸收稳定变化、避免机械摘要和另建相似弹药的规则；
- 保持相同 `id` 并返回完整 `DCF_AMMO` 工件的输出协议。

更新结果进入正常 `DCF_AMMO` 摄取与 Environment Reconciler 路径。当前对话只是变更依据，不应被整段复制进弹药；只有真正改变核心意图、适用范围、使用方式或关键边界的认识才进入长期正文。

调用标志、更新标志与更新规则由 `dcf.standard.ammo` 的 `ammo_protocol` policy 拥有；bootstrap 只保留与当前正式 policy 等价的安全回退。普通协议措辞调整发布新的 ammo package revision，不默认升级 userscript。复制操作继续导出原始正文；只有发射操作构造调用包络。

## 七、Environment Profile 与恢复

Environment Profile 用于保存包选择、政策和产品组织，不复制用户弹药正文。激活 Profile 必须验证所引用的包和 revision 已安装，再作为普通环境迁移原子提交。环境在激活后被单独修改时，应明确产生漂移，而不是继续宣称等于原 Profile。

历史快照恢复是“选择过去环境作为新的目标环境”，必须重新经过验证、投影、提交和回执，不能维护反向补丁路径。旧存储迁移同样作为环境材料来源进入候选合并；GM storage 可用时仍是唯一权威写后端，page `localStorage` 仅作为显式迁移输入。

## 八、Host、命令、证据与隐私

对话摄取只通过 Host Adapter 观察 `main` / `[role=main]` 的新增节点和当前流式助手回复，完成后只读一次。禁止观察 `document.body`、全页 `innerText`、枚举全部历史消息或恢复页面块账本；启动补偿必须有固定回复数与硬访问上限。

命令渲染与执行共用同一 `commandList`。持久步骤发出 Environment Intent；composer、clipboard、notification 等步骤进入 Effect Runner。不得同时保留硬编码 UI 旁路。

回执和证据默认对正文、提示词、内容、凭据和认证信息做长度/hash 脱敏。普通成功保持安静；失败形成可复制回执。证据不得改变被观察行为。

## 九、Runtime 体检边界

源码逻辑、schema、事务、构建和兼容问题由源码审查、单元测试、集成测试、CI 与真实浏览器冒烟解决。`dcf.runtime.health.diff.v1` 只回答通过测试的代码在用户当前标签页实际运行成了什么。

体检必须独立观察实际存储、内存 root/registry、真实 Shadow DOM、host 数量与几何、当前 ChatGPT root、observer、composer 和最近失败。健康时只报告 `deviations: []`；异常只附证明偏差所需的最小证据。体检不得复用被检查 UI 的同一结论函数来证明 UI 正确。

用户现场与体检冲突时，先审查体检观察口径和调用链。不得修改产品去迎合错误诊断字段。健康报告不单独证明 Profile 行为、弹药正文隔离或某个命令的业务效果，这些仍需对应功能验收。

## 十、壳体与样式所有权

壳体几何只来自用户 appearance 环境状态和通用 appearance Intent。任何包或用户 CSS 不得声明 `.sh` 的 position、边界、宽高、min/max 或 transform。最终显示必须经过 `visualViewport` 与真实 shell rect 围栏。

## 十一、发布与验收

源码只改 `src/` 与构建输入；根 `.user.js`、`.meta.js` 和 Catalog 由 `npm run build` 生成。

发布前必须：

1. 执行 `npm run verify`；
2. 执行 `node --check dcf-chatgpt-microcore.user.js`；
3. 回读版本、Catalog package/revision/hash 和生成物一致性；
4. 确认无 `eval`、远程代码或生产持久操作旁路；
5. 执行真实浏览器的工件摄取、低摩擦发射及本次变化对应的行为冒烟；
6. 最后运行 Runtime 体检，区分代码验证、功能验收和现场偏差三类证据。

语言弹药协议变更还必须验证：发射消息只有轻量调用标志与正文；更新消息包含完整原弹药、实质修订规则和完整 `DCF_AMMO` 返回要求；复制仍保持原始正文。

普通产品功能、文案、布局、页面组织、控制顺序和声明式样式变化只升级对应能力包 revision。只有现有包协议、Resolver/Reconciler、存储、Host Adapter、权限、启动与恢复边界无法表达变化时，才发布新的 bootstrap userscript 版本。

架构变化同步更新 `docs/architecture-current.md`、新 ADR、`docs/adr/status-index.md`、本文件、基本共识和 `docs/current-state.md`。旧 ADR 保留历史正文，当前决策以 status index 为准。


## 十一、重复能力与模块替代

发现功能、维护或包管理中存在相似对象时，不得按中文标题去重。先比较稳定 module ID、命令集合、资源所有权和用户数据边界；只有一个活动实现已经完整接管另一个实现时，才由新模块显式声明 `supersedes`。

替代前先吸收旧实现仍有价值的独有能力。替代关系必须使用精确 ID，冲突或循环在候选投影阶段失败。替代模块不在时旧模块继续可达；替代成立时旧模块退出功能、维护和分区管理，纯旧模块包移入折叠历史区，但不自动删除 revision 或用户成果。需要彻底删除时由用户在历史区显式卸载。


## 十二、长对话性能治理

处理 ChatGPT 网页卡顿时先区分浏览器渲染、服务端延迟、模型上下文和扩展冲突。DCF 只对自己可观察且可逆的浏览器渲染层负责。默认优先使用 `content-visibility:auto`；只有用户显式选择窗口模式时才让旧 turn 退出显示。不得删除、替换、克隆或重写 ChatGPT 管理的消息节点，不得在流式生成期间重排历史 turn。

Host DOM 选择器是可变适配层，不得写进权威状态。持久模式、阈值和窗口大小属于 package policy / user preference，经 Environment Reconciler 变化。性能报告不得包含消息正文、代码、附件、标题或用户输入，只保留数量、支持性、选择器策略、long-task 聚合和控制器状态。宿主结构无法可靠识别时应退化为不操作，而不是扩大选择器范围。


## 十三、Runtime 性能归因

主线程阻塞排查先用有界 Runtime 归因会话，不再只凭 Long Task 数量或体感猜来源。优先采集 Long Animation Frames 的脚本、渲染、样式/布局和 blockingDuration；以 Event Timing 区分 input delay、processing 与 presentation delay；以 layout-shift 判断页面跳动；传统 longtask 仅作不支持 LoAF 时的兜底。

归因报告必须把事实和推断分开。LoAF 的 sourceFunctionName 是入口点，不一定是最耗时的内部函数；脚本、渲染和布局时间可能重叠，不能相加后宣称为独占 CPU；扩展 isolated world、跨域和未知任务可能无法归因。DCF 自身必须使用独立计时报告 apply 次数、原因、总时长和最大时长，不能因 LoAF 没列出 userscript 就宣称零开销。

性能会话属于一次性 Action，不写 root、Profile 或 registry。只保留有界时序和聚合数据，脚本来源去掉 query/hash 并缩减为 host 与末级路径；禁止 DOM 文本、消息正文、事件 target、完整 URL、stack、附件和认证数据。
