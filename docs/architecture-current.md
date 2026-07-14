# DCF 当前架构

Updated: 2026-07-14  
Current release: `0.18.0`

## 1. 价值与工程关系

DCF 的产品价值是低摩擦语言弹药闭环：有价值对话产生可复用语言，自动装填、更新并在后续对话中发射。语言弹药拥有价值主权；通用内核拥有工程结构主权。架构可以重构实现，不能把内部复杂度重新交还给用户。

## 2. 源码与发布

源码位于 `src/`，由 `scripts/build-userscript.js` 确定性生成一个完整 userscript、meta 和 catalog。禁止运行时远程 JavaScript、eval、分块引擎和 localStorage-as-code。

## 3. 权威状态与事务

`dcf.state.root.v1` 是唯一权威状态。GM storage 可用时是唯一权威写后端；page `localStorage` 只作为旧版本迁移输入。

所有权威变化统一经过：

```text
Intent / typed Artifact
→ candidate transition
→ root/resource validation
→ deterministic projection
→ snapshot old root
→ one root commit
→ derived registry
→ receipt
```

包 revision 不可变。用户弹药、设置、外观和产品角色覆盖与包定义分离。

## 4. Transport、Host 与 Effect

回复中的 `DCF_AMMO`、完整 `DCF_MODULE_PACK`、引用式 `DCF_PACKAGE_UPDATE`、手动 JSON 和固定 GitHub catalog 都先进入统一工件入口。完整包按值进入；更新控制按引用经 Resolver 取得完整包；随后统一进入 Reconciler、候选验证、原子提交与 Runtime 重投影。

ChatGPT DOM 只由 Host Adapter 接触。它负责当前回复监听、composer、发送、剪贴板、通知和导航变化。回复摄取只观察 `main` / `[role=main]` 的新增节点及当前流式回复，不扫描整页和完整历史。

本地状态事务与外部 effect 分离。发送、复制或通知失败不能破坏无关权威状态。

## 5. 包、运行模块与产品分区

- **安装包**：在 `包管理` 中管理 revision、启停和卸载。
- **运行模块**：由启用包贡献并进入 registry 的可执行能力。
- **日常功能**：主力工作流，进入 `功能`。
- **维护工具**：探针、诊断、验收、作者、布局与恢复工具，进入 `维护`。
- **弹药模块**：由独立弹药页承载核心闭环。

`hidden` 不再是产品角色。旧包或旧用户状态中的 `hidden:true` 只作为无效兼容残留，不得让运行模块失去入口。所有非弹药运行模块必须在日常或维护分区保留可发现标题。

界面密度只通过模块卡片展开/折叠处理。折叠状态保存在可丢弃的 `dcf.ui.session.v1.collapsed_modules`；它不进入权威根、不走事务、不修改 `moduleDisplay` 或包 revision。日常模块默认展开，维护模块默认折叠，用户可逐项改变。

## 6. Runtime 体检边界

代码逻辑、schema、事务与构建正确性由源码审查、单元测试、集成测试、CI 和浏览器自动化负责。一键体检不重复验证代码本身，而是回答同一份通过测试的代码在用户当前浏览器标签页里实际运行成了什么。

`dcf.runtime.health.diff.v1` 从真实 Runtime 观察：

- 当前 userscript Runtime 对象与可见版本；
- 权威浏览器存储与内存 root；
- 内存 registry 与真实 Shadow DOM 包/模块入口；
- host 数量、连接状态、壳体真实矩形及 viewport；
- ChatGPT conversation root、回复 observer 和 composer；
- 旧存储桥接结果与最近失败回执。

体检不输出完整状态百科。健康时只有 `deviations: []`。异常时每条偏差只包含 code、严重度、期望、实际值、最小证据和说明。

模块入口检查不复用 UI 的角色分类函数：它直接比较 registry 中全部非弹药模块 ID 与真实日常＋维护 DOM 中出现的模块标题 ID。折叠卡片仍保留标题，因此被视为可发现。

体检不包含对话正文、弹药正文、完整包 payload、命令参数、令牌或认证信息。

## 7. 迁移与恢复

启动时可读取 0.10.0 package/user/ops 及更早 registry。旧数据以候选合并进入当前 GM root；当前值优先，缺失值补回，每个旧包先验证投影。冲突包必须进入 `system.storage_bridge.skipped`，不能静默消失。

