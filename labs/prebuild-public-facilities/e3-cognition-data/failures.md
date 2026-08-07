# E3 失败路径与坑清单

## F1 — Lance FTS 对中文零召回（分词缺口）

- 现象：LanceDB 内置 FTS（tantivy 默认分词器）对中文语料 Recall@5 = 0；
  混合检索实际上由 dense 单路撑起。
- 佐证：SQLite 侧用 LIKE 精确短语仍可命中（不依赖分词）。
- 结论：中文词法基线必须有分词器（与总规范一致：中文分词器选型推迟到 P4，
  由真实个人叙事材料决定）。本轮不因此否定 SQLite+LanceDB 分层，
  但"全文查询"这一项在中文语境当前只能按精确/短语计，FTS 名义不算成立。

## F2 — 删除目录后旧连接句柄悬空（lance Not found）

- 现象：文件系统级 rm 派生目录后，仍持有旧连接的实例继续查询 →
  `lance error: Not found ... .lance` 原生错误。
- 解决：区分两种删除路径——同连接表级 `destroy()`（主路径）与
  文件系统级删除 + 新连接重建（T4 变体，已证明可行）。
- 教训：派生世界的"删除"必须与连接生命周期一同管理；
  正式实现应把 derived handle 与 build-manifest 一起纳入 World 的恢复语义。

## F3 — 进程退出期 trace trap（lancedb + onnxruntime 原生层 teardown）

- 现象：两次全量复跑全部断言完成后，进程退出时出现 `trace trap`
  （Bun 1.3.14 + @lancedb/lancedb@0.33.0 + onnxruntime-node@1.21.0 组合）。
- 影响：测试结果与证据文件均已完成写入；崩溃只发生在 teardown。
- 结论：作为已知的嵌入式原生组合缺陷登记；正式实现需要显式 dispose 顺序
  （先 lancedb 后 onnx，或进程隔离），不能把该组合直接当成长驻宿主进程的一部分。

## F4 — dense 真值集有一条稳定未命中（q1：Composer LOC 预算）

- 现象：Recall@5 = 7/8；q1 的数字型问答（"LOC 预算是多少"）dense 未进前 5。
- 分析：答案位于 ADR 表格/短句中，600 字固定 chunk 将其与大量架构叙述混排，
  embedding 区分度不足；这正是 hybrid/lexical 通道应补足的场景（受 F1 限制未生效）。
- 教训：检索真值集必须包含数字/表格型问题；分词器到位后应重测 hybrid。

## F5 — HF Hub 直连不可达

- 现象：模型下载 ECONNRESET；经 hf-mirror.com 成功。
- 处理：HF_ENDPOINT 作为环境事实登记（environment.json）；模型产物缓存在本机，
  复跑不再依赖网络。

## F6 — 7.6 AI 改写未显示检索增益（小样本）

- 现象：3 span 样本上，semantic（零增量）与 ai-self-contained（×3.69 体积 + 生成成本）
  Recall/MRR 相同；术语保留率均为 1.0（无事实丢失证据，但也无增益证据）。
- 结论：不允许晋级正式机制；样本过小且 LLM judge 未引入（纪律），
  记 SELF_CONTAINED_CHUNKS_EXPERIMENTAL，待真实查询集扩大后再裁。
