# DCF 当前状态与新会话交接

Updated: 2026-07-12

本文件只记录当前工作断点。项目原则、维护规则和长期决策分别以共识、维护 skill 和 ADR 为准。

## 新会话读取顺序

1. `README.md`
2. `dcf-chatgpt-microcore.user.js`
3. `dcf-chatgpt-microcore.meta.js`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/dcf-maintenance-skill.md`
6. `docs/adr/` 下全部 ADR
7. 本文件

仓库代码是当前内核能力的事实来源；浏览器 registry 是已安装模块和用户偏好的事实来源，两者不能混为一谈。

## 当前仓库版本

当前仓库发布版本为 `0.9.12`。`0.9.11` 的平面日志方案经完整证据链审计后已被取代，不应再作为现场诊断版本安装。

当前 userscript 已恢复正常运行时，并包含：

- 工作区与维护区；
- Surface 侧边栏；
- 内容库与语言弹药；
- registry 模块渲染与命令解释器；
- `appearance.get`、`appearance.set`、`appearance.setVars`、`appearance.adjust`、`appearance.anchor`；
- 更新前恢复点与 registry 回滚；
- 坏包隔离与 badBlocks；
- 同一坏块不再被自动反复扫描；
- 模块内部命令只有显式设置 `feedback: true` 才发送 `DCF_FEEDBACK`；
- `package.apply` 从模块内部调用时默认静默；
- 当前标签页、当前内核启动隔离的 `dcf.command_trace.v2` 命令证据；
- 每次点击独立的 `trace_id`、模块指纹、命令解析和逐步能力调用；
- appearance 调用前后内存状态、持久化状态、壳体计算样式、几何变化和匹配 CSS 规则；
- 隐私过滤、存储失败内存降级和反馈交付状态；
- 本地一次性授权后的 `DCF_MAINT_REQUEST` 维护回传；
- 维护状态中的“复制证据”“发送证据”和“开启一次维护回传”。

证据链回归测试已进入仓库：`tests/dcf-evidence-chain.integration.test.js`，通过 `npm ci && npm test` 重复运行。

旧的 `.github/workflows/build-native-userscript.yml` 已于 2026-07-11 移除。该 workflow 的 YAML 无效，并且仍会从 `engine/0.7.1` 生成 `0.8.0`；它不是当前发布线的可用构建或发布路径。当前根目录 `.user.js` 与 `.meta.js` 仍是权威发布文件。

## 最近事故与已完成修复

一次包含非法控制字符的安装块进入对话后，`0.9.7` 的 MutationObserver 不断重新扫描同一坏块。解析失败会自动发送反馈，而发送反馈又改变页面并触发下一次扫描，形成 feedback 风暴。

`0.9.9` 首次加入坏包隔离，但错误地把正常运行时替换成了只剩维护入口的安全模式。该方案已被否定。

`0.9.10` 已恢复正常功能，并保留坏包隔离：解析失败的包写入 `badBlocks` 和 `seenBlocks`，不再自动发送失败反馈。维护区和 Tampermonkey 菜单均可清理坏块记录。

后续复测发现 `0.9.10` 重建时丢失了 `0.8.7` 已接受的命令点击与能力调用日志，导致按钮无效时只能根据现象推断。`0.9.11` 首次恢复日志，但完整审计发现平面日志仍缺少关联、隔离、变更前后对照、CSS 来源、隐私边界、维护授权和交付证明。`0.9.12` 已按新 ADR 重建为相关联的命令证据链，并保留 `0.9.10` 的坏包隔离与防反馈风暴机制。

## 当前未完成事项

### 壳体调节问题已完成证据定位，待应用 registry 修复并复测

浏览器现场已确认：

- 页面内核为 `0.9.12`；
- 实际安装模块为 `dcf.shell_adjuster` version `2.1`；
- 调节按钮直接调用 `appearance.adjust` 或 `appearance.anchor`，且 `feedback: false`；
- `bad_blocks` 为 `0`；
- 命令解析、能力调用、registry 内存更新、localStorage 持久化和恢复点均正常。

完整证据显示问题来自旧 appearance CSS，而不是命令或内核能力。该 CSS 在 `.sh` 上使用 `!important` 固定：

- 宽度 `340px`，同时固定 min/max width；
- 高度 `540px`，同时固定 min/max height；
- 底部 `var(--b,112px)`，使用了与内核不同的变量名。

因此 registry 中 `w`、`h` 和 `bottom` 虽然持续变化，计算样式与壳体几何仍不变，证据分类为 `state_changed_but_render_overridden`。

已新增：

- ADR：`docs/adr/2026-07-12-dcf-shell-geometry-single-source.md`；
- 修复包：`packs/dcf-shell-geometry-vars-repair-2026-07-12.1.json`。

修复包只替换 registry 中的 appearance CSS，删除冲突的 `.sh` 几何规则，保留内部布局样式。它不更新 userscript，也不替换 `dcf.shell_adjuster`。

下一步：

1. 在当前浏览器页面安装修复包；
2. 注意此前测试点击已经把 registry 调到约 `w:300px`、`h:1000px`、`bottom:88px`，解除覆盖后壳体会立即按这些真实值渲染；
3. 使用步进按钮重新调到用户满意尺寸；
4. 点击宽高、贴顶贴底和距离按钮后发送一次证据；
5. 验证 effect 变为 `state_and_render_changed`，并确认无新的 CSS geometry override。

### 壳体和侧边栏的目标行为

- 壳体宽高由 registry 中的 appearance vars 控制；
- 正常长条形侧边壳体的高度基准约为 `800px`，但最终值由用户步进调整；
- 壳体本身不因内容自动改变尺寸；
- Surface 标签高度按文字长度自适应；
- 侧边栏在固定壳体内部独立滚动，不得撑大壳体；
- 贴顶和贴底是锚点切换，不是用几个固定 bottom 值冒充位置调节。

## 接手时的第一步

先核对：

1. 页面实际显示的 kernel version；
2. 修复包 `dcf.shell_geometry.vars_source_repair@2026-07-12.1` 是否已安装；
3. 当前 appearance CSS 是否已经不再包含固定 `.sh` 宽高和位置；
4. 调节按钮点击后的 effect 是否为 `state_and_render_changed`；
5. 当前 appearance vars 与用户最终选择的尺寸。

不要仅根据仓库版本推断浏览器 registry 已同步。需要现场信息时，优先让用户复制诊断或导出 registry，再做最小范围修正。

## 继续维护时不可违背的边界

- 默认冷热更新，只有当前内核能力不可达时才更新 userscript；
- 外观和具体偏好属于 registry，不属于 userscript 默认设计；
- 版本更新只补通用承载、解释、宿主桥、恢复或本地能力；
- 风险靠快照、事务、诊断和回滚处理，不靠“热更新危险、版本更新安全”的分类；
- 可调壳体几何只能由 appearance vars 和内核锚点解释路径拥有，appearance CSS 不得再建立第二套静态几何来源；
- 不用枚举预设冒充连续调节；
- 不用长篇说明替代实际修复；
- 输出完整安装块前确认当前页面确实需要安装，避免再次让扫描器摄取无意中的示例。
