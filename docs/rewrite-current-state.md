# DCF 新版直接重构当前状态

Updated: 2026-07-17

## 当前分支与版本

- 分支：`rewrite-v2-survival-box`
- 完整捆绑审查目标：`0.2.0-alpha.7`
- Core Review 实验版本：`0.1.0-alpha.2`
- 正式 `0.18.2` 与 `main` 保持不变
- 官方插件工具包源清单：`plugin-packs/official/pack.json`
- 官方插件工具包生成物：`dist/dcf-official-plugin-pack.json`
- Core Review 生成物：`dcf-chatgpt-next-core-review.user.js`

## 任务包一：已完成

官方插件成员、顺序、入口、版本、附带资源和推荐组合由 `plugin-packs/official/pack.json` 唯一声明。同一份插件源码继续生成完整捆绑 userscript 和独立确定性插件包；Local Agent 本机 Bridge 是该插件的附带资源，不是一级系统。

## 任务包二：进行真实浏览器验收

独立 Core Review 只包含：

- 最低恢复界面；
- 插件包显式导入；
- 本机代码单元持久化；
- SHA-256 执行前校验；
- 精确运行快照；
- 顺序启动和插件 API；
- 最近可用快照；
- 插件失败恢复。

第一次现场运行已经证明官方插件包成功导入、12 个代码单元成功持久化、minimal 快照成功建立。首个插件尚未真正执行：`0.1.0-alpha.1` 因省略 `@sandbox` 被 Tampermonkey 优先注入 ChatGPT 页面上下文，动态执行受到页面 CSP 阻止。

`0.1.0-alpha.2` 将 Core Review 固定为 `@sandbox DOM`，并在插件启动前进行运行环境自检。如果隔离环境仍不允许本机代码单元执行，Core 会以 `dynamic_execution_unavailable` 记录根限制，不再把它归因成 Shell 插件故障。

插件管理器为 `1.1.0`，可以将“已安装但未进入当前组合”的插件加入下一份运行快照。完整捆绑版中所有插件仍会按现有兼容逻辑进入清单，因此其日常行为基本不变。

## 生成物发布方式

GitHub Action 运行 `npm run verify:next`，只允许构建过程修改：

- `dcf-chatgpt-next.user.js`
- `dcf-chatgpt-next.meta.js`
- `dcf-chatgpt-next-core-review.user.js`
- `dcf-chatgpt-next-core-review.meta.js`
- `dist/dcf-official-plugin-pack.json`

Action 不修改业务源码或测试，不根据失败日志自行修复。

## 现场验收顺序

按 `docs/core-review-browser-acceptance.md` 执行：

1. 更新 Core Review 到 `0.1.0-alpha.2`；
2. 清除强制恢复并重试现有 minimal 快照；
3. 确认 Shell、ChatGPT、插件管理器与诊断启动；
4. 通过插件管理器加入其他插件；
5. 验证 GM 持久化、插件 context 和插件间 API；
6. 把 Local Agent 作为普通插件加入并完成 Echo；
7. 基础链路通过后，再生成故障插件包验证失败与原始回滚。

Core Review 与完整捆绑版不能在同一页面同时启用。实验未通过前，完整捆绑版继续作为回滚基线，静态注册表和捆绑兼容逻辑不删除。
