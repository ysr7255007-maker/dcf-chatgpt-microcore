# G3 适配器侧证据文档 v0 — ChatGPT 修订候选通路（G3.1 人工标记）

> 任务 #14 交付物。日期：2026-07-26。基线：main @ 0c21309（工作区含 #13 companion 材料代谢核心，未提交）。
> 边界：本任务只改 `seed/surface/`、`seed/tests/`、`seed/docs/`；`seed/companion/` 与 `seed/adapters/chrome/` 零改动。

## 1. 结论先行

- **适配器（seed/adapters/chrome/）零改动**。G3.1 人工标记路径不需要适配器任何新能力：
  - 采集侧：content.js 已按 `[data-message-author-role]` + `data-message-id` 采集 assistant 回复并经 outbox 批量入库（`conversation.message.received` / `.updated`），这正是"修订候选的原材料"。
  - 标记侧：G3.1 明确"人工标记，不自动注入"。标记发生在 Surface（file:// 页面直连 companion 8472），而非 chatgpt.com 页面内（该页 CSP 禁 fetch 127.0.0.1，这也是当初把标记放在 Surface 的裁决依据）。
  - 发射侧：复用现有"modal + 剪贴板"机制，只是文案加了修订指令模板，同样不在适配器内。
- Surface 新增独立页 **`seed/surface/g3-materials.html`**（不在 g2-dashboard 内生长），共享逻辑抽为 UMD 模块 **`seed/surface/g3-materials-core.js`**（浏览器 `window.DCF_G3_CORE` / node `require`，零 npm 依赖，可被单测直接测）。
- g2-dashboard.html 仅加 1 行到 g3 页的链接。

## 2. 用户路径（实现对照）

1. **发射**：在 g3 页选中材料实体 → 「发射到对话（含修订指令模板）」→ modal 展示 `【DCF 修订请求】` 模板 + 材料正文逐字 → 复制到剪贴板 → 用户自己粘贴进 ChatGPT。不自动注入。
2. **采集**：用户与 ChatGPT 的往返由现有 Chrome 适配器照常采集入库（适配器无感知、无改动）。
3. **人工标记**：g3 页 FTS 搜索已入库消息 → 只列出 assistant 回复（`extractAssistantMessages` 过滤 `role==='assistant'` 且有 text）→ 选一条 + 选目标材料实体（或新建）→ `POST /rpc/material/revision`：
   - `assertion_attribution` 默认 **`ai_proposed`**（AI 产出的候选，初始归属只能是 AI 提出）
   - `source_ref` = 该消息的 **event_id**（候选可逐级追溯回采集事件）
   - `candidate_sha256` 由 companion 服务端计算，Surface 原样展示
4. **四态迁移**：`ai_proposed → user_tentative → user_confirmed → reality_verified`，只前进、可跳级；倒退被 companion 400 拒绝，Surface **如实**显示拒绝原因全文，并提示"该拒绝已作为 `material.attribution.transition_rejected` 事件入库"（事件链里红色行可见）。
5. **GitHub 同步**：三按钮——
   - **先 pull 后 push（推荐）**：pull 建同步基点，pull 失败即停不 push；
   - **仅 pull**（建基点/回流检测）；
   - **仅 push**（无基点将如实报冲突）。
   - 409 时冲突文本（diff3 标记逐字）**全量**渲染在 `conflictPre`，绝不截断、绝不自动覆盖，附 `conflict_event_id` 供人工决策。
   - 503（gh 不可用）如实显示 local-only，其余功能不受影响。
6. **导出**：`/rpc/export`（可指定 output_dir）→ README.md + materials.md + events.jsonl 三件套。

## 3. 设计决定与如实说明

### 3.1 「一律先 pull」使三向合并退化（如实记录）
#13 定的最保守同步路线是"push 前一律先 pull 建基点"。其推论：push 时 base ≈ ours（用户正本刚拉下来），`git merge-file --diff3` 几乎总是干净合并 → 候选直录 `dcf/candidates` 分支。**冲突只存在于两个窗口**：
- pull 与 push 之间远端正本被并发修改（竞态窗口）；
- 无基点直接 push（本页保留「仅 push」按钮，属于用户手动决策路径）。

因此组合按钮（先 pull 后 push）在正常使用下不会出 409；本次验收的 409 证据即用「仅 push（无基点）」真实制造，非 mock。

