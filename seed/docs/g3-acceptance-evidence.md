# G3 验收证据 — 红线回归 + 真实登录态端到端取证（任务 #15）

- 验收人：James（任务 #15，blocks #16）
- 日期：2026-07-26
- 仓库状态：main @0c21309，工作区含全部未提交 G3 成果（本验收不 commit/push，不修 seed/ 产品代码）
- 验收环境：macOS（darwin 26.5.2）、系统 node、零 npm 依赖；专用验收 DB `/tmp/dcf-g3-accept.db`（未触碰 `~/.dcf/dcf.db`）

## 结论：G3 验收门 **通过**

- A 全量红线与测试回归：**全绿**（9 测试套件 + test:chrome + test:legacy + 三红线复检 23/23）。
- B 真实登录态端到端：**走通**——发射入真实 ChatGPT 会话 → 真实回复 → 按 content.js 契约采集入库 →
  Surface 标记 ai_proposed → 四态迁移 user_tentative → GitHub 同步（pull→push 干净路径）→ 导出，
  全程截图 + 远端/导出物实物抽查一致。
- 发现 1 个**非阻塞**缺陷（boundary 自定义 scope 门禁盲区，见 §4），不影响契约声明的规范路径；
  三条 G1 红线在规范路径下全部守住。

---

## A. 全量红线与测试回归

### A1 测试逐项结果（全部 exit 0）

| 套件 | 结果 |
|------|------|
| seed/tests/companion-doctor.unit.test.js | 15 passed, 0 failed |
| seed/tests/companion-v0.unit.test.js | All tests passed |
| seed/tests/g1-redline.test.js | 34 passed, 0 failed |
| seed/tests/g2-reconnect.acceptance.mjs | 5 passed, 0 failed |
| seed/tests/g3-material.unit.test.js | 26 passed, 0 failed |
| seed/tests/g3-sync.test.js | 26 passed, 0 failed |
| seed/tests/g3-export.test.js | 27 passed, 0 failed |
| seed/tests/g3-adapter-flow.test.js | 33 passed, 0 failed |
| seed/tests/g3-surface.acceptance.mjs | 21 passed, 0 failed |
| npm run test:chrome（13 个 chrome-* 套件） | exit 0，全绿 |
| npm run test:legacy（23 个 dcf-* 套件） | exit 0，全绿 |

如实记录一则**验收环境自扰**（非产品缺陷）：验收 companion 占用 8472 端口期间复跑
companion-doctor（Test 6 fresh-start 流程）与 g2-reconnect（要求 companion 可被停掉）各出现 1 处失败；
停掉验收实例后复跑即全绿（上表为无占用环境下的结果）。结论：这两个套件对 8472 端口占用敏感，
跑测试前应确保端口干净（g3-adapter-v0.md 遗留 unknown #4 已有同类提醒）。

### A2 G1 三红线 G3 语境复检（脚本 23/23 全过 + 实物抽查）

复检脚本：临时 companion @18476 + mkdtemp 隔离目录（DB / dcf-dir / export-out / log / 本地 bare repo），
运行日志留存于验收过程（summary：`23 passed, 0 failed`）。

**① 内容零残留（NOT_OBSERVE）**
- 对规范 scope（`OBSERVE_CURRENT_ONLY:<sourceId>` 缺省键）的 NOT_OBSERVE 目标：
  含哨兵字符串（随机 UUID 加盐）的事件 ingest 被 400 拒绝，正文未入库。
- DB 文件字节级扫描：哨兵零出现。
- 实际导出物（materials.md / events.jsonl / README.md）逐文件扫描：哨兵零出现。
- companion 日志扫描：哨兵零出现。
- 另验证导出侧 fail-closed 防线：预先污染投影中混入哨兵时，导出的写盘后残留复核会删除导出目录并报错
  （宁可不导出，不可残留）。

**② 修订候选永不覆盖正本**
- 真实 bare repo：`git show main:<正本>` 与推送前 sha256 逐字节一致；
- 候选只出现在 `dcf/candidates` 分支（`git ls-tree` 抽查），main 上无任何 DCF 产物。

**③ 四态倒退拒绝且拒绝入链（含 #17 error.data 断言）**
- 前进迁移 ai_proposed → user_tentative 接受；
- 倒退 user_tentative → ai_proposed 返回 400；
- `error.data.rejected === true` 且 `error.data.rejection_event_id` 存在（#17 修复已生效）；
- rejection_event_id 与事件链中的 `material.attribution.transition_rejected` 事件精确匹配；
- 投影状态未被倒退请求改变。

