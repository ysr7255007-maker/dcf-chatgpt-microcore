# DCF 测试分级与验收标准 (Acceptance Test Tiers)

本文档定义 DCF 项目的三层测试体系，明确区分：
- **Tier 1**: 单元/集成测试（无浏览器，直连 Companion RPC）
- **Tier 2**: Surface UI 验收（真实 Chrome+CDP，使用种子数据，禁止声称验证真实 AI）
- **Tier 3**: 真实 E2E（BrowserClaw 驱动真实 Chrome，per-run nonce 防造假断言）

## 核心防造假原则

**T0. Nonce 唯一性**  
每次运行注入唯一 `DCF-NONCE-{timestamp}-{random}`，作为机器可验证的“探针”。

**T1. 计数增量验证**  
消息计数或会话计数必须在测试前后有确定性增量（≥2），杜绝读取预存状态冒充成功。

**T2. 回复可追溯性**  
助手回复必须包含注入的 nonce，证明是实时生成而非读取缓存/预存消息。

**T3. 判定自动化**  
所有防造假检查必须是机器可自动验证的信号，人工截图仅作附件不能改变 verdict。

**T4. 失败显式报错**  
任何检查失败必须 throw Error 并退出码 1，绝不静默或假装通过。

---

## Tier 1: Unit & Integration Tests

### 定义
- **目标**: 验证组件内部逻辑、Companion RPC 契约、数据结构正确性
- **运行环境**: Node.js 18+，无需浏览器
- **数据源**: 合成的事件、内存中的数据结构、临时 SQLite
- **是否允许调用外部服务**: 否（Companion 运行在 `--db=/tmp/...` mode，mock_mode=false 但本地）

### 现有测试清单

| 文件名 | 覆盖模块 | 备注 |
|--------|---------|------|
| `g1-redline.test.js` | redline 基础逻辑 | 单测 |
| `g3-material.unit.test.js` | material revision 核心算法 | 单测 |
| `g3-export.test.js` | export Markdown/JSONL 格式 | 单测 |
| `g3-sync.test.js` | sync 逻辑（非真实 git） | 单测 |
| `companion-doctor.unit.test.js` | companion 自诊断 | 单测 |
| `companion-v0.unit.test.js` | companion 接口兼容性 | 单测 |
| `g4-companion.unit.test.js` | lifecycle companion binding | 单测 |
| `g4-lifecycle-flow.test.js` | lifecycle flow logic | 单测 |
| `g5-companion.unit.test.js` | cross-executor companion | 单测 |
| `g5-lifecycle-flow.test.js` | rebind/binding_history | 单测 |
| `g6-companion.unit.test.js` | patch management companion | 单测 |
| `g6-surface.test.js` | patch manager surface render | UI 渲染函数（不启动浏览器）|

### 运行命令

```bash
# All Tier 1 tests
node seed/tests/g1-redline.test.js
node seed/tests/g3-material.unit.test.js
# ... other files

# Or via package.json if configured
npm test -- --tier=1
```

### 防造假检查清单 (N/A for Tier 1)
- [x] 不适用：单元测试不涉及真实用户交互或 AI 响应

---

## Tier 2: Surface UI Acceptance (Real Browser, Seeded Data)

### 定义
- **目标**: 验证 Surface UI 渲染、用户交互流程、RPC 绑定
- **运行环境**: 真实 Chrome + CDP（`--headless=new`）
- **数据源**: 
  - Companion 预先注入的合成事件（seed data）
  - **NOT** 真实 ChatGPT 对话
  - **NOT** 真实扩展采集流
- **关键约束**: **禁止声称验证了真实 AI 交互**，测试文案需声明"验证 Surface UI，真实 E2E 见 g1-real-e2e"
- **Companion 模式**: local-only mode（PATH 中移除 gh，测试 503 降级路径）

### 现有测试清单

| 文件名 | 覆盖场景 | 数据来源 | 备注 |
|--------|---------|---------|------|
| `g2-reconnect.acceptance.mjs` | offline banner + auto-reconnect | Companion seeded events | Tier 2 |
| `g3-surface.acceptance.mjs` | revision candidate loop | Companion seeded conversations | Tier 2 |
| `g4-surface.acceptance.mjs` | lifecycle four-state machine | Companion seeded tasks | Tier 2 |
| `g5-surface.acceptance.mjs` | rebind + binding_history | Companion seeded executors | Tier 2 |
| `g6-surface.acceptance.mjs` | patch proposal → activate → revert | In-process API calls | **实际 Tier 1**（未启动浏览器）|

**注意**: `g6-surface.acceptance.mjs` 虽然命名是 acceptance，但实际上不调用浏览器（直接调用 render functions），应视为 Tier 1。**其余 g2-g5 为真正的 Tier 2**。

### 运行命令

```bash
# Each Gn acceptance test is standalone
node seed/tests/g2-reconnect.acceptance.mjs
node seed/tests/g3-surface.acceptance.mjs
node seed/tests/g4-surface.acceptance.mjs
node seed/tests/g5-surface.acceptance.mjs

# Evidence screenshots saved to seed/docs/evidence/g{2,3,4,5}/
```

