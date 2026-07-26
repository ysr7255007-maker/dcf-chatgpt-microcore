# G3 Companion v0 — 材料代谢与可迁移成果（companion 侧）

状态：已实现并验证（2026-07-26）。本文档是任务 #13 的证据文档与任务 #14（ChatGPT 适配器修订候选通路）的对接契约。

## 1. 设计决定

### 1.1 数据模型：append-only 事件 + 可重算投影

- 不破坏任何现有表。全部 G3 状态走 `raw_events` 新事件类型 + 投影表 `materials_projection`。
- 投影表可由 raw_events 全量重算（`CompanionDB.recomputeMaterialsProjection()`）。
- **重算 = 增量的构造性保证**：增量 ingest 路径与全量重算路径共用同一个纯 reducer
  （`seed/companion/materials.js` 的 `applyMaterialEvent` / `reduceMaterialEvents`），
  不是两套逻辑碰巧一致，而是同一段代码。一致性由单测断言（见 §4）。
- 事件在持久化**之前**统一补 `created_at`（events.js），使增量 reducer 与 DB 行观察到同一时间戳。

### 1.2 主张归属四态（assertion_attribution）

```
ai_proposed → user_tentative → user_confirmed → reality_verified
```

- 所有 `material.*` 事件 **必填** `assertion_attribution`，缺失或非法值 → ingest 拒绝（HTTP 400，错误信息逐字说明缺什么、合法值是什么）。
- 迁移只允许前进，允许跳级（如 ai_proposed → user_confirmed）。
- 倒退请求被拒绝，且拒绝本身作为独立事件 `material.attribution.transition_rejected` 入库——完整链条可审计。
- 迁移事件 `material.attribution.transitioned` 的 `from_state` 必须与当前投影一致，防止基于过期状态的迁移。

### 1.3 GitHub 同步：候选路径选择及理由

**决定：专用分支 `dcf/candidates` + 分支内目录 `dcf/candidates/<entity_id>.md`。**

理由（可逆性优先）：
1. **一次操作全量撤销**：`git push origin --delete dcf/candidates` 即可清除全部 DCF 产物，用户正本零残留（已真实验证，见 §5）。
2. **默认分支零污染**：候选永不落在用户默认分支上，用户浏览 main 时看不到任何 DCF 文件；PR/diff 工具可按需对比。
3. **目录再加一层隔离**：即使用户手工把候选分支合并进 main，DCF 产物也集中在 `dcf/candidates/` 一个目录下，可整目录删除。

同步语义：
- **用户编辑文件拥有正文**。DCF 只推「三向合并修订候选」，**永不直接覆盖用户正本**（任何分支上都不写用户的原路径文件）。
- 三向合并用系统 git 的 `git merge-file --diff3 -p`：base=上次同步点内容、ours=用户 GitHub 正本、theirs=DCF 修订候选。
- 干净合并 → 合并结果作为候选提交到 `dcf/candidates` 分支的 `dcf/candidates/<entity_id>.md`，并记录 `material.sync.pushed` 事件、推进同步点。
- 冲突 → **不推送**，标准 diff3 冲突标记文本逐字入库为 `material.sync.conflict_detected` 事件，HTTP 返回 409 附完整冲突文本，等用户决策。绝不自动覆盖。
- 首次 push（无同步基点）base 为空 → merge-file 必然报冲突 → 如实 409。正确流程是先 pull 建立同步点再 push。
- 回流：pull 时对比远端内容 sha256 与上次同步点，变更 → `material.sync.pulled_back` 事件入库（含 remote_content 全文），推进同步点。

### 1.4 gh CLI 包装与降级

- `seed/companion/github-sync.js` 用 `child_process.execFile`（argv 数组，无 shell 字符串拼接）包装 `gh` 与 `git`。
- 凭证仅存本地（gh keychain），不入浏览器、不入 DB、不入代码。
- `checkGhAuth()`：gh 不可用/未认证时如实报错；HTTP 层对非本地 remote 返回 503 `local-only mode`，同步功能显式 unavailable，不影响其余功能。
- 本地路径 remote（bare repo）不需要 gh，纯 git 即可——测试与降级路径由此覆盖。

### 1.5 导出：自解释 Markdown + JSONL

