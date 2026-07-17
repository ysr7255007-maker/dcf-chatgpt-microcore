# DCF Chrome 纯底座与个人功能插件任务书 — rc.2 canonical execution record

## 给用户看的核心取舍

DCF 是一个小型个人 Chrome 插件，目标是替用户减负。内部独立插件只用于减少维护、更新和故障扩散；用户仍然只面对一个完整 DCF。任何增加日常安装、选择、确认和排查工作的机制都不采用。

功能参照 Core Review 前的完整 DCF Next；Next Core 是失败证据。底座保留 Chrome 原生独立脚本、精确组合和回滚，但移除普通业务。功能插件从 GitHub 独立更新；底座由 GitHub Actions 经非公开 Chrome Web Store自动更新。数据只接续 DCF Next 与 Chrome rc.1。

仍需现场确认的隐患只有：真实 ChatGPT DOM 变化、独立 USER_SCRIPT worlds 通过共享 DOM 组成统一侧栏的浏览器表现，以及 Chrome Web Store 一次性外部配置。它们不通过扩张平台来预防，而通过一次完整正常使用验收确认。

## 技术执行约束

- one static pure base;
- eight self-contained first-party plugins;
- unique world and registration per plugin;
- generic plugin data namespaces;
- fixed GitHub index and SHA-256;
- candidate/current/LKG and complete startup evidence;
- automatic default complete install and rollback;
- DCF Next open-shadow migration plus rc.1 state absorption;
- fixed GitHub language-ammo library;
- dark static pages;
- CWS API release automation with honest credential gating;
- one atomic business commit, one CI result, one candidate artifact;
- no PR merge before user browser acceptance.