### 统一注释模板（已在 g4/g5/g6 添加）

```javascript
#!/usr/bin/env node
// Tier 2: Surface UI acceptance test.
// Validates UI rendering and RPC binding using pre-seeded companion data.
// Does NOT verify any real AI interaction with chatgpt.com; see g1-real-e2e.acceptance.mjs for Tier 3 E2E.
//
// Path exercised: ...
// Usage: node seed/tests/g{2,3,4,5}-surface.acceptance.mjs
```

### 防造假检查清单
- [ ] 测试文件头部声明为 Tier 2（含"not real AI"警示）
- [ ] 不使用预存文本冒充新消息（所有断言基于 DOM 读取而非硬编码期望值）
- [ ] 证据截图只作参考，不用于判定 pass/fail
- [ ] 若 Companion unreachable，退出码 2 诚实报告 blocked

---

## Tier 3: True E2E with BrowserClaw (Per-Run Nonce Anti-Fraud)

### 定义
- **窄验证原则**: Tier 3 只验证一条链路，不引入身份/凭证/adapter instance/构建哈希/收据体系：

  ```
  本轮新对话 + nonce
    → 新增 user DOM message_id（ChatGPT 分配的 UUID）
    → 其后新增 assistant DOM message_id
    → Companion raw_events 中出现相同 message_id 与 nonce
    → SQLite 提交后只能只读查询核对
  ```

- **目标**: 端到端验证真实 ChatGPT 对话采集→Companion 入库的闭合链路
- **运行环境**: BrowserClaw 驱动的已登录态真实 Chromium
- **MCP 接口**: `http://127.0.0.1:9010/mcp` (Streamable HTTP, tools/tabs/navigate/act/evaluate/screenshot)
- **Companion URL**: `http://127.0.0.1:8472`（可通过 `--companion=` 覆盖）
- **Companion 访问规则（硬约束）**: 验收脚本**绝对禁止调用 Companion 的事件写入接口**
  （`/rpc/events/ingest`、`/rpc/events/batch` 等）。必须经 `createReadOnlyCompanionClient`
  访问，白名单仅 `/rpc/health`、`/rpc/stats`、`/rpc/events/query`，强制 GET，
  白名单外直接 throw —— 从代码结构上排除"脚本直写伪造入库"。
- **防造假机制**:
  1. 每次运行生成独立 `DCF-NONCE-{ts}-{rand}`
  2. 注入 nonce 到 user 消息，断言新增 user DOM 消息含 nonce
  3. 断言 assistant 回复包含 nonce
  4. 断言消息计数增量 ≥ 2
  5. 只读轮询 `/rpc/events/query?q={nonce}`，库内事件必须携带与 DOM 一致的
     user/assistant `message_id`（`assertCompanionEventsMatchDom`）——直写伪造
     无法预知 ChatGPT 分配的 UUID，结构上无法通过
- **失败语义**:
  - Any anti-fraud assertion fail → exit code 1
  - Companion ingest failure but UI success → verdict=degraded, record degraded_reason, exit 1

### 现有测试清单

| 文件名 | 功能 | 启动方式 |
|--------|------|---------|
| `g1-real-e2e.acceptance.mjs` | **主入口**：Nonce 注入、AI 回复验证、Companion 轮询 | `node seed/tests/g1-real-e2e.acceptance.mjs` |
| `e2e-browserclaw.test.mjs` | 薄入口转发器（打印说明 → spawn g1-real-e2e） | `node e2e-browserclaw.test.mjs` |

### 前置条件

```bash
# 1. Start Companion
cd seed/companion
node index.js --port=8472 --db=~/.dcf/dcf.db &

# 2. Launch BrowserClaw with MCP server on port 9010
#   (Start via IDE MCP registration or run separately)
#   Verify: curl http://127.0.0.1:9010/health

# 3. BrowserClaw must be signed into chatgpt.com
#   Use your personal Plus account for realistic validation
```

### 运行命令

```bash
# Full E2E with anti-fraud checks
node seed/tests/g1-real-e2e.acceptance.mjs

# Self-test mode: simulate fraud path offline
node seed/tests/g1-real-e2e.acceptance.mjs --self-test-fraud

# Override Companion endpoint
node seed/tests/g1-real-e2e.acceptance.mjs --companion=http://localhost:9999

# With custom evidence directory
mkdir -p /tmp/evidence
node seed/tests/g1-real-e2e.acceptance.mjs --evidence=/tmp/evidence
```

### 输出示例

```
✅ PASS: g1-real-e2e
  run_id: DCF-NONCE-XYZ-1234567890
  conversation_url_before: https://chatg.com/c/abc-def
  conversation_url_after: https://chatg.com/c/abc-def
  nonce_injected: DCF-NONCE-ABC-12345
  nonce_in_reply: ✅ verified in assistant response "Your nonce: DCF-NONCE-ABC-12345 ..."
  message_count_delta: before=2, after=4, delta=2 ✓
  companion_evidence: Found 1 event(s) containing nonce
  verdict: pass
  evidence_manifest: seed/docs/evidence/e2e-real/manifest-DCE-NONCE-XYZ-1234567890.json
```

