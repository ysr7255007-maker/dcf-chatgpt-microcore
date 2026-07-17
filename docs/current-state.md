# DCF Current State

Updated: 2026-07-17

## Current product state

- Chrome candidate: `1.0.0-rc.2`
- Candidate branch: `rebuild/chrome-native-host-v2`
- Product baseline: complete DCF Next before Core Review
- User acceptance:
  - Shell 标签独占切换与 Shell 单插件热更新已通过真实浏览器验收；
  - 外观收起/展开、快速尺寸调节与弹药发射/插入交互等待本轮真实验收。
- Data continuity: DCF Next + Chrome `rc.1`; no separate `0.18.2` migration

## Implemented

- one Manifest V3 Chrome extension as the only user installation;
- static pure base with no normal DCF product code;
- eight independent self-contained first-party plugins:
  - shell;
  - language ammo;
  - long-conversation relief;
  - question-answer attribution;
  - appearance;
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
- ammo 单枚弹药操作按钮保持单排，必要时横向滚动而不是无故换行。

## Automated evidence

`npm run verify:chrome` proves:

- pure base contains no bundled product unit archive;
- eight plugin hashes, unique worlds and self-contained IIFEs;
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
- ammo 同时具有直接发射、光标插入和单排动作布局；
- 本轮只改变 Shell、appearance 与 ammo 三个插件版本，其余五个引用不变。

## Known boundary before acceptance

- current live acceptance still needs to confirm the appearance collapse/expand repair and the revised ammo interaction on ChatGPT;
- the candidate GitHub index points to the candidate branch; formal Chrome Web Store builds point to `main`;
- the Chrome Web Store workflow is implemented, but actual automatic base publication requires one-time store listing, visibility and repository-secret configuration;
- no claim is made that a store version has already been published.
