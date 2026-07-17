# DCF Current State

Updated: 2026-07-17

## Current product state

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product baseline: complete DCF Next before Core Review
- User acceptance:
  - Shell 标签独占切换与 Shell 单插件热更新已通过真实浏览器验收；
  - 外观收起/展开、快速尺寸调节与弹药发射/插入交互已进入真实使用；
  - 340px 弹药卡片布局与隐藏滚动条箭头等待本轮真实验收；
  - Local Agent 纯插件第一版已进入实现候选，等待真实 OpenCode 与浏览器联调。
- Data continuity: DCF Next + Chrome `rc.1`; no separate `0.18.2` migration

## Implemented

- one Manifest V3 Chrome extension as the only user installation;
- static pure base with no normal DCF product code;
- nine independent self-contained first-party plugins:
  - shell;
  - language ammo;
  - long-conversation relief;
  - question-answer attribution;
  - appearance;
  - Local Agent pure OpenCode client;
  - backup;
  - low-frequency plugin manager;
  - diagnostics;
- one unique `USER_SCRIPT` world and registration per plugin;
- immutable plugin versions and SHA-256 verification;
- candidate/current/LKG exact combinations;
- commit only after every enabled plugin returns startup evidence;
- automatic rollback on registration or startup failure;
- automatic registration reconstruction after base update or browser startup;
- fixed GitHub personal plugin index with automatic six-hour throttled checks;
- one user-facing DCF update action covering plugins and Chrome base;
- direct language-ammo library load from the fixed GitHub data branch;
- bounded DCF Next open-Shadow-DOM migration;
- one-time absorption of Chrome rc.1 product state into generic plugin namespaces;
- static onboarding and recovery pages with complete light/dark variables;
- GitHub Actions workflow for verified non-public Chrome Web Store publication once credentials are configured;
- Shell 独立热更新可保留其他插件面板，标签页在真实浏览器中已验证正常；
- Shell 收起/展开只改变折叠状态，不再用不完整状态覆盖外观尺寸；
- appearance 插件提供更大数字步进与宽度、顶部、高度、侧边距滑块；
- ammo 插件将“发射”固定为立即发送，并提供在当前光标处追加且不发送的“插入”动作；
- ammo 在 340px 宽度下使用两层紧凑网格，不产生横向滚动；
- Shell 内容区隐藏浏览器原生滚动条，只在确实还能向上或向下滚动时显示半透明箭头；
- Local Agent 作为纯插件直接连接 `opencode serve`，不修改 Manifest、Chrome 后台、Host API 或底座版本；
- Local Agent 首版覆盖连接配置、Agent/模型、session、任务、状态、消息、todo、diff、终止、权限、提问、结果回填与诊断；
- OpenCode 密码只存在当前页面插件内存，不进入通用插件数据或 DCF 备份。

## Automated evidence

`npm run verify:chrome` proves:

- pure base contains no bundled product unit archive;
- nine plugin hashes, unique worlds and self-contained IIFEs;
- rc.1 state absorption without retaining the old product root;
- default GitHub install, exact registration and startup-evidence commit;
- updating one plugin preserves every other plugin reference;
- generic plugin data isolation;
- base update check path;
- DCF Next-only migration bridge;
- dark static surfaces;
- deterministic unique ZIP;
- Shell 折叠状态补丁不会覆盖已缓存的外观字段；
- appearance 范围滑块与增大后的步进存在；
- ammo 同时具有直接发射与光标插入；
- ammo 340px 操作区使用无横向溢出的网格；
- Shell 原生滚动条被隐藏，上下滚动提示只按可滚动状态出现；
- Local Agent 直接使用浏览器 `fetch` 和 OpenCode API，不向底座发送 `local_agent.*` 消息；
- Manifest、background 和 host 文件没有 localhost、OpenCode 或专用适配器；
- 第九插件进入现有插件下载、独立 world、启动证据、候选提交与单插件更新隔离事务。

## Known boundary before acceptance

- current live acceptance still needs to confirm the 340px ammo layout and the subtle scroll arrows on ChatGPT;
- Local Agent still needs real-browser verification against a password-protected `opencode serve` configured with ChatGPT CORS;
- automated checks do not claim that USER_SCRIPT direct loopback requests, OpenCode permission/question endpoints, or result insertion already passed live acceptance;
- the candidate GitHub index points to the candidate branch; formal Chrome Web Store builds point to `main`;
- the Chrome Web Store workflow is implemented, but actual automatic base publication requires one-time store listing, visibility and repository-secret configuration;
- no claim is made that a store version has already been published.