回退选择旧 root 快照，并重新经过验证、投影、提交和回执。

## 8. 验证边界

发布必须通过：

- 自动弹药摄取与低摩擦发射；
- 语言弹药调用标志、更新协议和原始复制边界；
- 模块化源码到完整 userscript 的确定性构建；
- 单一权威根与统一事务；
- 双存储迁移和桥接幂等；
- 旧模块命令兼容；
- 日常/维护角色与折叠状态分离；
- Runtime 健康报告的真实 DOM 偏差检测和隐私边界；
- 有界 Host Adapter；
- catalog、viewport、语法和发布一致性。

ChatGPT 历史消息虚拟化仍属于二期。

## 9. 统一能力重协调（0.12.0）

`root.packages` 不再只被描述为安装记录，而是当前期望能力集合。安装、更新、启停、切换和回滚都是期望集合变化；registry 与 UI 是其 Runtime 投影。

工件入口支持两种等价寻址：

- `DCF_MODULE_PACK`：按值携带完整不可变 revision；
- `DCF_PACKAGE_UPDATE`：按引用指定 package、target 与 channel，由固定 Catalog Resolver 拉取并校验。

两者获得完整工件后进入同一个 `dcf.reconcile.result.v1` 路径。成功提交立即重建 registry，并触发当前 UI 重新渲染；失败不改变旧根。

正常产品 UI 逐步由包声明的 `ui-view:*` 资源拥有。`dcf.ui.package-management` 是首个必需的声明式 UI 包，当前负责包管理页标题、文案、操作顺序、密度与样式。Core 只保留安全转义、稳定操作协议和最低恢复渲染器，不执行远程 JavaScript。

## 10. 期望对话环境架构（0.13.0）

`dcf.environment.snapshot.v1` 从唯一权威根和 registry 推导能力构成、用户认知资源、环境政策、产品组织、Profile 与来源，不另建第二状态。所有持久变化先成为 `dcf.intent.v1`，Artifact 只是 Intent 所需材料。Environment Reconciler 统一包、用户资源、政策、Profile 与历史恢复。registry 发布 content/action/view/style/policy 资源图及观察契约。弹药、功能、构成、维护四页均是包拥有的环境投影。Environment Profile 不复制弹药正文；激活 Profile 和恢复快照都属于环境迁移。

## 11. 语言弹药调用与更新协议（0.14.0）

发射不再裸发送弹药正文，而是构造：

```text
〔DCF·语言弹药〕

<弹药正文>
```

标志用于声明这是一枚历史沉淀的高密度长期意图。接收窗口应结合当前项目和对话进行二次理解：清楚时适配后执行，关键冲突或无法可靠选择的多义落地才确认。它不是每次发射都要求提问的流程门。

更新请求使用 `〔DCF·弹药更新〕`，并同时携带完整原弹药、当前对话作为修订依据的说明、保留/修正规则以及返回完整同 `id` `DCF_AMMO` 的输出协议。更新不是普通润色，也不是把当前对话机械摘要进正文。

`dcf.standard.ammo@1.2.0` 通过 `policy-default:ammo_protocol` 拥有调用标志和更新规则。`ammo.js` 从 registry policy 读取协议，并只保留等价安全回退。复制操作仍导出原始正文；调用包络只用于发射。


## 12. 模块替代与工作台收口（0.15.0）

模块重复不再通过中文标题或相似功能猜测。活动模块可以用 `supersedes` 声明被其完整接管的稳定旧 module ID；投影器验证冲突与循环后，从正常 Runtime modules 中移除已替代对象，并发布 `dcf.runtime.module-supersession.v1` 关系。替代模块不存在时，旧模块仍保持可达，作为恢复退路。

包不会因替代而被自动删除。只有当一个包的全部运行模块均已被替代，且没有其他独立 content/view/style/policy 资源时，它才从包管理主列表移入折叠的“已替代历史包”区域。

`dcf.standard.ammo@1.3.0` 将 `dcf.ammo_workbench`、`dcf.ammo_workspace.unified`、`dcf.language_ammo` 收口到 `dcf.ammo.module`。正式语言弹药工作台同时提供提取、新建、编辑、查找、语境化发射、复制、实质更新和删除；因此退出的是过渡入口，不是仍未接管的能力。

