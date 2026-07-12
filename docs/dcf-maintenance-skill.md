# DCF 维护技能

本文件只维护实际改动纪律。

先判断需求属于：第一方产品模块、通用资源/命令能力、ChatGPT Host Adapter、Core 状态事务、transport、UI projection，还是发布流程。语言弹药体验变化优先改 ammo 模块；ChatGPT DOM 变化只改 Host Adapter；只有多个真实模块共同需要且现有底座无法表达时才扩展 Core。

任何权威变化都必须走统一事务：从当前 `dcf.state.root.v1` 生成候选，验证根与资源不变量，构建投影，成功后保存旧根快照并一次提交新根，再写派生 registry 和回执。禁止直接修改 registry，禁止为安装、卸载、内容、设置、迁移或回退另建保存/反向补丁路径。

包 revision 不可变。同一 package/revision 内容不同必须拒绝。包定义、包默认资产与用户结果分开；用户弹药、设置、外观和显示覆盖不随可选包卸载删除。`dcf.standard.ammo` 是价值闭环所需第一方核心包，不通过包管理停用或卸载。

GM storage 可用时是唯一权威写入后端，但迁移与体检必须显式检查 page `localStorage`。旧后端数据只能通过候选合并进入当前根：当前值优先，缺失值补回，每个旧包先验证投影，冲突项记录在 `system.storage_bridge`。不得因为切换存储 API 而把旧状态当作不存在，也不得把两个后端长期并列为双权威。

外部 `DCF_AMMO`、`DCF_MODULE_PACK`、手动 JSON 和 GitHub catalog 都必须先解码成 typed artifact，再进入同一个事务。GitHub 只发现、下载和校验不可变 JSON，不参与 registry 合并，也不执行远程代码。

对话摄取只通过 Host Adapter 观察 `main` / `[role=main]` 的新增节点，并临时观察当前助手回复。回复完成后只读一次。禁止观察 `document.body`，禁止全页 innerText，禁止枚举全部历史消息，禁止恢复 `seenBlocks` 页面账本。启动补偿必须是固定回复数和硬访问上限。

本地状态与外部 effect 分开。composer 有不同草稿时不得覆盖；发送、复制和通知失败只产生 effect receipt，不回滚不相关状态。普通成功不向对话自动发送反馈。

命令渲染和执行必须共用同一 `commandList` 解析。新增能力应进入通用命令解释器，不能同时保留一个硬编码 UI 旁路。命令和 effect 回执默认把正文、提示词、内容、凭据等转成长度/hash，不保存明文。

“一键体检并复制”是完整诊断入口。涉及迁移、模块缺失、宿主监听、投影或运行状态的现场问题，先读取完整 `DCF_HEALTH_REPORT`，不要继续依赖用户口述。报告必须覆盖两种存储后端、root/hash/projection、包/模块/Surface、迁移差异、Host Adapter 和失败回执，同时不得包含对话正文、弹药正文、包 payload、命令参数或认证信息。

壳体几何只来自用户 appearance 状态和通用 appearance 命令。任何包/用户 CSS 不得声明 `.sh` 的位置、边界、宽高、min/max 或 transform。最终显示必须通过 `visualViewport` 与实际 shell rect 围栏。

源码只改 `src/` 与构建输入；根 `.user.js`、`.meta.js` 和 catalog 由 `npm run build` 生成。发布前执行 `npm run verify`、`node --check dcf-chatgpt-microcore.user.js`，回读版本、catalog hash、无 eval/远程代码路径，并执行真实浏览器的“回复工件→自动装填→发射”冒烟。

架构变化更新 `docs/architecture-current.md`、新 ADR、`docs/adr/status-index.md`、本文件、基本共识和 current-state。旧 ADR 保留历史正文，当前状态以 status index 为准。