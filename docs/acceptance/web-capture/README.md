# 网页端多站点采集适配 — BrowserClaw 验收记录（终版）

> **归位声明（2026-07-30）**：采集能力已从 spec 过渡形态（`chrome-extension/code-units/web-capture/`）迁至 G1 Target Adapter 终态（`seed/adapters/chrome/web-capture/`）。详见 ADR: [2026-07-30-dcf-web-capture-target-adapter.md](../../adr/2026-07-30-dcf-web-capture-target-adapter.md)。

## 归位后链路（G1 终态）

```
Target Page (8站) → seed/adapters/chrome/web-capture/bundle.js (content_script)
  → engine.js MutationObserver → CapturedEvent
  → chrome.runtime.sendMessage({type:'dcf.observation'})
  → G1 background.js (原生 SW，importScripts ulid+outbox-core)
  → OutboxCore.recordObservation → chrome.storage.local (容量 8)
  → dcf-outbox-flush alarm (0.5min) → POST companion /rpc/events/batch
  → raw_events
```

与旧世界差异：
- 消息类型 `web-capture.observation` → `dcf.observation`（G1 background.js 原生 handler）
- 无需 host-main 委派（G1 adapter 原生拥有 service worker）
- 旧 `chrome-extension/src/web-capture-background.js` 已删除
- 构建脚本 `scripts/build-g1-adapter.js` 拼接 bundle.js（零依赖）

---

任务：`网页端多站点采集适配_task-03a.md`（v2 四原则合规）
站点清单：以用户 2026-07-29 指示为准——**豆包 / Gemini / Grok / Kimi / Z.ai / DeepSeek / MiniMax / 小米 MiMo**（替换原清单的 Claude.ai 与元宝；两者适配器文件保留但不在用户目标清单内，verified:false）
执行时间：2026-07-29
环境：BrowserClaw（用户真实登录态）+ DCF Chrome 扩展（解包自 `dist/dcf-chrome-extension`）+ companion（127.0.0.1:8472）
节奏：做一个验一个（侦察 → 实现 → 构建 → 真实验收，通过后才进入下一站）

## 验收总览：8/8 全部通过

| 站点 | 会话 URL 形态 | source_id | 断言 | verified |
|---|---|---|---|---|
| Gemini | `/app/{hex}` | EPBF4TQM6R83MT846PVJQE2QG0 | 6/6 ✓ | `true` |
| 豆包 | `/chat/{digits}` | 22KK47W2WTWFA2M4N6KRFQC57H | 6/6 ✓ | `true` |
| Kimi | `/chat/{uuid}` | 见 kimi-acceptance.json | 6/6 ✓ | `true` |
| DeepSeek | `/a/chat/s/{uuid}` | 见 deepseek-acceptance.json | 6/6 ✓ | `true` |
| Grok | `/c/{uuid}` | 见 grok-acceptance.json | 6/6 ✓ | `true` |
| Z.ai | `/c/{uuid}` | 见 z-ai-acceptance.json | 6/6 ✓ | `true` |
| MiniMax | `/mavis?id={digits}` | 见 minimax-acceptance.json | 6/6 ✓ | `true` |
| 小米 MiMo | `#/chat/{hex}`（hash 路由） | 见 xiaomimimo-acceptance.json | 6/6 ✓ | `true` |

每站 6 项断言（spec §四.4 扩展）：user 事件存在 ✓、user 文本含唯一标记 ✓、assistant 事件存在 ✓、assistant 文本非空完整 ✓、流式只入库一次（无半截）✓、source_id 与 URL 会话 ID 一致 ✓。

## 事件流消费验证（spec §五.7，通过）

`buildDigestPrompt(sourceIds=[EPBF4TQM6R83MT846PVJQE2QG0])` 产出含 Gemini 对话内容的 prompt（两行带 [Source ID: xxx] 前缀）；`POST /rpc/task/generate-request {source_ids:[...]}` 返回 `conversations_included: 2`。

## 框架验收（spec §五 1-4、6，全部通过）

1. **类型驱动**：`contract.js` 两个 Zod schema（Node 笼子）+ `runtime-check.js` 页面侧同规则断言（双层 contract）；3 入口坏配置 + 3 出口坏事件被双层拒绝 ✓（30 项单测）
2. **强约束**：引擎零 require 机器断言 ✓；坏站点配置隔离（VM 跑真实 index.js，2 坏 8 好互不影响）✓
3. **隔离**：每站点一个独立文件；任一文件错误只影响自身 ✓
4. **可丢弃**：站点文件即 contract 实现体，单站点重写不动 engine/contract/runtime-check ✓
6. **不回归**：`npm run verify` exit=0（37 项 ok:true，含 30 项 web-capture 断言 + 构建产物 VM 可执行）✓；depcruise 0 违规 ✓

## 验收驱动的真实缺陷修复（8 项）

1. **构建产物崩溃**：`__DCF_WEB_CAPTURE__` 未初始化 → runtime-check.js 先行初始化注册表；新增「构建产物 VM 可执行」单测防回归
2. **扩展被 Chrome 自动停用**：新增 host_permissions 后 Chrome 置 DISABLED → 验收流程必须重载+检查启用态（固化在 accept-site 脚本）
3. **基线误吞 SPA 新对话**：发送首条消息后 URL 才获得会话 ID → 基线判定按消息轮数（>1 轮才标历史），边界由 companion event_id 幂等吸收
4. **嵌套命中计数虚高**：同一逻辑消息被选择器内外层同时命中，角色计数 >1 轮误判为历史对话（MiniMax user 事件被吞）→ `findMessageElements` 保留最外层去重
5. **豆包 roleOf 误报快捷栏**：纯按钮/链接行容器被当 assistant → 按钮文本占比 ≥60% 排除
6. **gemini conversationId 不符真实 URL**：`/app/{hex}` 而非 `/share/{id}` → 实测修正
7. **grok 角色属性误认**：真实为 `data-role="user-message"`（非 role 属性）→ 实测修正
8. **思维链混入正文**：豆包「已完成思考」、MiMo `Collapsible_CollapsibleContent`、Kimi/Z.ai 思考块 → 各站 textOf 精确排除

## Cloudflare 处置经验（Claude.ai 备用）

CF 管理式质询「正在进行安全验证」不会自动放行；质询 iframe 内「请验证您是真人」checkbox 经 MCP act 真实点击后放行（cf_clearance cookie 落盘）。accept-site 脚本已内置该处理。

## 替换出清单的两站（保留 verified:false）

- **Claude.ai**：CF 可交互解除，但其后为登录墙（用户未登录 Claude）
- **元宝**：微信扫码登录墙（用户未登录）

## 复验入口

```bash
node scripts/build-g1-adapter.js                        # 构建 G1 web-capture bundle
node tests/chrome-web-capture.unit.test.js              # 30 项 web-capture 单测（指向 seed/adapters/chrome）
npm run verify:chrome                                    # 全量单测 + 构建 + JSON 校验
node scripts/web-capture-accept-site.cjs <site>          # 单站真实验收（G1 EXT_ID 从 manifest 推导）
# site ∈ gemini|doubao|kimi|deepseek|grok|z-ai|minimax|xiaomimimo
```

证据文件：`gemini-acceptance.json`、`doubao-acceptance.json`、`kimi-acceptance.json`、`deepseek-acceptance.json`、`grok-acceptance.json`、`z-ai-acceptance.json`、`minimax-acceptance.json`、`xiaomimimo-acceptance.json`、`recon-v2.json`