Runtime 体检把显式替代视为可解释的退出，不再将其误报为迁移投影缺口；包视图观察同时统计主列表与折叠历史区。


## 13. 长对话浏览器减负（0.16.0）

社区应对长对话卡顿的实践主要分为两层：浏览器原生的 `content-visibility` 离屏跳过，以及把旧消息节点替换成占位符的激进虚拟化。前者能跳过离屏内容的布局和绘制，并在 `auto` 模式下保留查找、键盘导航与可访问性；后者减负更强，但会把 React 管理节点移出 DOM，存在恢复、流式输出和宿主更新冲突。

DCF 采用分级治理：

- 默认 `safe`：达到 24 个消息 turn 后，仅对稳定的顶层 turn 应用 `content-visibility:auto` 与 `contain-intrinsic-size`；
- 显式 `window`：用户选择保留最近 40 或 20 条，旧 turn 仅被可逆地设为不参与显示，不被删除、替换、克隆或改写；
- 流式输出期间不执行窗口重排，静默期后再协调；
- 滚动到顶部自动展开一批，也可从 DCF 功能页手动展开或恢复全部；
- 所有持久模式选择写入 `preferences.conversation_performance`，经 Environment Reconciler 原子提交；Host controller 只是确定性执行投影；
- Runtime 观察只记录 turn 数、隐藏数、选择器策略、执行耗时和最近 60 秒 long-task 聚合，不读取或输出消息正文。

该能力只处理浏览器端布局/绘制与交互负担。模型上下文压缩、对话总长度上限、服务端首 token 延迟、网络或第三方扩展冲突仍属于其他问题。

Research basis: MDN `content-visibility` documentation; web.dev rendering guidance; community projects `povariha123/chatgpt-long-chat-lag-fix` and `YashRana738/GptOptimum`.

性能控制器不按固定频率重扫对话。MutationObserver 负责内容变化，低频 URL/root 轮询只在导航或根节点替换时触发一次重新协调；手动与自动历史展开都服从流式输出保护。


## 14. Runtime 主线程归因诊断（0.17.0）

传统 Long Tasks 只能可靠证明主线程曾被占用超过 50ms，通常不能指出具体脚本。DCF 的归因会话优先使用 Long Animation Frames，把慢帧拆为脚本工作、渲染、样式与布局，并记录主世界脚本的脱敏来源、入口函数、调用类型、总执行时间和强制样式/布局时间；同时使用 Event Timing 区分输入等待、事件处理和呈现延迟，使用 Layout Instability 记录非预期布局偏移，并保留 Long Tasks 作为兼容兜底。

诊断是一次性 Action，不进入权威环境。用户显式开始 60 秒会话，系统只在该时间窗内保存有界样本；结束后返回 `dcf.conversation-performance.attribution.v1`。点击开始前已启动的帧通过 Performance Timeline 起点排除，避免把启动按钮本身误当作主要来源。

LoAF 不能保证归因浏览器扩展隔离世界、跨域脚本或精确热点函数。DCF 因此单独计量自身每次协调耗时与触发原因，并把未知来源、脚本入口而非内部热点、以及各阶段计时可能重叠写入报告限制。报告禁止消息正文、DOM 文本、事件 target、完整 URL/query、调用栈和认证信息。


## 15. 问答轮次归因（0.18.0）

主线程归因的默认统计边界不是任意 60 秒，而是用户可感知的一次完整问答：下一次发送动作发生时开始，首个助手输出活动形成阶段分界，助手回复停止流式并通过安静窗口确认后自动结束。固定时长只保留为最长运行围栏，手动结束只用于失败、取消或回复无法正常收口。

“记录下一轮问答”只进入 armed 状态，不启动 Performance 样本，因此诊断按钮本身不进入数据。Host Adapter 在捕获阶段观察发送按钮点击和输入框 Enter，不读取输入正文；send event 的 timeline timestamp 成为 LoAF、Event Timing、layout-shift 和 longtask 的共同下界。回复侧复用已有的 bounded current-reply observer，额外发出 first activity 与 completion 生命周期信号。

报告把浏览器可观察的轮次拆为 send-to-first-reply-activity 与 first-reply-activity-to-completion。前一段包含服务端、网络、调度和页面工作，Runtime 只能证明等待长度及同时发生的浏览器阻塞，不能把整段等待自动归罪于浏览器。完成时间包含明确报告的 quiet-window 检测余量。
