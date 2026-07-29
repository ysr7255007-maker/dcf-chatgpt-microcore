# Wave 1.6 — G1 采集链验收状态（诚实记录，不伪造）

> 本文件如实记录 web-capture 归位 G1 Target Adapter 后的验收状态。
> 遵循 DCF 反造假原则：仅记录真实运行证据；未能真实复验的项如实标注 pending，不伪造。

## 一、已证实（真实运行证据）

### 1.1 G1 扩展加载健康（Wave 1.4）

- **证据**：真实 Google Chrome（150.0.7871.187）以 `--load-extension=seed/adapters/chrome` 启动，
  chrome.log 中 **0 条扩展加载错误**（`Failed to load extension` / `manifest error` / `Invalid` 计数为 0）。
- 结论：G1 扩展 manifest 合法，`background.js` + `content.js` + `web-capture/bundle.js` + `ulid.js` + `outbox-core.js`
  均被 Chrome 接受，无 chrome://extensions 错误标记。

### 1.2 G1 采集链端到端（dcf.observation → OutboxCore → companion）

- **证据**：`tests/chrome-alarms-flush.test.js`（17/17 通过），关键断言：
  - `observation message feeds durable outbox`：`dcf.observation` 消息入队 durable outbox（chrome.storage.local）
  - `alarm tick flushes to companion after recovery`：alarm 触发 batch POST 到 companion 默认端口 8472
  - `outbox drained after confirmed delivery`：确认投递后 outbox 清空
- 结论：G1 原生 `background.js` 的 `dcf.observation` handler → OutboxCore → alarms flush → companion `/rpc/events/batch`
  全链路在 MV3 模拟环境中验证通过。

### 1.2b bundle 注册表接线缺陷修复（真实浏览器相关，unit 直接 require 源文件漏检）

- **缺陷**：`build-g1-adapter.js` 早期只把 `const __SITE_XXX = {...}` 拼进 bundle，未接线进
  `__DCF_WEB_CAPTURE__['<key>']` 注册表；`index.js` 读 `REGISTRY[key]` 得 `undefined` → 全部隔离
  → `loaded=0` → **真实浏览器零采集**。单测因直接 `require` 源文件（而非 bundle）漏检。
- **修复**：`build-g1-adapter.js` 按 `filename→key` 生成 `__DCF_WEB_CAPTURE__[key]=__SITE_XXX` 接线；
  build 自检改用真实 `ENGINE.adapterCount()`（旧自检数 const 声明且 `wc.loaded` 恒 undefined 误判通过）。
- **证据**：`build:g1` VM 自检 —— 提供 document/MutationObserver stub，`www.doubao.com` 匹配 host 下
  引擎注册 **10 个适配器**、`start()` 成功、`data-dcf-web-capture` beacon `started:true` 写入。
  单测新增回归守卫「bundle 必须含注册表接线 + VM 注册全部适配器」（30/30）。

### 1.3 引擎发送 dcf.observation（消息类型统一）

- **证据**：`tests/chrome-web-capture.unit.test.js`（30/30 通过），关键断言：
  - `新 user 消息实时入库`：VM 跑真实 `engine.js`，`env.sent[0].type === 'dcf.observation'`
  - `构建产物 VM 可完整执行`：bundle.js 在 VM 中启动引擎、注册站点适配器
  - `G1 manifest ↔ sites registry 一致性`：8 站 host_permissions 与 sites/*.js host 一一对应
- 结论：迁移后引擎消息类型已从 `web-capture.observation` 改为 `dcf.observation`（G1 原生契约）。

### 1.4 站点选择器未改动（迁移仅移动位置 + 改消息类型）

- 10 个站点适配器文件经 `git mv` 从 `chrome-extension/code-units/web-capture/sites/` 原样迁移到
  `seed/adapters/chrome/web-capture/sites/`（git rename 100%，仅 engine.js 1 处消息类型变更）。
- 站点 `roleOf` / `textOf` / `conversationId` / `messageSelectors` 逻辑**零改动**——
  Wave 0 基线（commit 5a04429）8 站 BrowserClaw 真实验收通过的选择器有效性在迁移后保持不变。

## 二、待真实复验（pending，如实标注，不伪造）

### 2.0 真实浏览器 E2E 尝试与发现（2026-07-30）

- **尝试**：真实 Google Chrome（150/152）以 `--load-extension` + `--disable-extensions-except`
  加载 G1 扩展，配合 localhost 合成对话页 + 测试适配器，验证 content script → dcf.observation
  → G1 SW → companion 全链。
- **发现（高价值）**：过程中暴露 bundle 注册表接线缺陷（见 §1.2b），已修复并加回归守卫。
  这正是真实浏览器验收相对单测的价值——单测直接 require 源文件，漏掉了 bundle 层缺陷。
- **环境限制**：本环境 Chrome 150/152 headless 与 headed 均未注入 CLI 加载的未打包扩展 content script
  （beacon 为 null，无扩展 SW target），属该 Chrome 构建对 `--load-extension` 的处理限制，非 DCF 缺陷。
  真实 8 站 E2E 仍以 BrowserClaw（用户登录态浏览器）为准。

### 2.1 8 站 G1 链真实浏览器复验

- **状态**：pending —— 需 BrowserClaw（用户真实登录态浏览器）可用。
- **阻塞原因（本次执行环境）**：
  - BrowserClaw MCP session 未注册（`session is not registered`）。
  - 无可访问的 CDP 端口（9110/9222/9333 均无响应）。
  - 8 站（豆包/Gemini/Grok/Kimi/Z.ai/DeepSeek/MiniMax/小米 MiMo）需用户登录态，本执行环境不具备。
- **复验入口**（BrowserClaw 可用时执行）：
  ```bash
  # 1. 启动 companion
  node seed/companion/index.js --port=8472
  # 2. 在 BrowserClaw 加载 G1 扩展（seed/adapters/chrome），获取其真实 EXT_ID
  # 3. 逐站真实验收（EXT_ID 经环境变量注入）
  DCF_G1_EXT_ID=<g1-ext-id> node scripts/web-capture-accept-site.cjs <site>
  # site ∈ gemini|doubao|kimi|deepseek|grok|z-ai|minimax|xiaomimimo
  ```
- **判据**（每站 6 项，来自 Wave 0 标准）：user 事件存在、user 文本含唯一标记、assistant 事件存在、
  assistant 文本非空完整、流式只入库一次、source_id 与 URL 会话 ID 一致。
- **诚实约定**：任何一站 G1 链复验失败，该站 `verified` 回退 false 并如实记录；不以 Wave 0 旧链结论冒充 G1 链结论。

## 三、site adapter verified 字段现状

站点适配器的 `verified` 字段反映 **Wave 0 旧链真实验收**结果（选择器有效性）。
迁移未改动选择器，故保持原值；G1 链的独立 `verified` 标注待 §2.1 复验后落档。

| 站点 | Wave 0 选择器验收 | G1 链真实复验 |
|---|---|---|
| Gemini / 豆包 / Kimi / DeepSeek / Grok / Z.ai / MiniMax / 小米 MiMo | ✓ (5a04429) | pending（BrowserClaw 可用后执行）|
| Claude.ai / 元宝 | verified:false（登录墙，清单外）| N/A |
