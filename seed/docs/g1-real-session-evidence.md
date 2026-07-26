# G1 真实登录态验证报告 — chatgpt.com 选择器与活闭环（BrowserClaw）

**任务 ID**: #12
**执行者**: Robin (AI Agent)
**日期**: 2026-07-26
**工作区**: `/Users/looy/Documents/dcf` (main, HEAD=0c21309，未提交任何代码变更)

---

## 1. 目标与结论速览

`seed/docs/g1-acceptance-evidence.md` 遗留两个 unknown，本报告用 **BrowserClaw**
（继承用户真实登录态的 Chromium，MCP Streamable HTTP 端点 `http://127.0.0.1:9010/mcp`）实测关闭：

| Unknown | 结论 |
|---------|------|
| ① `content.js` 选择器（`[data-message-author-role]`、`data-message-id`）在真实登录会话 DOM 是否有效 | ✅ **有效，无需修改 content.js** |
| ② 真实对话活闭环（页面采集 → companion 入库 → query 回看） | ✅ **闭合，含幂等重投验证** |

由于选择器有效、未改动任何产品代码，**不需要**回归测试（g1-redline / test:chrome 保持原状）。

---

## 2. 验证通道：直连 MCP（Streamable HTTP）

IDE 注册的 MCP 会话已失效（`session is no longer live`），改为零依赖 Node 脚本直连端点，
按协议完成 `initialize`（响应 header 取 `mcp-session-id`）→ `notifications/initialized` →
`tools/list` → `tools/call`（SSE `data:` 行解析）。

- 握手成功，`tools/list` 返回 17 个工具（tabs / navigate / snapshot / act / evaluate / screenshot / wait / read / run 等）。
- 会话命名为 `dcf selector verify`；仅新开并操作了自己的标签页（page 1），未读取用户其他标签。
- 临时客户端脚本已在任务收尾时删除（见 §7 清理记录）。

---

## 3. Unknown①：选择器真实登录态实测 → 有效

### 3.1 过程

1. `tabs new` 打开 `https://chatgpt.com`（后台标签，page 1），快照确认为**真实登录会话**
   （登录账号侧栏与历史记录可见，非游客态）。
2. **发消息前基线**（新会话页）：`evaluate` 实测
   `document.querySelectorAll('[data-message-author-role]').length === 0`，composer 存在。
   —— 新会话本来就没有消息节点，这是诚实基线，不是选择器失效。
3. 通过 `act fill` + `Enter` 发送中性测试消息 `DCF selector verification ping`，
   `wait` 等到 assistant 节点出现。
4. **发消息后复测**（evaluate 原始输出）：

```json
{
  "url": "chatgpt.com/c/6a65aeb1-f3a0-83e8-be02-d8018d60ee8f",
  "authorRoleCount": 2,
  "messageIdCount": 2,
  "rolesValid": true,
  "allHaveMessageId": true,
  "outerHTMLHead": "<div data-message-author-role=\"user\" data-message-id=\"b5762024-9519-4722-8a99-c7cf2b91992a\" dir=\"auto\" class=\"min-h-8 text-message ...",
  "summary": [
    { "role": "user", "messageId": "b5762024-9519-4722-8a99-c7cf2b91992a", "textHead": "DCF selector verification ping" },
    { "role": "assistant", "messageId": "676d261c-9c75-412b-88b1-2daa3d4bd7a9", "textHead": "DCF selector verification pong" }
  ]
}
```

### 3.2 结论

真实登录会话 DOM 与 `seed/adapters/chrome/content.js` 的选择器契约完全一致：

- 每条消息节点带 `data-message-author-role`（取值 user / assistant，语义正确）；
- 每条消息节点带 UUID 格式的 `data-message-id`；
- `textContent.trim()` 能取到完整消息文本。

**content.js 无需修复。**

### 3.3 截图证据

`seed/docs/evidence/g1-real-session/chatgpt-real-session-selectors.jpeg`
（真实登录会话中 ping/pong 两条消息可见）。

---

## 4. Unknown②：真实对话活闭环 → 闭合

### 4.1 方法与等价性声明（如实说明）

未在 BrowserClaw 中加载 MV3 扩展，而是按任务书允许的方式做**等价执行**，拆分严格对应扩展架构：

