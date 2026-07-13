# DCF 当前架构

Updated: 2026-07-13  
Current release: `0.11.5`

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

回复中的 `DCF_AMMO`、`DCF_MODULE_PACK`、手动 JSON 和固定 GitHub catalog 都先解码成 typed artifact，再进入同一事务。

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