- 导出到 `~/.dcf/exports/<timestamp>/`（可用 `output_dir` 覆盖，测试用临时目录）。
- 每份导出三个文件：
  - `README.md`：内嵌 schema 说明（事件信封、5 种事件类型逐个说明、四态语义）、来路（provenance）、边界状态说明；
  - `materials.md`：人类可读，按 entity 分组的事件叙事 + 投影汇总表；
  - `events.jsonl`：机器可处理，**逐行自含** `event_type` + `schema_version`（g3-companion-v0）。
- **NOT_OBSERVE 零残留**：导出前过滤（source_id / payload.entity_id / `__boundary__` 三重判定）+ 写后全文件扫描复核；
  复核发现残留 → 删除整个导出目录并如实报错。四态枚举值等 schema 词汇不算残留（它们是文档词汇，不是内容）。

## 2. 事件类型契约（payload 字段逐项）

所有事件通过 `POST /rpc/events/ingest`（或专用端点）入库，`payload_json` 为对象。
所有 `material.*` 事件 payload **必含** `assertion_attribution`（四态之一），缺失 → 400。

### material.revision_candidate.created
| 字段 | 必填 | 说明 |
|---|---|---|
| entity_id | ✅ | 演化对象 EntityID（ULID） |
| base_sha256 | ✅（可 null） | 候选所基于的内容 sha256；无基线时为 null |
| candidate_sha256 | ✅ | 候选正文 sha256（服务端计算，不信任调用方） |
| candidate_body | ✅ | 候选正文全文 |
| source_ref | ✅ | 来路（如 `chat://chatgpt/<conversation>/<message>`） |
| assertion_attribution | ✅ | 四态之一 |

### material.continuation_point.created
| 字段 | 必填 | 说明 |
|---|---|---|
| entity_id | ✅ | 演化对象 |
| from_event_id | ✅ | 接续自哪个事件（event_id） |
| context_ref | ✅ | 上下文引用（如会话/消息定位） |
| assertion_attribution | ✅ | 四态之一 |

### material.attribution.transitioned
| 字段 | 必填 | 说明 |
|---|---|---|
| entity_id | ✅ | 演化对象 |
| target_ref | ✅ | 迁移对象引用（如 `material:<entity_id>`） |
| from_state | ✅ | 当前态（须与投影一致） |
| to_state | ✅ | 目标态（只能前进，可跳级） |
| evidence_ref | ⭕ | 证据引用 |
| assertion_attribution | ✅ | 四态之一 |

倒退请求会产生 `material.attribution.transition_rejected` 事件（字段同上 + `rejection_reason`），投影不变。

### material.sync.pushed / material.sync.pulled_back / material.sync.conflict_detected
| 字段 | 说明 |
|---|---|
| entity_id | 演化对象 |
| remote / file_path | 远端与文件路径 |
| pushed: candidate_path, branch, merged_sha256, commit_sha, base_sha256 | 推送事实 |
| pulled_back: remote_sha256, previous_sha256, remote_content | 回流事实（全文入库） |
| conflict_detected: conflict_text | diff3 冲突文本逐字入库 |
| assertion_attribution | 默认 `reality_verified`（同步是已发生的现实事实） |

## 3. HTTP 契约（供任务 #14 适配器对接，端口默认 8472）

### POST /rpc/material/revision
入：`{entity_id, candidate_body, source_ref, assertion_attribution, base_sha256?, source_id?}`
出 200：`{event_id, candidate_sha256}`；缺四态/非法 → 400，错误信息说明合法值。

### POST /rpc/material/attribution
入：`{entity_id, target_ref, from_state, to_state, evidence_ref?, source_id?}`
出 200：`{event_id, from_state, to_state}`；倒退/态不匹配 → 400（`error.data` 含 `rejected: true, rejection_event_id`——拒绝已入库）。

### GET /rpc/material/query[?entity_id=...]
单实体：`{projection, events}`（projection 含 latest_candidate_sha256/body、attribution_state、continuation_points_json、source_ref）；
全量：`{projections, event_count}`。

### POST /rpc/sync/github/push
入：`{remote, entity_id, file_path, candidate_body?, default_branch?}`（candidate_body 缺省取投影 latest_candidate_body）
出 200：`{pushed: true, candidate_path, branch, merged_sha256, commit_sha, sync_event_id}`
冲突 409：`error.data = {conflict_text, conflict_event_id}`；gh 不可用且非本地 remote → 503 local-only。

