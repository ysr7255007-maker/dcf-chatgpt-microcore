# DCF 维护技能

本文件只维护实际改动纪律。

先判断需求属于：第一方产品模块、通用资源/命令能力、ChatGPT Host Adapter、Core 状态事务、transport、UI projection，还是发布流程。语言弹药体验变化优先改 ammo 模块；ChatGPT DOM 变化只改 Host Adapter；只有多个真实模块共同需要且现有底座无法表达时才扩展 Core。

任何权威变化都必须走统一事务：从当前 `dcf.state.root.v1` 生成候选，验证根与资源不变量，构建投影，成功后保存旧根快照并一次提交新根，再写派生 registry 和回执。禁止直接修改 registry，禁止为安装、卸载、内容、设置、迁移、角色覆盖或回退另建保存/反向补丁路径。

包 revision 不可变。同一 package/revision 内容不同必须拒绝。包定义、包默认资产与用户结果分开；用户弹药、设置、外观和角色覆盖不随可选包卸载删除。`dcf.standard.ammo` 是价值闭环所需第一方核心包，不通过包管理停用或卸载。

安装包、运行模块、日常功能和维护工具必须分别描述。`包管理` 只管理包与 revision；`功能` 承载日常和主力工作流；探针、诊断、验收、作者、布局和恢复工具进入 `维护`。`hidden` 不得作为产品角色。所有非弹药运行模块必须保留可发现标题。界面密度使用展开/折叠，折叠状态只写 `dcf.ui.session.v1`，不得修改权威根、moduleDisplay 或包定义。

GM storage 可用时是唯一权威写入后端，但迁移与 Runtime 体检必须显式检查 page `localStorage`。旧后端数据只能通过候选合并进入当前根：当前值优先，缺失值补回，每个旧包先验证投影，冲突项记录在 `system.storage_bridge`。不得因为切换存储 API 而把旧状态当作不存在，也不得把两个后端长期并列为双权威。

外部 `DCF_AMMO`、完整 `DCF_MODULE_PACK`、引用式 `DCF_PACKAGE_UPDATE`、手动 JSON 和 GitHub catalog 都必须进入统一工件入口。完整包按值交付，更新控制按引用解析；取得完整不可变包后统一进入 Reconciler、候选验证、单根提交、Runtime 重投影与回执。GitHub 只解析可信 Catalog 引用、下载和校验 JSON，不执行远程代码。

对话摄取只通过 Host Adapter 观察 `main` / `[role=main]` 的新增节点，并临时观察当前助手回复。回复完成后只读一次。禁止观察 `document.body`，禁止全页 innerText，禁止枚举全部历史消息，禁止恢复 `seenBlocks` 页面账本。启动补偿必须是固定回复数和硬访问上限。

本地状态与外部 effect 分开。composer 有不同草稿时不得覆盖；发送、复制和通知失败只产生 effect receipt，不回滚不相关状态。普通成功不向对话自动发送反馈。

命令渲染和执行必须共用同一 `commandList` 解析。新增能力应进入通用命令解释器，不能同时保留一个硬编码 UI 旁路。命令和 effect 回执默认把正文、提示词、内容、凭据等转成长度/hash，不保存明文。

代码逻辑、schema、事务和构建问题由读源码、单元测试、集成测试、CI 和浏览器自动化解决；不要把这些内容倾倒进现场体检。“一键 Runtime 体检并复制”只调查真实浏览器实例：实际存储回读、内存 root/registry、真实 Shadow DOM、host 数量与矩形、当前 ChatGPT root、observer、composer 和最近失败。健康报告只含空 deviation；异常报告只附证明偏差的最小现场证据。

Runtime 体检不得复用被检查 UI 的同一结论函数来证明 UI 正确。至少一条独立观察面必须比较内存身份与真实 DOM 身份；当报告与用户现场冲突时，先审查报告的观察口径和调用链，禁止修改产品去迎合诊断字段。

壳体几何只来自用户 appearance 状态和通用 appearance 命令。任何包/用户 CSS 不得声明 `.sh` 的位置、边界、宽高、min/max 或 transform。最终显示必须通过 `visualViewport` 与实际 shell rect 围栏。

源码只改 `src/` 与构建输入；根 `.user.js`、`.meta.js` 和 catalog 由 `npm run build` 生成。发布前执行 `npm run verify`、`node --check dcf-chatgpt-microcore.user.js`，回读版本、catalog hash、无 eval/远程代码路径，并执行真实浏览器的“回复工件→自动装填→发射”冒烟。

架构变化更新 `docs/architecture-current.md`、新 ADR、`docs/adr/status-index.md`、本文件、基本共识和 current-state。旧 ADR 保留历史正文，当前状态以 status index 为准。

普通产品功能、中文文案、页面组织、控制顺序和样式变化优先修改对应能力包 revision，不得默认升级整份 userscript。只有包协议、Resolver/Reconciler、存储、Host Adapter、权限、启动与恢复边界无法由现有包资源表达时，才发布 bootstrap 版本。声明式 UI 使用 `ui-view:*` 资源，由 Core 的稳定安全渲染器消费。

维护时先判断变化属于 Environment Intent、Action Intent、Artifact Resolver、Resource Compiler、View Projection、Host Effect 还是 Runtime Observation。不得因为入口不同为同一意图增加旁路。所有持久变化必须经 Environment Reconciler；包只是交付容器，资源地址和观察契约才是 Runtime 编译依据。新增页面优先成为 `ui-view:*` 资源；新增工作模式优先成为 Environment Profile，不得另建平行工作区系统。
