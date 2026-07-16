# DCF 新版直接重构当前状态

Updated: 2026-07-17

## 当前分支与版本

- 分支：`rewrite-v2-survival-box`
- 完整捆绑审查目标：`0.2.0-alpha.8`
- 官方插件工具包：`0.1.0-alpha.2`
- 正式 `0.18.2` 与 `main` 保持不变
- 官方插件工具包源清单：`plugin-packs/official/pack.json`
- 官方插件工具包生成物：`dist/dcf-official-plugin-pack.json`

## 任务包一：已完成

官方插件成员、顺序、入口、版本、附带资源和推荐组合由 `plugin-packs/official/pack.json` 唯一声明。同一份插件源码生成完整捆绑 userscript、独立插件包和编译快照；Local Agent 本机 Bridge 是该插件的附带资源，不是一级系统。

## 任务包二：动态加载路线已获得否定证据

真实浏览器已经证明：

- 官方插件包可以导入；
- 12 个代码单元可以持久化；
- SHA-256 与 minimal 快照可以建立；
- 启动失败可以在第一枚插件前被准确记录；
- 当前 Chrome、ChatGPT 与 Tampermonkey 环境不允许从持久化文本执行插件模块。

因此不再建设运行时代码解释、页面注入或多路径 fallback。Core Review 保留为实验记录，不再是候选运行架构。

## 当前执行路线：编译启动快照

精确快照现在是确定性构建输入，而不是运行时执行源码：

```text
官方插件工具包
→ 选择插件组合
→ 构建最小生存核＋所选插件
→ 生成完整 userscript
→ Tampermonkey 安装、执行和更新
```

Action 生成三个官方通道：

- `dcf-chatgpt-next-snapshot-minimal.user.js`
- `dcf-chatgpt-next-snapshot-standard.user.js`
- `dcf-chatgpt-next-snapshot-complete.user.js`

三者只包含该快照需要的插件模块。Local Agent 只存在于 complete 快照，因此 minimal 与 standard 不请求 localhost 权限。

## 下一步现场验收

1. 停用 Core Review 和完整捆绑版；
2. 安装 minimal 编译快照，验证 Shell、ChatGPT、插件管理器和诊断；
3. 安装 standard 快照覆盖同一脚本身份，验证语言弹药、外观、备份和数据保持；
4. 安装 complete 快照，验证 Local Agent 作为普通插件出现；
5. 完成 Echo 后进入任务包三的真实 Agent 自举。

编译快照未通过前，完整捆绑版继续作为回滚基线。