### POST /rpc/sync/github/pull
入：`{remote, entity_id, file_path, default_branch?}`
出 200：`{changed, exists, remote_sha256, last_sync_sha256, pull_event_id?}`（changed=true 时有 pull_event_id）。

### GET/POST /rpc/export
入（可选）：`{output_dir}`；出 200：`{export_path, stats: {eventCount, projectionCount, notObserveFiltered}}`；无可导出内容 → 400。

## 4. 验证输出摘录

单测（零依赖 node 直跑）：
```
node seed/tests/g3-material.unit.test.js  → 📊 Results: 26 passed, 0 failed
node seed/tests/g3-sync.test.js           → 📊 Results: 26 passed, 0 failed
node seed/tests/g3-export.test.js         → 📊 Results: 27 passed, 0 failed
```

覆盖：四态必填与非法值拒绝、倒退拒绝+记录+投影不变、跳级前进、候选不覆盖既有事件（append-only）、
**重算=增量一致性**（同一事件流分别走增量与 recompute，逐字段一致）、本地 bare repo 三向合并
干净/冲突两路径、冲突文本逐字入库、回流 sha256 检测入库、删候选分支后零 DCF 残留、
导出三件套自解释完整、JSONL 逐行自含、NOT_OBSERVE 零残留（内容+ID 双重断言）、
残留复核会删除违规导出、全被过滤时如实拒绝导出。

HTTP 冒烟（端口 18473 + /tmp 临时 DB，已清理）：
```
revision 缺 assertion_attribution → 400 "missing required field: assertion_attribution (must be one of ...)"
revision 合法                     → 200 {event_id, candidate_sha256}
attribution ai_proposed→user_confirmed（跳级）→ 200
attribution user_confirmed→ai_proposed（倒退）→ 400 "Allowed: reality_verified"；
  query 显示 material.attribution.transition_rejected 已入库
push（无同步基点）→ 409 冲突如实 + conflict_event_id
pull → 200 建立同步点；再 push → 200 {branch: "dcf/candidates", candidate_path: "dcf/candidates/<entity>.md"}
远端核实：main 正本逐字节未动，候选只在 dcf/candidates 分支
用户远端编辑后 pull → 200 {changed: true, pull_event_id}
export → 200 三件套齐全
```

## 5. GitHub 真实网络路径验证（已验证 ✅）

本机 gh 已认证（keychain）。创建测试私库 `ysr7255007-maker/dcf-g3-sync-smoke` 完成真实冒烟：
- 真实 pull 建立同步点 → 真实 push 干净合并 → GitHub API 核实：
  - `main:notes.md` 与用户提交逐字节一致（正本未动）；
  - `main` 上无 `dcf/` 目录（404）；
  - 候选文件只存在于 `dcf/candidates` 分支。
- 可逆性真实验证：`git push origin --delete dcf/candidates` 成功，DCF 产物一次清除。

**残留说明（如实）**：测试私库本体无法删除——当前 gh token 无 `delete_repo` scope
（删除需用户执行 `gh auth refresh -h github.com -s delete_repo` 后 `gh repo delete ysr7255007-maker/dcf-g3-sync-smoke --yes`）。
库内已清空候选分支，仅剩 main 上一个 notes.md 测试文件。

## 6. 遗留 unknown

1. **测试私库残留**：如上，需用户补 scope 后自行删除（或留作后续同步测试靶）。
2. **GitHubSync 的 git 凭证依赖系统配置**：companion 内部 git push 依赖本机 git 的 credential helper
   （本机为 gh 配置的 keychain helper，已真实验证可用）；若换机器且未跑 `gh auth setup-git`，https push 会失败——届时错误如实透传。
3. **首次 push 语义**：无同步基点时如实报冲突（base 为空）。适配器侧（#14）应遵循「先 pull 后 push」次序；是否要为「远端文件不存在」的全新文件路径提供免合并直推候选，留给 #14 按真实需求决定。
4. **投影表并发**：DatabaseSync 是同步 API，单进程内无并发问题；多 companion 实例同时写同一 DB 未在范围内。
5. **node:sqlite 实验特性警告**：stderr 有 ExperimentalWarning，属已知现状（G1 起如此），不影响功能。