| 真实扩展链路 | 本次等价执行 | 是否真实覆盖 |
|--------------|--------------|--------------|
| content.js 页内扫描 `[data-message-author-role]`、构造观测 | `evaluate` 注入同逻辑（选择器、role/messageId 过滤、text trim、eventType 判定逐行复刻） | ✅ 真实页面 DOM |
| outbox-core.js 稳定身份（`stableIdFromString`：SHA-256 → 26×5bit Crockford Base32） | 页内复刻同算法，`source_id`/`event_id` 推导式完全一致 | ✅ |
| background.js SW 经 HTTP 投递到 companion | 页外 Node 脚本以 SW 角色 POST `/rpc/events/batch` | ✅ 真实 companion + 真实 SQLite |
| `chrome.runtime.sendMessage` 消息通道、MutationObserver 循环、outbox 持久化 | **未在真实浏览器覆盖**，由既有单测覆盖（test:chrome 49/49） | ⚠️ 见 §6 遗留 |

**关键佐证发现（CSP）**：第一版注入尝试在页内直接 `fetch('http://127.0.0.1:8472/...')`，
被 chatgpt.com 的 CSP 阻止（`TypeError: Failed to fetch`）。这从反面证实了 G1 架构中
"页面侧只采集、由 SW（不受页面 CSP 约束）负责 HTTP 投递"的设计是**必要**的，而非偶然选择。

### 4.2 实测输出

- 采集来源：真实会话 `chatgpt.com/c/6a65aeb1-f3a0-83e8-be02-d8018d60ee8f`
- `source_id = stableIdFromString('dcf.source:' + conversationKey)` = `JMJSY1FGQJ25Z1BW9HVFWJ7B8G`
- companion：`node seed/companion/index.js --port=8472 --db=/tmp/dcf-bclaw-verify.db`（mock_mode=false）

```
flush #1 (SW 角色首投):        {"inserted":2,"total":2,"duplicated":0}
flush #2 (同批次重投，幂等):    {"inserted":0,"total":2,"duplicated":2}
query 回看 (?source_id=...&orderBy=ASC): 2 条
  seq=1  conversation.message.sent      "DCF selector verification ping"   message_id=b5762024-...
  seq=2  conversation.message.received  "DCF selector verification pong"   message_id=676d261c-...
db stats: {"event_count":4,"boundary_count":2}   // 4 = 前置 companion 冒烟 2 条 + 真实会话 2 条
```

活闭环三段全部闭合：**真实页面采集 → companion 入库（含幂等吸收）→ query 完整回看**。

### 4.3 证据文件

- `seed/docs/evidence/g1-real-session/live-loop-real-session.json` —— 活闭环完整取证
  （flush1/flush2/query 回看原始返回/db stats）。
- `seed/docs/evidence/g1-real-session/live-loop-companion.json` —— 前置 companion 冒烟
  （合成事件，仅验证 companion 侧 ingest/query/幂等，非浏览器闭环，文件内已如实标注）。

---

## 5. 过程中的失败与修正（如实记录）

1. **CallMcpTool 会话失效**（`session is no longer live`）→ 改为直连 Streamable HTTP，握手成功。
2. **首轮合成事件"假成功"**：`/rpc/events/ingest` 看似返回成功但 `event_count=0`——根因是
   event_id/source_id 非 ULID 格式被 companion 校验拒绝。修正为合规 ULID 后入库成功。
   （companion 校验行为正确，非缺陷，无需记录缺陷单。）
3. **页内 fetch 被 CSP 阻止** → 拆分为页内采集 + 页外投递（见 §4.1，反而成为架构佐证）。

---

## 6. 遗留 unknown

以下环节本次仍未在真实浏览器中覆盖，依赖既有单测背书：

- MV3 扩展实际加载后的 `chrome.runtime.sendMessage` content→SW 消息通道；
- content.js 的 MutationObserver / 3s 扫描 + 2 次稳定判定（final）在真实打字流中的行为；
- SW 重启后 outbox 持久化恢复。

关闭方式：在可加载扩展的 Chrome 实例中装载 `seed/adapters/chrome/` 做一次端到端观察（后续任务）。

---

## 7. 清理记录

- BrowserClaw：尝试关闭自己打开的 page 1 标签失败——原 MCP 会话已过期，新会话被服务端所有权护栏
  拒绝（`page 1 is not owned by this agent`）。该标签（`DCF selector ping` 会话页）需用户
  手动关闭；除此之外未触碰任何标签。
- companion（port 8472）：已关停。
- 临时产物：`/tmp/dcf-bclaw-verify.db*`、`/tmp/bclaw-session-id.txt`、`/tmp/bclaw-captured-events.txt`、
  仓库内临时目录 `.tmp-bclaw/`（MCP 客户端与注入脚本）——全部删除。
- git：未 commit / 未 push；工作区新增仅限本报告与 `seed/docs/evidence/g1-real-session/` 证据文件。

---

**报告生成时间**: 2026-07-26T07:05:00Z
**验证人**: Robin (AI Agent)
**状态**: Complete — 两个 unknown 均已实测关闭
