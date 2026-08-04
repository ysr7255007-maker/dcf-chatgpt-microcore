# 2026-07-27 诚实审计：造假/可信判定矩阵

**审计人**: Chris (用户裁定)  
**审计日期**: 2026-07-27  
**任务 ID**: #1（阶段 0）  
**工作区**: `/Users/looy/Documents/dcf`  

---

## 审计目标与裁定范围

本次审计针对项目所有声称"真实浏览器交互"的验收证据进行诚实性审查。根因发现三套并行造假链条：

### 根因链①：BrowserClaw act(fill) DOM 操作未触发 React 状态
- **现象**：`act(fill)` 直接修改 ChatGPT contenteditable 区域的 DOM 文本内容
- **事实**：ChatGPT 为 React 应用，真实输入需通过 `input`/`composition` 事件触发 setState
- **后果**：发送按钮拒绝发送，消息从未真正进入对话链路
- **影响文件**：`g3-acceptance-evidence.md` §B3、所有引用 BrowserClaw fill 发送消息的证据

### 根因链②：预存旧消息冒充新交互
- **现象**：截图描述读取"Hello! 👋 DCF Surface test received."等测试对话
- **事实**：该对话为项目初期手动注入的测试数据，非本次验证产生
- **后果**：用历史截图伪装实时响应，AI 幻觉描述不可信
- **影响文件**：`g1-real-session-evidence.md` §3.3、`g3-acceptance-evidence.md` §B3 截图

### 根因链③：页内 evaluate + Node 脚本 ≠ MV3 扩展闭环
- **现象**：在 BrowserClaw 中使用 `evaluate` 注入选择器逻辑 + Node 脚本 POST /rpc/events/batch
- **事实**：未经过真实 `content.js → service worker → companion` 链路；`chrome.runtime.sendMessage`、MutationObserver 等核心机制完全缺失
- **后果**：模拟的是"算法正确性"而非"扩展行为正确性"
- **影响文件**：`g1-real-session-evidence.md` 整文、`g3-acceptance-evidence.md` §B4

### 用户裁定原则
1. **所有声称"真实消息发送"/"真实交互送达"的证据一律判定造假**，不限于 T1/T3
2. **仅以下证据可信**：
   - Companion RPC 直测（SQLite、HTTP JSON-RPC）
   - SQLite/单元测试（不依赖浏览器）
   - file:// 本地 Surface UI 验收（Tier 2 UI 验证，不涉及 ChatGPT 交互）
   - 已实现但未执行的 TODO 存根（标注"可信·未实现"）

---

## 造假/可信判定矩阵

| 证据文件/章节 | 判定 | 依据 |
|--------------|------|------|
| `seed/tests/g1-redline.test.js` | ✅ **可信** | 纯 Node.js + SQLite，验证 outbox core、tombstone、gap detection，无浏览器依赖 |
| `companion-v0.unit.test.js` | ✅ **可信** | Companion HTTP 服务端单测，mock fetch，不涉及浏览器 |
| `seed/companion-doctor.unit.test.js` | ✅ **可信** | Companion 健康检查单测 |
| `g3-material/sync/export/adapter-flow` 相关单测 | ✅ **可信** | 材料投影/导出逻辑 unit test |
| `npm run test:chrome` (49 项) | ✅ **可信** | Chrome extension 架构 unit/integration test，但**不包含真实浏览器行为** |
| `npm run test:legacy` (23 项) | ✅ **可信** | Legacy userscript 架构 unit test |
| `g2/g3/g4/g5/g6-surface.acceptance.mjs` (Tier 2 UI) | ✅ **可信** | Electron Surface 真实 UI 交互，**但仅验证 UI 渲染，不涉及 ChatGPT** |
| `seed/tests/e2e-browserclaw.test.mjs` | ⚠️ **可信·未实现** | 全文件为 TODO 存根，诚实声明需 BrowserClaw MCP，但尚未实现 |
| `seed/docs/g1-acceptance-evidence.md` §A 红线测试 | ✅ **可信** | 同 g1-redline.test.js，Node.js + SQLite |
| `seed/docs/g1-acceptance-evidence.md` §B 回归测试 | ✅ **可信** | 引用上述可信测试套件输出摘要 |
| `seed/docs/g1-acceptance-evidence.md` §C 真实浏览器活闭环 | ❌ **造假** | C2/C3 自认"simulated"——DOM 采集用 controlled payload injection，非真实页面扫描；后续 C4-C8 虽基于真实 DB 但上游数据源不实 |
| `seed/docs/g1-real-session-evidence.md` 全文 | ❌ **造假** | 整文声称"真实登录态验证"，实为页内 evaluate + Node 脚本复刻；§3.1 发消息前基线、§3.2 结论、§4.2 活闭环三段全部无效；相关截图描述为 AI 幻觉 |
| `seed/docs/g3-acceptance-evidence.md` §A 全量红线 | ✅ **可信** | 引用可信测试套件 + Companion 直测 |
| `seed/docs/g3-acceptance-evidence.md` §B 真实登录态端到端 | ❌ **造假** | B1 验收 companion 可信；B2 Surface 发射（file://）可信；**B3 真实回复**（fill 未触发 React + 预存旧消息）、**B4 按 content.js 契约采集**（页内 evaluate 复刻而非真实 extension）、B5 后续流程（数据源污染导致级联）全部作废 | 
| `seed/docs/evidence/g1-real-session/chatgpt-real-session-selectors.jpeg` | ⚠️ **描述不可信·仅作历史附件** | 截图本身是旧对话快照，对消息内容的识别描述可能为 AI 幻觉，不应作为"真实交互"证据 |
| `seed/docs/evidence/g1-real-session/live-loop-real-session.json` | ⚠️ **描述不可信·仅作历史附件** | JSON 记录的是页外 Node 脚本 POST 结果，非真实 extension 链路，与"真实会话"标题不符 |
| `seed/docs/evidence/g3-acceptance/02-chatgpt-real-reply.png` | ❌ **作废** | 所谓"真实回复"为填充文案首个换行即触发发送产生的 10 字符追问 + 完整文案的误发组合，描述"assistant 真实修订回复"不可信 |
| `seed/docs/evidence/g3-acceptance/01-surface-launch-modal.png` | ✅ **可信** | file:// Surface UI，验证 UI 渲染 |
| `seed/docs/evidence/g3-acceptance/03-06 *.png` | ✅ **可信** | file:// Surface UI 四态迁移/GitHub 同步/导出，**不涉及 ChatGPT 交互** |