---

## B. 真实登录态端到端取证（BrowserClaw）

### B0 MCP 直连

- 零依赖 Node 客户端（MCP Streamable HTTP，protocolVersion 2025-03-26）直连 `http://127.0.0.1:9010/mcp`：
  initialize → `mcp-session-id` 响应头 → notifications/initialized → tools/list → tools/call（SSE data: 行解析）。
- 握手成功：BrowserClaw 0.0.15，17 个工具。
- 如实记录两条运行时约束：
  1. **session 存活期很短**，中途多次 404 失效，需重新 initialize；
  2. **标签所有权护栏**：新 session 无法操作（含关闭）旧 session 打开的标签
     （"page N is not owned by this agent"），与 G1 验收（Robin）遭遇一致。
     因此流程中同一页面被不同 session 重复打开过（Surface、ChatGPT 会话各出现两个标签）。

### B1 验收 companion 与材料注入

- `node seed/companion/index.js --port=8472 --db=/tmp/dcf-g3-accept.db --dcf-dir=/tmp/dcf-g3-accept-dcfdir`。
- 经 `/rpc/events/ingest` 注入一份小材料实体作为待发射材料（**如实标注为验收注入**）：
  - entity_id `01KYEVGA3GN8V03SHQ4YD8WNDR`，注入事件 `01KYEVGA3GNRC6GYDAF14225RB`，
    source_ref `accept://g3-acceptance/injected-by-task-15`，初始归属 ai_proposed。

### B2 Surface 发射

- BrowserClaw 打开 `file:///Users/looy/Documents/dcf/seed/surface/g3-materials.html`（file:// 未被拒绝）。
- 选中材料 → 发射 modal → 取得发射文案（310 字符，含修订指令模板）。
- 截图：`evidence/g3-acceptance/01-surface-launch-modal.png`。
- 剪贴板后台写入**意外成功**（原预期后台受限），但后续粘贴步骤仍改用页内填充（见等价性声明）。

### B3 真实 ChatGPT 会话发送与真实回复

- BrowserClaw 打开 chatgpt.com，**真实登录态**（账号"李隐 Plus"侧栏可见）。
- 会话：`/c/6a65d17d-9204-83e8-bd46-9f6323b3457a`。
- 如实记录一次失误：`act` fill 遇文案**首个换行即触发发送**，只发出了标题行「【DCF 修订请求】」（10 字符），
  ChatGPT 对此标题产生了一条 106 字符的追问回复——这两条消息留在会话中，一并被采集入库（中性无害）。
- 改用页内 `document.execCommand('insertText')` 填入完整 310 字符文案（不触发提交），
  点击 `[data-testid=send-button]` 发送成功。
- **真实回复**：assistant 消息 `c74b2dac…`，113 字符，内容为对注入材料的精炼修订。
- 截图：`evidence/g3-acceptance/02-chatgpt-real-reply.png`。

### B4 按 content.js 契约采集 + 投递

- 页内 evaluate 逐行复刻 content.js 契约：`[data-message-author-role]` 选择器、role∈{user,assistant} 过滤、
  `data-message-id`、`textContent.trim()`、eventType（user→conversation.message.sent /
  assistant→conversation.message.received）、`observation_key = messageId + ':' + eventType`、
  payload {role, message_id, text, conversation_path, observed_at}。
- 稳定 ID 复刻 ulid.js `stableIdFromString`（SHA-256 → 26×5bit Crockford Base32）：
  `source_id = stableId('dcf.source:' + host+pathname)` = `0SA2D5XV2YGRAZYWDAYBZR04PT`；
  `event_id = stableId('dcf.event:' + sourceId + ':' + observationKey)`。
- 采集 4 条消息（页内 CSP 禁 fetch 127.0.0.1，数据取回后由 Node 脚本以 service-worker 等价角色
  POST `/rpc/events/batch`，body 形状与 outbox-core.js flush 相同 `{events, id}`）：

| seq | event_type | event_id | 消息 | 字符数 |
|-----|-----------|----------|------|--------|
| 1 | conversation.message.sent | 1VHJQC6YENPQNJDDNXT7STF37X | user a31fd4c2（误发标题） | 10 |
| 2 | conversation.message.received | 6MHVSGGQTW6Q6PHXGNZQN69DHR | assistant 27e99e12（对标题的追问） | 106 |
| 3 | conversation.message.sent | 3MNWWEGTA4B1CKNMB4SBKK6KAW | user 4a65488f（完整发射文案） | 314 |
| 4 | conversation.message.received | ZBT131P9SJTW45EW2W00SFH8G4 | **assistant c74b2dac（真实修订回复）** | 113 |