### 防造假检查清单（每 run 必验）

- [ ] **Nonce 唯一性**: generateRunNonce() 返回的字符串在本次运行周期内不可重复
- [ ] **计数增量**: assertMessageCountDelta(before, after, min=2) 通过
- [ ] **Nonce 注入验证**: assertNonceInNewUserMessage(messages, nonce) 找到 nonce
- [ ] **回复可追溯**: assertAssistantReplyContainsNonce(replyText, nonce) 包含 nonce
- [ ] **Companion 对账**: assertCompanionEventsMatchDom(events, {nonce, userMessageId, assistantMessageId})
      —— 库内事件 message_id 必须与 DOM 观测一致，仅含 nonce 不够
- [ ] **只读访问**: 对 Companion 的所有访问经 createReadOnlyCompanionClient，白名单外 throw
- [ ] **Manifest 记录**: writeEvidenceManifest(dir, manifest) 包含 verdict=pass 且 no failures
- [ ] **失败显式**: 任一断言失败则 throw Error + process.exit(1)

### 反向自检 (--self-test-fraud)

内置子命令用于离线验证基座有效性，必须拒绝**三种负控路径**：

1. **① 只改 DOM 未发送** —— 计数不变 / 只多 1 条 / 无新增 user 消息
2. **② 读取旧消息冒充** —— 新增不含 nonce / 预存文本冒充回复 / 空回复
3. **③ 脚本直写 Companion** —— 伪造事件含 nonce 但 message_id 与 DOM 不符（对账断言拒绝）；
   只读客户端对 `/rpc/events/ingest`、`/rpc/events/batch` 等写路径直接 throw

同时含正向对照：真实信号（计数 +2 / user 含 nonce / 回复含 nonce / 事件与 DOM
message_id 对账一致）必须能通过，证明断言不是"永远失败"。

```bash
node seed/tests/g1-real-e2e.acceptance.mjs --self-test-fraud
```

若任一负控路径未被拒绝（漏判）或正向对照被误拒，整个防造假基座视为失效，
子命令 exit 1，禁止用于验收。

---

## 跨 Tier 依赖关系

```
Tier 1 (unit/integration)
  │
  ├─ Validated components (redline, material, companion RPC)
  │
  ▼
Tier 2 (Surface UI with seeded data)
  │
  ├─ Validates UI rendering flows
  │
  └─ Does NOT claim real AI verification
      │
      ▼
Tier 3 (True E2E with nonce)
      │
      ├─ Verifies real ChatGPT interaction（窄验证链路，见上）
      ├─ Requires BrowserClaw + logged-in Chromium
      ├─ Per-run nonce proves freshness
      └─ Companion 只读访问 + message_id 与 DOM 对账，禁止写入接口
```

### 执行顺序建议

```bash
# CI pipeline example
npm test -- --tier=1           # Fast unit tests first
node seed/tests/g3-surface.acceptance.mjs  # UI sanity check
node seed/tests/g1-real-e2e.acceptance.mjs  # Slow but critical final gate
```

---

## 附录：常见陷阱与修复

### P0. Pre-stored Messages Fraud (已修复)

**问题**: BrowserClaw act(fill) 修改 contenteditable DOM 但不触发 React state → 消息从未发送 → 测试读取聊天历史中的旧消息冒充成功

**修复**:
1. Inject unique nonce per run
2. Assert nonce appears in assistant reply
3. Assert message count delta ≥ 2
4. Never trust visual "success" without machine-verifiable signals

### P1. Screenshot as Proof (Never Accept)

**错误做法**: 仅凭截图显示"Test Passed"即标记通过

**正确做法**: Screenshot attached for debugging only, verdict based solely on nonce/count/assertions

### P2. Silent Degradation (禁止)

**错误做法**: Companion 连接失败时静默降级为 mock mode

**正确做法**: Exit code 2, explicit error message: "Companion at <URL> unreachable, test aborted honestly"

### P3. Direct Companion Write Fraud (结构性排除)

**问题**: 验收脚本若能调用 `/rpc/events/ingest` / `/rpc/events/batch`，就能自己写入
含 nonce 的伪造事件，让"入库回查"假通过

**修复**:
1. 所有 Companion 访问经 `createReadOnlyCompanionClient`（无写方法，白名单外 throw）
2. 入库判定用 `assertCompanionEventsMatchDom` 对账 DOM message_id ——
   即使绕过只读客户端直写，也无法预知 ChatGPT 分配的 UUID，对账必失败

---

**文档版本**: v1.1（吸收窄验证与只读约束修正）  
**最后更新**: 2026-07-27  
**维护者**: Taylor (DCF Maintenance Loop Owner)
