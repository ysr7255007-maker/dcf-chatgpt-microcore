# DCF 真实能力矩阵

Updated: 2026-07-21
Source commit: `a65efdb` (current HEAD)
Branch: `rebuild/chrome-native-host-v2`
Stable: `a65efdb` (刚推进，尚未完成完整回归验证)
Extension: `1.0.0-rc.2` (ID: `nfcfjccjjigaidmakmajjgjmkepebbep`)
Test session: `6a5e6a09-69b4-83e9-a55e-d06b1700c4e9` (ChatGPT)
BrowserClaw run: `dcf-acc-20260721`

## 状态摘要

**纠正声明：** 之前的 "passed" 过于乐观，将局部链路通过写成了完整功能通过。本矩阵已按子项拆分重新标记。实际通过数远低于之前报告。

## 能力矩阵

| 能力 | 用户价值/验收契约 | 状态 | 环境 | commit | 真实证据 | 剩余边界 |
|------|-------------------|------|------|--------|----------|----------|
| A1 Shell 存活 | 打开 ChatGPT 即可见 DCF 侧栏 | passed | Chrome + BrowserClaw | 75a70d5 | 9 面板挂载，ShadowRoot 存在 | — |
| A2 页面刷新恢复 | 刷新后 DCF 不消失 | passed | Chrome + BrowserClaw | 75a70d5 | 刷新后 9 面板全部恢复 | — |
| A3 SPA 会话切换 | 切换对话后 DCF 仍在 | passed | Chrome + BrowserClaw | 75a70d5 | 导航到新聊天再返回，Shell 存活 | — |
| A4 Shell 收起/恢复 | 收起不丢失，可恢复 | passed | Chrome + BrowserClaw | f773237 | shell.8：收起即时生效(is_collapsed=true,按钮变"展开")，展开恢复(is_collapsed=false)。messaging不可用不阻塞UI | — |
| A5 恢复页 | 底座独立恢复入口始终可用 | passed | Chrome + BrowserClaw | 75a70d5 | recovery.html 显示"DCF 正常"，11 插件列表完整 | — |
| A6 扩展重载/Worker 重启 | 重载后状态恢复 | passed | Chrome + BrowserClaw | 6ebbfc9 | 重载扩展→刷新页面→9面板全部恢复，chrome.storage状态存活 | — |
| B1 插件停用 | 停用后面板从当前页消失 | passed | Chrome + BrowserClaw | 75a70d5 | page-diagnostics 停用：9→8 面板，shadow+document 均移除 | — |
| B2 插件启用 | 启用后面板恢复挂载 | passed | Chrome + BrowserClaw | 75a70d5 | page-diagnostics 启用：8→9 面板恢复 | — |
| B3 热更新 | 插件独立更新不需重装扩展 | passed | Chrome + BrowserClaw | d5c702a | 检查更新→ammo.5从GitHub下载→刷新后confirm-bar样式存在（ammo.5代码运行中） | — |
| B4 immutable 冲突 | 同版本不同哈希被拒绝 | not_tested | — | — | 需构造冲突场景 | — |
| B5 LKG 回滚 | 故障时自动退回上一可用组合 | not_tested | — | — | 需构造 candidate 失败 | — |
| C1 标签切换 | 弹药/性能/功能标签自由切换 | passed | Chrome + BrowserClaw | 75a70d5 | 三个标签均切换成功，面板内容正确 | — |
| C2 pinned/active 持久化 | 刷新后标签栏和选中状态不变 | passed | Chrome + BrowserClaw | 75a70d5 | 刷新后 pinned(弹药/性能/功能)和 active(功能)均保持 | — |
| C3 外观设置 | 侧栏位置/尺寸可调且持久 | passed | Chrome + BrowserClaw | 75a70d5 | CSS vars 已自定义(width=340,top=38,height=900)，刷新后保持 | — |
| D1 弹药插入 | 选中弹药→插入输入框 | passed | Chrome + BrowserClaw | 75a70d5 | "从最小生存核中生长系统"全文插入 ChatGPT 输入框 | — |
| D2 弹药发射 | 发射→形成真实用户消息→助手回复 | passed | Chrome + BrowserClaw | 7f9674b | 发射"源头化解题"→541字符多行完整→助手回复<<<DCF_AMMO结构化更新(762字符) | — |
| D3 弹药 CRUD | 创建/编辑/删除/更新 | passed | Chrome + BrowserClaw | 7f9674b | 新建(8→9)+删除(9→8)+内嵌确认条(无系统弹窗)+发射触发更新协议 | — |
| D4 弹药持久化 | 刷新后弹药列表不丢失 | passed | Chrome + BrowserClaw | 75a70d5 | 多次刷新后 8 枚弹药始终存在 | — |
| D5 弹药 GitHub 加载 | 从远程弹药库同步 | passed | Chrome + BrowserClaw | af46cbf | "GitHub 载入完成：新增 0，更新 1，未变 7" | — |
| D6 弹药更新协议 | 选中→更新→生成 DCF_AMMO 提示词填入输入框 | passed | Chrome + BrowserClaw | af46cbf | "〔DCF·弹药更新〕"提示词(1371字符)已填入输入框 | — |
| D7 弹药提取 | 从对话提取→ChatGPT 生成 DCF_AMMO | passed | Chrome + BrowserClaw | 3a847c2 | 提取提示词→ChatGPT返回完整DCF_AMMO(id/title/purpose/body) | 自动装填可能因观察器未启动而延迟 |
| E1 对话事件消费 | 新助手回复被 DCF 检测 | passed | Chrome + BrowserClaw | 75a70d5 | conversation-performance turn_count=4，apply_count=16 | — |
| E2 流式结束判定 | 流式完成后才判定轮次 | passed | Chrome + BrowserClaw | 75a70d5 | 助手回复完成后 turn_count 正确递增 | — |
| E3 性能归因记录 | 记录问答耗时 | passed | Chrome + BrowserClaw | 7f9674b | 激活后记录完整：total_ms=8790, send_to_first_reply=62ms, completion=8728ms, LoAF/longtask/layout-shift | — |
| F1 本地 Agent 连接 | 直连 OpenCode 127.0.0.1:4096 | passed | Chrome + BrowserClaw | 96b7cbf | 保存并连接→"已连接"，Agent列表(build/explore/general等)、模型列表(DeepSeek/Nvidia/Volcano等)完整 | 自动连接需 local-agent.6 且 messaging 可用 |
| F2a 请求识别与 session 创建 | 网页端标记被检测→创建 OpenCode session | passed | Chrome + BrowserClaw | a65efdb | 助手输出 DCF_LOCAL_AGENT_REQUEST → dialogue 插件检测 → 创建 session | — |
| F2b 最小结果往返 | 任务执行→结果返回面板 | passed | Chrome + BrowserClaw | a65efdb | OpenCode 执行 DCF_E2E_OK → 结果出现在面板 | — |
| F2c 结果自动回传对话 | 结果填入输入框并点击发送到原对话 | failed | Chrome + BrowserClaw | a65efdb | dialogue.22 修复后回传仍偶发失败（composer/按钮不可用） | 需核实 outbox 泵条件判断 |
| F2d 同一工件只投递一次 | 幂等去重 | failed | Chrome + BrowserClaw | a65efdb | delivered_ids 账本已加入但未在真实重放场景中验证 | 需构造重放场景验证 |
| F2e 终态后不再发送旧进度 | 终态自动淘汰同 session progress | not_tested | — | a65efdb | dialogue.22 代码已实现终端淘汰逻辑 | 需构造多 progress+终态场景 |
| F2f 绑定正确项目工作区 | session 创建时有 workspace path | failed | — | — | session 创建于 /Users/looy（global），非 DCF 仓库路径 | 需在 POST /session 中传入 project_dir |
| F2g 原请求对话精确路由 | 结果只发送到触发对话，不串到其他对话 | failed | Chrome + BrowserClaw | a65efdb | 旧 outbox 条目无 conversation_url 时串到所有标签页；dialogue.21/22 修复待验证 | 需多窗口真实验证 |
| F2h 刷新后恢复与去重 | 刷新不重放已投递工件 | not_tested | — | a65efdb | delivered_ids + 禁止 loadState 自动泵出已实现 | 需构造刷新+重放场景 |
| F2i permission wait/decision | 权限请求→裁决→继续/终止 | not_tested | — | — | 测试中未触发过真实权限请求 | 需构造有副作用的 OpenCode 任务 |
| F3 控制面(status/steer/cancel) | 执行中可查状态/转向/取消 | passed | Chrome + BrowserClaw | 96b7cbf | 长任务执行中点击"终止任务"→任务中断停止，部分结果保留 | — |
| G1 诊断健康报告 | 正常时报告 healthy | passed | Chrome + BrowserClaw | 75a70d5 | page_health="healthy"，host_version 正确 | — |
| G2 诊断按钮可用 | 复制诊断包/恢复面/刷新 | passed | Chrome + BrowserClaw | 75a70d5 | 5 个按钮均存在且可点击 | — |
| G3 本机 Agent 诊断 | 无 session 时中性报告 | passed | Chrome + BrowserClaw | 75a70d5 | "没有可诊断的最近本机 session"（非假失败） | Issue #62 边界 |
| G4 页面诊断 | 页面生命周期环形缓冲 | passed | Chrome + BrowserClaw | 7f9674b | 启动诊断→10s采集→结束分析：10/200条，drift=0ms，zeroRaf=2，结论"证据不足"（正常） | — |
| H1 停用后面板移除 | 停用→当前页面板真实消失 | passed | Chrome + BrowserClaw | 75a70d5 | 与 B1 同证据 | — |
| H2 messaging 不可用容错 | 插件降级而非崩溃 | environment_difference | Chrome + BrowserClaw | 75a70d5 | USER_SCRIPT world sendMessage 非确定性（已知 Issue #69 边界） | 根因未定 |
| H3 缺 Shell 诊断 | 注册全但缺 Shell 时报告 | not_tested | — | — | Issue #69 已验证过（page_shell_missing） | 本轮未重做 |
| I1 备份下载 | 下载完整备份 JSON 文件 | passed | Chrome + BrowserClaw | 424e1ab | 点击"下载备份"→通知"备份文件已生成" | — |
| I2 备份复制 | 复制完整备份到剪贴板 | environment_difference | — | af46cbf | `backup()` 成功获取数据，但 `navigator.clipboard.writeText()` 因页面未聚焦拒绝写入（浏览器安全限制） | 非 DCF 缺陷；用户正常使用时页面聚焦可正常工作 |
| I3 备份导入 | 导入 JSON 恢复插件数据 | not_tested | — | — | 需准备备份文件并通过文件选择器导入 | — |
| J1 外观实时调节 | 拖动滑块 Shell 实时变形 | passed | Chrome + BrowserClaw | 424e1ab | 高度 900→500px 实时生效，宽度 340→500px 实时生效 | — |
| J2 外观重置 | 恢复默认尺寸 | passed | Chrome + BrowserClaw | 424e1ab | 重置后恢复 380×680px 默认值 | — |
| K1 减负阈值以下 | <24 轮不触发优化 | passed | Chrome + BrowserClaw | 424e1ab | 7 轮对话：safe/window 模式 optimized=0, hidden=0 | — |
| K2 减负模式切换 | off/safe/window 切换生效 | passed | Chrome + BrowserClaw | 424e1ab | 切换后 last_reason="mode-change"，report 正确更新 | — |
| K3 恢复全部并关闭 | 还原所有消息+模式归 off | passed | Chrome + BrowserClaw | 424e1ab | 模式→off，hidden=0 | — |
| K4 减负阈值以上 | ≥24 轮实际包裹/隐藏 | not_tested | — | — | 当前测试对话仅 7 轮，需 24+ 轮长对话 | — |
| L1 归因记录 | arm→问答→完整计时报告 | passed | Chrome + BrowserClaw | 7f9674b | total_ms=8790, send_to_first_reply=62ms, LoAF/longtask 数据 | — |
| L2 归因 arm/clear | 按钮状态切换 | passed | Chrome + BrowserClaw | 424e1ab | arm 设置内部标记等待下轮，clear 重置状态 | 需完整问答轮验证 arm 触发 |
| M1 防节流心跳 | 切屏后插件保持活跃 | not_tested | — | 2d578fd | SW alarm 已部署但未能有效验证：切屏时 BrowserClaw MCP 也断连，无法在后台执行验证。用户反馈放副屏不触发节流 | 需真实后台场景验证，BrowserClaw 本身也受节流影响 |