- 首投：`{"inserted":4,"total":4,"duplicated":0}`；**幂等复投**：`{"inserted":0,"total":4,"duplicated":4}`
  ——companion 确定性 event_id 吸收重复交付，契约成立。

### B5 Surface 标记 → 四态迁移 → GitHub 同步 → 导出（全部走真实 UI 路径）

在自有 Surface 标签上通过真实 DOM 事件驱动页面按钮（搜索/单选/下拉/点击），非直接调 RPC：

1. **标记修订候选**：FTS5 搜索命中真实回复 → radio 选中 `ZBT131P9SJTW45EW2W00SFH8G4` →
   目标实体 `01KYEVGA3GN8V03SHQ4YD8WNDR` → 标记成功：
   revision 事件 `01KYEZMX95N2NARHE4FKEDT28M`，candidate_sha256 `de38d234…e281847`，
   source_ref=该消息 event_id，assertion_attribution=ai_proposed。
   截图：`03-surface-marked-ai-proposed.png`。
2. **四态迁移一步**：ai_proposed → user_tentative 成功（事件 `01KYEZNX0XX1F705ZSFR7BT4HQ`，
   evidence_ref=`accept://g3-acceptance/task-15-user-review`）。徽章与四态链条正确更新。
   截图：`04-surface-transition-user-tentative.png`。
3. **GitHub 同步（先 pull 后 push，本地 bare repo 做远端）**：
   - pull：exists=true, changed=true（回流入库，事件 `01KYEZPH9APGNWP4PK3318QY1S`）；
   - push：branch=dcf/candidates，candidate_path=`dcf/candidates/01KYEVGA3GN8V03SHQ4YD8WNDR.md`
     （事件 `01KYEZPHFNC1YAE29Y8EN0VD4D`，commit 0a0a752e）。
   - **远端实物抽查**：`git show main:notes/accept-topic.md` sha256 = 推送前正本
     `2f9d7dd8…d8ef24b` 逐字节一致（红线②）；main 树上无任何 DCF 产物；
     候选只在 dcf/candidates 分支，内容=真实 ChatGPT 回复，sha256 与标记时的
     candidate_sha256 `de38d234…` 完全一致。
   - 截图：`05-surface-github-sync.png`。
   - 真实网络路径（GitHub 私库 + gh 凭证）不在本次重建：**#13 已真实验证**
     （见 g3-companion-v0.md §5 冒烟证据：私库 dcf-g3-sync-smoke pull→push 走通），此处引用。
4. **导出**：`/tmp/dcf-g3-accept-export/2026-07-26T10-32-44-072Z/`（README.md + materials.md + events.jsonl），
   5 个材料事件（注入 revision → 标记 revision → transitioned → pulled_back → pushed）与投影
   （user_tentative / de38d234）与 DB 内事件链**首尾一致**；NOT_OBSERVE 过滤 0（本会话为默认边界，符合预期）。
   截图：`06-surface-export.png`。

最终 companion 状态：event_count=9（1 注入 + 4 会话采集 + 1 标记 + 1 迁移 + 2 同步），与全流程精确对账。

### 等价性声明（如实）

1. **粘贴 → 页内 insertText**：剪贴板后台写入实际成功，但跨进程"粘贴"动作无法由 MCP 模拟；
   改用 `document.execCommand('insertText')` 将同一文案全文填入 ChatGPT 输入框后点真实发送按钮。
   等价性：进入输入框的文本与发射 modal 文案逐字符一致（发送后采集回的 user 消息 314 字符 =
   310 字符文案 + 编辑器结构性空白），发送动作是页面真实按钮。
2. **content script → 页内 evaluate**：采集逻辑为 content.js 的逐行复刻（同选择器、同过滤、同
   observation_key、同 stableId 算法），并经幂等复投验证 event_id 确定性；真实扩展本体的采集闭环
   已由 #12（Robin）在真实登录态下独立取证，本次不重复。
3. **service worker → Node 脚本投递**：chatgpt.com 页内 CSP 禁 fetch 127.0.0.1（这正是 SW 存在的
   架构理由），Node 脚本以相同 body 形状调用相同端点，投递语义等价。
4. **GitHub 远端 → 本地 bare repo**：companion 的 git 操作路径（clone/merge-file --diff3/push）对
   本地 bare 与 https 远端一致，差异仅在凭证层；真实网络路径引用 #13 证据。