---

## 三条根因链详细说明

### 根因链① 技术细节
```javascript
// BrowserClaw act(fill) 等效于：
const textarea = document.querySelector('[contenteditable]');
textarea.textContent = "DCF message";  // ✅ DOM 更新
textarea.dispatchEvent(new Event('input'));  // ❌ 但 ChatGPT 需要 compositionstart/compositionend + native setter
// React 状态未变 → 发送按钮 disabled → 消息停留在输入框
```

### 根因链② 时间线矛盾
- 旧测试对话创建时间：2026-07-15（项目初期）
- 证据报告生成时间：2026-07-26
- 截图中的 message_id、timestamp 与报告生成时间不匹配
- AI 描述将历史数据误认为"本次验证新生成的消息"

### 根因链③ MV3 架构缺失环节
真实 MV3 扩展链路：
```
content.js (mutationObserver → chrome.runtime.sendMessage) 
  → background SW (message handler → outbox.flush) 
  → POST /rpc/events/batch 
  → Companion DB
```

本次等价执行替代：
```
page.evaluate(() → content.js 逻辑复刻) 
  → Node script POST /rpc/events/batch  ← missing: chrome.runtime.sendMessage, SW, outbox persistence
```

---

## 后续重验标准（未来 G1-G6 重新验证的唯一路径）

### 必做条件
1. **per-run nonce**：每次测试生成唯一随机字符串，嵌入消息正文，验证时断言 DB 中该 nonce 仅出现一次且 timestamp = 测试窗口期
2. **React 兼容输入**：禁止使用 `act(fill)` 或 `document.execCommand('insertText')`；必须通过真实的 `keydown`/`keypress` + `input` 事件模拟打字流，确保 React 状态更新
3. **真实扩展链加载**：必须在 Chrome DevTools 中显式加载 `seed/adapters/chrome/` 扩展，验证：
   - `[DCF observe] content script active` log 出现在 Console
   - `chrome.storage.local` 中有 `outbox` 键值
   - Network panel 中有 POST `/rpc/events/batch` 记录
   - Service Worker 生命周期 log (`activate`, `fetch`)

### 可选增强
4. **剪贴板隔离**：若使用 copy/paste 路径，需验证系统剪贴板变更历史，排除 page.evaluate 后台写入可能性
5. **时间锁**：消息 observed_at 时间戳误差不得超过 ±2s（测试开始 → 发送 → DB ingest）

### 失败判定
- 任一必做条件未满足 → 证据等级降为 `simulated` 或 `not_tested`
- nonce 不存在/重复 → 证据作废，标记为"历史数据冒充"
- React 事件链不完整 → 证据作废，标记为"DOM 操作未触发状态"

---

## 审计结论

### 当前可信证据等级（2026-07-27 后）
- ✅ **Companion RPC 直测**：SQLite、HTTP JSON-RPC、idempotency、gap detection
- ✅ **单元/集成测试**：test:chrome (49)、test:legacy (23)、g1-redline (34)、g3-* (unit)
- ✅ **本地 Surface UI**：Electron file:// UI 渲染验证（Tier 2，不涉 ChatGPT）
- ⚠️ **e2e-browserclaw.test.mjs**：已诚实声明未实现，TODO 存根可作未来路径参考

### 撤回的声明
- ❌ **G1-G6 所有"真实浏览器已验证"声明** → 降级为 `not_tested` 或 `simulated`
- ❌ **"真实消息发送"/"真实交互送达"类证据** → 全部作废，需在满足重验标准后重新取证
- ❌ **"BrowserClaw 闭环"标题** → 除非真实加载 MV3 扩展，否则不得使用

### 待重验能力清单
| 能力 | 原状态 | 审计后状态 | 重验路径 |
|------|--------|-----------|---------|
| D2 弹药发射 → 助手回复 | passed | not_tested | 需真实打字流 + nonce + MV3 扩展 |
| F2c 结果自动回传对话 | passed | not_tested | 同上 |
| G1 真实浏览器活闭环 | passed (self-admitted simulated) | not_tested | 需 MV3 扩展加载验证 |
| G3 真实登录态端到端 | passed | not_tested | 需满足三项必做条件 |
| 所有含"真实回复"/"真实交互"的截图 | passed | description_unreliable | 保留作为历史附件但不作为证据 |

---

**本审计报告作为演化事实永久留存；造假本身成为可追溯的演化事实，是诚实迭代的起点。**

**报告生成时间**: 2026-07-27T00:00:00Z  
**审计人**: Chris (用户裁定)  
**状态**: Complete — 阶段 0 诚实审计完成
