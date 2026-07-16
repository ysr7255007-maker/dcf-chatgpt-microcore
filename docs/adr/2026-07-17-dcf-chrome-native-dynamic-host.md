# ADR: DCF Chrome 原生动态宿主

Date: 2026-07-17  
Status: accepted for candidate implementation; pending product acceptance  
Candidate: `1.0.0-rc.1`

## Context

DCF `0.18.2` 已经把源码和能力包模块化，但 Tampermonkey 最终仍安装和更新一整份 userscript。声明式包可以改变内容、视图和政策，却不能独立替换真正的 JavaScript 实现。继续通过固定整包快照、运行时 `new Function`、CSP 绕行或本机 Runtime 求解，会分别导致独立生命周期失真、安全与稳定风险、用户负担增加或产品中心转移。

本次决策由语言弹药闭环的真实用户能力驱动，而不是由建设通用插件平台驱动。

## Decision

采用一个 Google Chrome Manifest V3 扩展作为唯一安装物，并使用 Chrome 原生 `chrome.userScripts` 执行受控代码单元。

系统只保留两个统一运行时对象：

1. 受控可执行代码单元：稳定 ID、不可变版本、构建后 JavaScript、SHA-256、来源、页面、时机、world、宿主 API 与阶段；
2. 精确启动快照：代码单元的精确 ID、版本、哈希、启用状态和阶段。

静态最小生存核保存代码库、candidate/current/LKG、协调实际注册集合、收集启动证据、处理扩展更新后的重建，并提供独立恢复页。动态代码单元只通过窄消息协议访问产品状态。

语言弹药作为必需第一方代码单元实现完整闭环。另设一个独立诊断证据单元，用于证明普通代码可以单独停用、替换和回滚；它不成为新的产品中心。

候选注册成功仍不视为完成。只有每个启用单元在真实页面返回匹配 ID 与版本的启动证据后，candidate 才提交为 current 与 LKG。失败恢复旧 LKG。

## Migration decision

Chrome 扩展无法直接读取 Tampermonkey 私有 GM storage。拒绝要求用户逐条复制或编辑 JSON。旧正式版的侧栏使用开放 Shadow DOM，并在编辑时呈现完整弹药，因此静态迁移桥自动读取：

- 弹药 ID、标题、用途、标签与正文；
- 发射模式；
- 可观察外观。

迁移按数量、唯一 ID 和内容哈希校验，冲突不覆盖。旧版状态保持原样，作为回退。

## Consequences

Positive:

- 用户仍只安装一个轻量浏览器载体；
- JavaScript 实现获得真实独立生命周期；
- 安装、更新、启停、回滚、恢复和体检共享同一对象模型；
- 扩展更新清除注册集合后可自动重建；
- 高级代码损坏不破坏最低恢复面；
- 不需要本机 Runtime 或浏览器内 npm 求解器。

Costs and limits:

- 首次必须开启 Chrome 的“允许用户脚本”；
- 候选只面向 Chrome，不承诺跨浏览器；
- 旧数据迁移依赖旧正式版侧栏至少运行一次；
- live ChatGPT DOM 仍需唯一一次用户正常使用验收；
- Chrome Web Store 对远程用户脚本更新的政策适配另行评估，不改变当前 unpacked/ZIP 候选的技术判断。

## Supersession

This ADR supersedes as current architecture:

- complete Tampermonkey userscript as the only accepted release architecture;
- fixed compiled snapshots and fixed combination channels;
- remote JavaScript prohibition insofar as it blocked verified controlled code units registered through `chrome.userScripts`;
- GM storage as the future authoritative backend;
- the old whole-project rebuild as the current host implementation.

Retained:

- language-ammunition value sovereignty;
- bounded new-reply intake;
- same-ID ammo update semantics;
- contextual invocation/update protocol;
- immutable revisions, deterministic builds and privacy-bounded evidence;
- single authoritative state transition and failure non-interference principles;
- old formal release as explicit fallback until acceptance.

## Reconsideration conditions

Reopen the decision if Chrome cannot reliably execute and update controlled units without reinstalling the extension, USER_SCRIPT messaging cannot support the narrow host protocol, migration fails to preserve the real ammo library, recovery depends on dynamic code, or the only continuation path reduces automatic loading or increases user maintenance.