### 3.2 其他决定
- **独立页而非在 g2 生长**：g2-dashboard 是"对话回看"，g3 是"材料代谢"，职责不同；只留互链。
- **`?companion=` URL 参数**：覆盖默认 `http://127.0.0.1:8472`，供验收脚本把同一页面指向 local-only companion（18475）做 503 取证；默认使用者无感。
- **rpc() 不 throw 非 2xx**：返回 `{ok, status, result, failure}`，把 400/409/503 当作要**如实呈现**的一等结果而非异常。
- **验收脚本用 `process.execPath` 启动 companion**：503 场景需剥离 PATH 中的 gh（`PATH=/usr/bin:/bin`），但 node 本身也在 /opt/homebrew/bin，用绝对路径避免 `spawn node ENOENT`。

## 4. 验证结果

### 4.1 HTTP 级单测 — `seed/tests/g3-adapter-flow.test.js`
临时 companion（`--port=18474 --db=<tmp> --dcf-dir=<tmp>`，不碰 ~/.dcf）。**31 passed, 0 failed**。覆盖：批量入库（适配器信封原样）→ 只提取 assistant → 标记默认 ai_proposed + source_ref=event_id + 服务端 sha256 一致 → 缺四态 400 → 单实体/全量投影 → 跳级前进 → 倒退 400 + transition_rejected 入库 + stale from_state 拒绝 → 第二候选不倒退状态 → 发射模板 → `~/.dcf/companion.port` 前后快照一致（诚实性断言）。

### 4.2 真实行为验收 — `seed/tests/g3-surface.acceptance.mjs`
真实无头 Chrome（CDP 驱动，file:// 打开 g3-materials.html）+ 两个真实 companion（8472 全功能 / 18475 无 gh）+ 本地 bare git 仓模拟远端（main 上有用户正本 notes/topic.md）。**21 passed, 0 failed**。截图取证（`seed/docs/evidence/g3/`）：

| 截图 | 内容 |
|---|---|
| 01-mark-candidate.png | 搜索→选 assistant 回复→标记成功（entity_id/event_id/candidate_sha256/ai_proposed 全量回显） |
| 02-transition-confirmed.png | ai_proposed → user_confirmed 跳级前进，徽章与四态链条更新 |
| 03-regression-rejected.png | 倒退被拒：HTTP 400 原因全文 + 事件链红色 transition_rejected 行 |
| 04-launch-template.png | 发射 modal：修订指令模板 + 材料正文逐字 |
| 05-push-conflict-409.png | 仅 push 无基点 → 409：diff3 冲突全文（user-github / last-sync-base / dcf-candidate 三段可见）+ conflict_event_id |
| 06-pull-then-push.png | 推荐路径：pull 建基点后 push 成功 → branch=dcf/candidates |
| 07-export.png | 导出三件套 export_path + stats |
| 08-local-only-503.png | 18475（PATH 无 gh）pull → HTTP 503 · local-only 如实显示 |

脚本还在**远端仓库侧**核实（不只看 UI）：main 上用户正本逐字节未动；main 上不存在任何 DCF 产物；候选只在 `dcf/candidates` 分支可读。

### 4.3 全量门禁
见任务汇报；`seed/tests/` 全部 + `npm run test:chrome` + `npm run test:legacy` 全绿后本文档才落盘为最终版。

## 5. 遗留 unknown / 已知缺陷（只记录，不越界修）

1. **companion `rpcError()` 丢弃 data 参数**（`seed/companion/index.js`）：attribution 倒退 400 的响应缺 `error.data.rejected/rejection_event_id`（g3-companion-v0.md §3 文档声称有）。Surface 因此靠 `error.message` + 事件链查询呈现拒绝详情，功能不受损，但契约文档与实现不一致。**属 seed/companion/，本任务禁改，留给 #15/#16 裁决。**
2. **503 的可复现性依赖 gh 缺席**：本机 gh 已认证，验收用 `PATH=/usr/bin:/bin` 的第二 companion 实例真实制造 503；CI 环境若无 gh 则天然是 503 路径。
3. **409 在推荐路径下几乎不可达**（见 §3.1）：这是最保守同步路线的结构性推论，不是缺陷；但意味着 409 UI 的日常曝光率低，主要靠「仅 push」路径与竞态窗口触发。
4. **验收脚本崩溃残留风险**：若脚本在 spawn 阶段即抛未捕获异常，`finally` 清理可能不覆盖已起进程（本轮已遇一次：残留 8472 companion 导致复跑数据错乱）。当前脚本已修（`process.execPath`），复跑前仍建议 `lsof -i :8472` 自检。
