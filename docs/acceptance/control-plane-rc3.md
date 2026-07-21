# DCF rc.3 控制平面候选验收记录

Updated: 2026-07-21  
Parent problem-evidence commit: `d67d070491f9997bc940735be2506f104a912082`  
Branch: `rebuild/chrome-native-host-v2`  
Candidate: `1.0.0-rc.3`

## Claim boundary

本记录只覆盖控制平面第一条垂直闭环：内容寻址 CodeUnit、DesiredSnapshot、Canary 最低证明、Current/LKG 提交、Stable 分离、注册与页面迁移调和、发布身份门禁。

它不宣称 S6 RESULT、F2f WorkspaceBinding、权限生命周期或完整 Issue #70 已通过。

## Evidence matrix

| capability | status | evidence | remaining boundary |
|---|---|---|---|
| v2 → v3 state migration | behavior_passed | Node 状态迁移测试：旧 Current/LKG 保留，旧 candidate 丢弃 | 真实浏览器存量状态迁移未测 |
| content-addressed CodeUnit | behavior_passed | 同语义版本不同 hash 可作为历史工件并存，Snapshot 精确选 hash | Chrome storage 规模与长期回收未测 |
| durable semantic-version ledger | behavior_passed | 发布 ledger 拒绝已发布 `id@version` 新内容；shell.9 旧冲突保留为历史证据 | GitHub Actions 全构建待跑 |
| persistent Desired | behavior_passed | 重复声明与重复 Reconcile 幂等测试 | Service Worker 真实重启待测 |
| dedicated Canary isolation | behavior_passed | 合成 Chrome 生命周期测试证明非 ChatGPT 标签不参与；实现不回退到用户页面 | 真实 Chrome 创建/关闭 Canary 待测 |
| minimum loaded proof | behavior_passed | 精确 hash `userScripts.execute` 成功记录 loaded；必要执行失败不提交 | 真实插件异步 ready/degraded 观察待测 |
| Current/LKG atomic commit | behavior_passed | 全 proof 满足后一次提交；失败保留旧 Current/LKG | 真实 storage/Worker 事务待测 |
| Stable separation | behavior_passed | Canary 提交不推进 Stable；提升入口要求 acceptance reference + claim scope | 首次真实行为验收后才允许提升 |
| post-commit registration reconcile | implemented_unverified | 与 Committed Current 独立调和，失败只记 Observed | 真实 userScripts permission/registration 待测 |
| page migration does not rollback | behavior_passed | 合成迁移失败测试确认 Current/LKG 不变；disable 标记 reload_required | 多标签页真实热迁移待测 |
| Activation/Reconcile records | behavior_passed | 状态测试验证结构化记录与统一事件存在 | Issue/矩阵自动投影尚未实现 |
| S6 durable RESULT | blocked | 旧 dialogue outbox 线冻结 | 下一垂直闭环：Artifact + ConversationBinding |
| F2f WorkspaceBinding | failed | 旧 session 实际位于 `/Users/looy` | 下一垂直闭环：显式 WorkspaceBinding 双重验证 |

## Promotion rule

`Current` 和 `LKG` 可以由 Canary 最低证明推进；`Stable` 不得因源码、CI、构建或 loaded 证明自动推进。只有真实浏览器行为验收生成明确 evidence reference 与 claim scope 后，才可调用显式 Stable promotion。