## 测试会话记录

| 字段 | 值 |
|------|-----|
| test_run_id | dcf-acc-20260721 |
| source_commit | 75a70d51397ef5136333893da1f94ba31a36313c |
| browser_profile | 用户主 Profile（BrowserClaw 标签隔离） |
| test_conversation | 6a5e6a09-69b4-83e9-a55e-d06b1700c4e9 |
| conversation_title | 功能管理器修复与验证 |
| created_at | 2026-07-20T18:31Z |
| chatgpt_project | dcf |
| extension_id | nfcfjccjjigaidmakmajjgjmkepebbep |
| extension_version | 1.0.0-rc.2 |
| snapshot_id | snapshot-mrtjfzde |

## 受控提示词类别

| 类别 | 模板 | 用途 |
|------|------|------|
| 精确回显 | `请不要解释，只回复：DCF_TEST_ASSISTANT_REPLY_<run_id>` | 验证助手回复事件 |
| 会话初始化 | `请不要解释，只回复：DCF_TEST_SESSION_INIT_<run_id>` | 建立测试会话 |

## 已知边界与未测项

1. **H2 非确定性**：USER_SCRIPT world sendMessage 可用性随加载变化（Issue #69 已记录），影响所有插件初始化可靠性
2. **B4-B5 未测**：immutable 冲突/LKG 回滚需构造特定场景
4. **A6 扩展重载**：影响整个 Profile，需错峰协调
5. **Issue #62**：诊断终态推断仍有已知缺陷
6. **BrowserClaw fill 截断**：`fill` 操作在 ChatGPT contenteditable 输入框中会截断 `\n` 之后的内容。多行文本应使用弹药插入/发射机制或 evaluate 直接设置。这不是 DCF 缺陷，是测试工具局限
7. **删除确认已修复**：原 `window.confirm()` 弹出系统级对话框，已替换为 Shell 内嵌确认条（ammo.5, commit 7f9674b）

## 回归基线

本矩阵可作为后续 DCF 更新的回归基线。每次更新后：
1. 重跑 passed 项确认不回归
2. 重测 blocked/not_tested 项（如条件变化）
3. 更新 commit、证据和状态
