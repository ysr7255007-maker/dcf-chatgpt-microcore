# DCF 新版直接重构当前状态

Updated: 2026-07-16

## 当前分支与版本

- 分支：`rewrite-v2-survival-box`
- 审查目标：`0.2.0-alpha.5`；GitHub Action 根据当前 `src-next/` 确定性构建并发布审查 userscript/meta
- 正式 `0.18.2` 与 `main` 保持不变
- 语言弹药数据分支：`language-ammo-library`
- 固定便携库路径：`data/language-ammo/library.json`

## 当前实现

新版已经形成完整首版插件集合：

1. 最小生存盒：真实启动清单、顺序加载、启动状态、上次启动中断检测、最近已知可用组合和安全模式。
2. 基础界面：可折叠侧栏、插件面板挂载、轻量反馈和视口围栏。
3. ChatGPT 页面交互：输入框草稿保护、填入、发送、新助手回复活动与完成的有界观察、导航恢复。
4. 本机 Agent：当前网页实例主动注册到 loopback Bridge；识别 `DCF_LOCAL_TASK`、用户确认执行、轮询状态并把 `DCF_LOCAL_RESULT` 填回当前输入框。Bridge 离线不会触发生存盒恢复。
5. 语言弹药：新版独立保存、搜索、新建、编辑、删除、复制、语境化发射、同 ID 更新请求、从对话提取和 `DCF_AMMO` 自动装填。
6. 语言弹药便携库：复制完整 `dcf.language-ammo.library.v1` JSON；从固定 GitHub 文件显式加载；按稳定 ID 新增、更新和跳过未变化项。
7. 插件管理：查看真实内嵌插件、启停、排序、版本选择、保存组合、导入和导出启动清单。
8. 长对话减负：关闭、透明 `content-visibility:auto`、显式历史窗口、分批展开和完整恢复；不删除或替换 ChatGPT 管理节点。
9. 问答性能归因：待命后从下一次真实发送开始，按首个助手活动分段，回复完成自动封口，保留未知归因和隐私限制。
10. 外观：左右停靠、宽度、顶部、高度、边距、视口限制和恢复默认。
11. 数据备份与恢复：导出新版插件数据、外观和启动组合；恢复前自动保留当前快照。
12. 维护诊断：输出启动、插件、壳体、Host、性能和非敏感本机 Agent 连接状态，不输出对话、弹药正文、DOM 全量、认证信息或本机会话令牌。

## 本机 Agent 自举

- `src-next/plugins/local-agent.js` 是普通插件，不扩展生存盒业务职责。
- `bridge/local-agent-bridge.js` 是独立 loopback 小进程；支持配对、页面实例注册、单任务执行、状态读取和一个配置型 Agent 命令入口。
- 工作区只通过本机配置中的别名选择；网页不能提交任意真实路径。
- Bridge 提供 `echo` 模式，先验证网页—本机—网页闭环，再接入 Codex、OpenCode、OpenClaw 或其他实际 Agent 命令。
- 后续源码修改、测试、`git`、`gh`、草稿 PR 和 Action 检查由本机 Agent 完成；GitHub 凭据和模型密钥不进入 userscript。

## 启动清单演化

启动清单现在被解释为用户对当前插件集合的偏好，而不是封闭插件宇宙：

- 保留仍存在插件的顺序和启用状态；
- 精确旧版本消失时采用当前默认版本；
- 新插件追加到当前清单；
- 删除的插件自然移除；
- 新插件在旧最近可用组合中默认禁用，保证首次启动失败后能回到真正的旧组合。

## 生成物发布方式

- 业务需求理解、`src-next/` 源码、测试、Bridge 和 ADR 由维护者显式修改并提交。
- `.github/workflows/next-generated-artifacts.yml` 运行 `npm run verify:next`。
- workflow 只允许构建过程改动 `dcf-chatgpt-next.user.js` 与 `dcf-chatgpt-next.meta.js`；出现其他文件差异时直接失败。
- 生成物有变化时由 `github-actions[bot]` 提交；机器人提交不会进入自动修复或重复写入循环。
- Action 不应用业务补丁、不修改源码或测试，也不根据失败日志自行修复。

## 已验证与待验证

源码测试覆盖：

- 新插件进入当前清单、版本迁移、删除清理和旧最近可用组合禁用新插件；
- `DCF_LOCAL_TASK` 解析、结果包裹体、loopback 地址限制和本机插件离线启动；
- Bridge 配对、注册、工作区别名、Echo 任务、状态轮询和任务记录；
- 原有 DCF Next 生存盒、数据、语言弹药、长对话和完整 userscript 语法验证继续由 `verify:next` 执行。

仍需真实现场验收：

1. 安装 Action 生成的 `0.2.0-alpha.5`；
2. 启动 Echo Bridge，在“本机”面板配对；
3. 从当前对话识别任务包、确认执行并把结果填回输入框；
4. 接入一个真实工具型 Agent；
5. 由该 Agent 完成一次 DCF 低风险修改、本地验证、原子提交、草稿 PR 和 Action 检查；
6. 安装新生成物并确认新版重新注册。

## 文件与边界复核

注册表仍只做静态装配；生存盒只理解启动与恢复；本地协作实例属于普通插件运行状态；Bridge 不提供任意 Shell HTTP 接口；GitHub 写入权、模型密钥和本地真实路径不进入 userscript；PR/Action 继续承担正式工程验证。
