# DCF 新版直接重构当前状态

Updated: 2026-07-17

## 当前分支与版本

- 分支：`rewrite-v2-survival-box`
- 审查目标：`0.2.0-alpha.6`
- 正式 `0.18.2` 与 `main` 保持不变
- 官方插件工具包源清单：`plugin-packs/official/pack.json`
- 官方插件工具包生成物：`dist/dcf-official-plugin-pack.json`
- 语言弹药数据分支：`language-ammo-library`
- 固定便携库路径：`data/language-ammo/library.json`

## 当前实现

新版继续由最小生存盒和十个普通插件组成：Shell、ChatGPT 页面交互、本机 Agent、语言弹药、长对话减负、问答性能归因、外观、插件管理、备份恢复和维护诊断。

本机 Agent 浏览器插件、协议文件、本机 Bridge、配置示例和说明现在由同一官方插件包清单归属于 `dcf.next.local-agent`。Bridge 不是独立一级系统。

## 官方插件工具包边界

- `plugin-packs/official/pack.json` 是官方包成员、顺序、入口、版本、附带资源和推荐组合的唯一声明。
- 插件归属由清单决定，不由目录位置决定；现有插件保持单份源码，不为了目录外观复制或改写。
- 完整审查 userscript 只构建生存核和包清单明确列出的模块，不再扫描后自动吸收全部业务插件。
- `scripts/build-official-plugin-pack.js` 从同一源码确定性生成独立插件包，包含文件内容和 SHA-256。
- Local Agent 的 `bridge/**` 文件作为该插件附带资源进入包工件。
- 当前静态注册表和启动清单协调仍属于捆绑兼容形态，浏览器行为不变。

## 生成物发布方式

GitHub Action 运行 `npm run verify:next`，只允许构建过程修改：

- `dcf-chatgpt-next.user.js`
- `dcf-chatgpt-next.meta.js`
- `dist/dcf-official-plugin-pack.json`

Action 不应用业务补丁、不修改源码或测试，也不根据失败日志自行修复。

## 当前验证边界

自动验证负责：

- 官方包模块、插件身份和版本唯一；
- 静态注册表与官方包顺序一致；
- Local Agent 浏览器和本机资源属于同一插件；
- 包清单文件全部存在；
- 独立插件包重复构建字节一致；
- 文件 SHA-256 与内容一致；
- 完整 userscript 继续从同一插件源码构建；
- 原有生存盒、插件、语言弹药与 Local Agent Bridge 测试继续通过。

## 下一任务：真实动态加载验收

下一步不再做脱离现场的玩具实验，而是在真实 Tampermonkey 与 ChatGPT 页面中验证：

1. 空生存核和最低恢复入口；
2. 导入官方插件工具包和最小运行快照；
3. 插件代码保存、SHA-256 校验与动态执行；
4. 插件 context、GM 能力和插件间 API；
5. 插件更新、失败、最近可用快照和原始回滚；
6. 插件管理器损坏后仍能绕过；
7. Local Agent 作为普通插件选择安装。

动态加载未通过前，当前完整捆绑 userscript继续作为回滚基线；不得用多套 fallback 把失败包装成完成。
