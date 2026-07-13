# DCF 当前架构

Updated: 2026-07-13  
Current release: `0.12.0`

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