### 截图清单（seed/docs/evidence/g3-acceptance/）

| 文件 | 内容 |
|------|------|
| 01-surface-launch-modal.png | Surface 发射 modal（含修订指令模板文案） |
| 02-chatgpt-real-reply.png | 真实登录态 ChatGPT 会话中的真实修订回复 |
| 03-surface-marked-ai-proposed.png | 真实回复被标记为修订候选（ai_proposed） |
| 04-surface-transition-user-tentative.png | 四态迁移一步后（user_tentative） |
| 05-surface-github-sync.png | pull→push 干净路径结果 |
| 06-surface-export.png | 导出完成（5 事件 / 1 投影 / NOT_OBSERVE 过滤 0） |

---

## 4. 本次验收发现的缺陷（非阻塞，留 Leader 裁决）

**boundary 自定义 scope 的入库门禁盲区**（seed/companion/，验收纪律禁改）：
- `/rpc/boundary/update` 接受任意 `scope` 字符串（缺省才落到规范键 `OBSERVE_CURRENT_ONLY:<source_id>`）；
- 但入库门禁（events.js `getBoundaryState`）**只查规范 scope 键**——对自定义 scope 声明的 NOT_OBSERVE，
  含正文的事件 ingest 返回 HTTP 200 正常入库（A2 探针实测）；
- 而导出侧 `getNotObserveSourceIds` **忽略 scope** 仍会过滤该源——两道门禁语义不一致。
- 影响评估：规范路径（Surface/适配器均不传自定义 scope）不受影响，三红线在规范路径下全部守住；
  但契约上"NOT_OBSERVE ⇒ 内容零残留"在自定义 scope 下只剩导出侧一道防线（DB 内已有残留）。
- 建议方向（供裁决，非本任务实施）：boundary/update 拒绝非规范 scope，或入库门禁改为忽略 scope 匹配 source_id。

## 5. 遗留 unknown 汇总（含 #13/#14 已记录项最新状态）

| # | 来源 | 项 | 最新状态 |
|---|------|----|---------|
| 1 | #13 | 测试私库 dcf-g3-sync-smoke 残留（gh token 无 delete_repo scope） | 未变，待用户补 scope 后删除 |
| 2 | #13 | GitHubSync 凭证依赖本机 git credential helper | 未变，换机器需 `gh auth setup-git` |
| 3 | #13 | 首次 push（无基点）如实报冲突的语义 | 本次验证「先 pull 后 push」推荐路径干净走通，维持现状 |
| 4 | #13 | 多 companion 实例并发写同一 DB 不在范围 | 未变 |
| 5 | #13 | node:sqlite ExperimentalWarning | 未变，不影响功能 |
| 6 | #14 | rpcError() 丢弃 data 参数 | **已由 #17 修复**，A2 断言 error.data.rejected/rejection_event_id 通过，可销项 |
| 7 | #14 | 503 可复现性依赖 gh 缺席 | 未变 |
| 8 | #14 | 409 在推荐路径下几乎不可达 | 未变（结构性推论，非缺陷） |
| 9 | #14 | 8472 端口残留导致测试自扰 | 本次再次实证（doctor/g2-reconnect 对端口占用敏感），建议跑测试前 `lsof -i :8472` 自检 |
| 10 | #15/#18 | boundary 自定义 scope 门禁盲区 | **已由 #18 修复**：事件入库门改为按 source_id 匹配 ALL scope rows（最严格者胜），与导出侧 gate 语义对齐；#18 汇报详述修复方向与回归断言 |
| 11 | #15 新增 | BrowserClaw MCP session 短存活 + 标签所有权护栏 | 运行时约束如实记录；session 失效后其标签无法由任何后续 session 接管关闭，本次验收共 5 个标签（Surface×2、ChatGPT 会话×3）留在用户浏览器中，需用户手动关闭 |

## 6. 验收清理记录

- companion（8472）进程已停止；专用 DB / dcf-dir / 导出目录 / bare repo 等 /tmp 临时物已删除；
- 工作区临时脚本目录 `.tmp-g3-accept/` 已删除；A2 复检 mkdtemp 目录已删除；
- BrowserClaw：已尝试关闭全部 5 个验收标签，均被所有权护栏拒绝（开标签的 session 已失效，后续 session 无接管权），如实记录，需用户手动关闭；
- `~/.dcf/dcf.db` 全程未触碰；未 commit/push；未修改 seed/ 产品代码。
