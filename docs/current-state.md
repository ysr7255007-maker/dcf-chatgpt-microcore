# DCF 当前状态与新会话交接

Updated: 2026-07-11

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

当前仓库发布版本为 `0.9.11`。浏览器需要完成 Tampermonkey 更新后才能使用新增诊断能力。

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
- 本地环形命令日志，记录 `command_click`、`command_run`、`capability_call` 的输入、结果与失败；
- appearance 调用后的 registry 状态与壳体计算样式证据；
- `DCF_MAINT_REQUEST` 维护请求入口；
- 维护状态中的“复制日志”和“发送日志”。

旧的 `.github/workflows/build-native-userscript.yml` 已于 2026-07-11 移除。该 workflow 的 YAML 无效，并且仍会从 `engine/0.7.1` 生成 `0.8.0`；它不是当前发布线的可用构建或发布路径。当前根目录 `.user.js` 与 `.meta.js` 仍是权威发布文件。

## 最近事故与已完成修复

一次包含非法控制字符的安装块进入对话后，`0.9.7` 的 MutationObserver 不断重新扫描同一坏块。解析失败会自动发送反馈，而发送反馈又改变页面并触发下一次扫描，形成 feedback 风暴。

`0.9.9` 首次加入坏包隔离，但错误地把正常运行时替换成了只剩维护入口的安全模式。该方案已被否定。

`0.9.10` 已恢复正常功能，并保留坏包隔离：解析失败的包写入 `badBlocks` 和 `seenBlocks`，不再自动发送失败反馈。维护区和 Tampermonkey 菜单均可清理坏块记录。

后续复测发现 `0.9.10` 重建时丢失了 `0.8.7` 已接受的命令点击与能力调用日志，导致按钮无效时只能根据现象推断。`0.9.11` 已恢复轻量证据链和维护请求入口，并保留 `0.9.10` 的坏包隔离与防反馈风暴机制。

## 当前未完成事项

### 壳体调节仍待执行证据定位

userscript 更新不会自动替换已经安装在 registry 中的 `dcf.shell_adjuster`。用户最后观察到的仍是旧版壳体调节模块。

正确目标不是枚举几个固定尺寸，而是连续步进控制：

- 贴顶；
- 贴底；
- 高度增加与减少；
- 宽度增加与减少；
- 顶部距离增加与减少；
- 底部距离增加与减少。

调节按钮必须直接调用 `appearance.adjust` 或 `appearance.anchor`，不得通过几个固定 CSS 包模拟手动调节，也不得在每次点击后自动发送反馈。

`dcf.shell_adjuster.step_controls@2026-07-11.1` 已成功安装且无警告，但复测结果仍为：高度和宽度按钮无视觉效果，贴顶有效，贴底无效。不能再根据现象修改模块。

下一步是让浏览器更新到 `0.9.11`，复现一次按钮点击，再通过 `DCF_MAINT_REQUEST` 或维护状态的“发送日志”取得命令输入、能力返回、registry appearance 和壳体计算样式。只有根据这份证据才能决定是命令未执行、registry 未变化，还是 appearance CSS 覆盖了变量。

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
2. `dcf.shell_adjuster` 的实际模块版本与按钮；
3. 点击调节按钮是否只更新本地 registry，而不会发送反馈；
4. 维护状态中的 `bad` 数量；
5. 当前 appearance vars。

不要仅根据仓库版本推断浏览器 registry 已同步。需要现场信息时，优先让用户复制诊断或导出 registry，再做最小范围修正。

## 继续维护时不可违背的边界

- 默认冷热更新，只有当前内核能力不可达时才更新 userscript；
- 外观和具体偏好属于 registry，不属于 userscript 默认设计；
- 版本更新只补通用承载、解释、宿主桥、恢复或本地能力；
- 风险靠快照、事务、诊断和回滚处理，不靠“热更新危险、版本更新安全”的分类；
- 不用枚举预设冒充连续调节；
- 不用长篇说明替代实际修复；
- 输出完整安装块前确认当前页面确实需要安装，避免再次让扫描器摄取无意中的示例。
