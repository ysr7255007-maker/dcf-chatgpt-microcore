# DCF Current State

Updated: 2026-08-05

## 1. 当前事实源顺序

当前实现与研究按以下权威顺序读取：

1. `docs/spec/2026-08-04-DCF-当前实施规范.md`：DCF 概念与实施硬约束；
2. `docs/spec/2026-08-05-DCF-macOS-AI实验宿主规范.md`：macOS 宿主专项约束；
3. 本文件：当前运行证据、阶段与正在推进的任务；
4. `docs/adr/`：历史推演与后续裁决；
5. 旧 vision / blueprint / README 历史内容：只作演化背景，不得重新取得实施权威。

此前 2026-07-26 的 `seed / G1～G7 / Chrome rc.3` 描述已从“当前路线”降为历史实现状态。旧代码和证据继续保留，不删除。

---

## 2. 当前 DCF 定义

DCF 是长期个人认知基础设施。

当前最小完整闭环：

```text
真实交互
↓
留下足够重新进入当时语境的记录
↓
AI 形成当前关系叙事
↓
用户回看、补充、纠正
↓
新的认知记录进入历史
↓
后续现实继续出现
↓
旧理解被强化、补漏、修正或重新解释
↓
认知变化只追加，不覆盖
```

当前核心分工：

```text
记录负责唤醒
AI 负责起草
用户负责校准
时间负责纠错
```

原件可以逐步代谢；长期真正不可丢的是认知记录、关系、关系变化以及足够的来源锚点。

---

## 3. macOS 专用 AI 宿主：能力开放已完成

用户提供的 2026-08-05 本地独立复核报告状态：`behavior_passed`。

正常 macOS 重启后同时成立：

| 能力 | 当前状态 |
| --- | --- |
| SIP | disabled |
| Security Mode | Permissive |
| custom kernel / BootKC 能力入口 | enabled；当前无 custom KC |
| third-party kext / AuxKC 能力入口 | enabled；当前无第三方 kext |
| CTRR enforcement | disabled |
| boot-args filtering | disabled；当前 `boot-args` 为空 |
| SSV / authenticated-root | disabled |
| Research Guests | enabled |
| FileVault | Off |

系统本体当前没有因为“开门”而形成新的长期维护对象：

```text
无第三方 kext
无 custom kernel
无 custom BootKC
无系统卷 patch
无 framework / daemon / Apple binary patch
无实验 boot-args
无 custom SSV snapshot
```

结论：

> **机器能力层的主要权限变量已经消除；后续实验失败不得默认继续归因为 SIP / SSV / CTRR 等保护策略。**

Recovery 证据由本地任务保存在 `~/dcf-ai-host-setup/evidence/recovery-open/` 与 Data 卷 `dcf-recovery-open/`。该证据尚未由本次文档整理复制进仓库，因此这里只记录用户提供的运行结论与证据位置，不伪装成仓库内已有字节级证据。

---

## 4. 当前阶段：macOS 原生公共能力黑洞勘探

当前不再以“还能 hack 多深”为目标。

正在回答：

> **如果今天重新从零设计 DCF 的 macOS 底座，哪些现实问题根本不应该由 DCF 自己解决？**

研究任务：

- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探任务书.md`
- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探执行计划.md`

阶段 ADR：

- `docs/adr/2026-08-05-macos-native-public-capability-blackhole-exploration.md`

研究方法：

```text
Role Discovery
→ Leverage Discovery
→ 组合架构
→ Runtime Proof
→ Architecture Promotion
```

候选最终只能被定位为：

```text
A 正式公共底座
B 辅助公共能力
C 探真 / 研究仪器
D App / 来源专用适配
E 淘汰
unverified 尚未验证
```

---

## 5. Plan 模式完成后的本机先验

本地 AI 在任务书允许范围内已经完成一次只读 Plan 勘探，并报告以下先验。它们是下一轮实验起点，不等于最终架构定案。

### 已报告为 observed / runtime_verified

- macOS 26.5.2 (25F84)；
- `com.dcfprobe.logging-imk-private` 已系统级安装；
- InputMethodKit `insertText` / `setMarkedText` 明文在 TextEdit / ChatGPT、打字 / Fn 语音路径已有成功证据；
- `eslogger` 可用并可观察多类 Endpoint Security 事件；
- Data 卷存在持久 FSEvents 历史；
- Spotlight 索引开启；
- CoreDuet / KnowledgeC 中发现 `/app/usage`、`/display/isBacklit` 等活动分段。

这些结论仍需按执行计划把原始输出、环境、复现命令和资源测量正式落入 `experiment/macos-blackhole-probe/`，再进入仓库证据层。

### 新增高杠杆候选

`KnowledgeC / CoreDuet` 被加入活动时间骨架候选池。

当前只允许把它视为：

> **可能补足 NSWorkspace 实时通知、提供系统已经保存的活动历史的高杠杆候选。**

不得在验证 schema 稳定性、保留窗口、访问成本和跨版本依赖前升格为正式事实底座。

### Endpoint Security 的双重问题

必须分开回答：

1. **系统能力是否成立**：ES 是否真实提供跨 Agent 的机器动作 / Effect 事实面；
2. **DCF 是否能长期稳定消费**：正式客户端 entitlement、分发、权限和维护依赖是否可接受。

`eslogger` 可以先证明第一问，不能自动证明第二问。

---

## 6. 当前主要实验

执行计划当前包含：

- E1：InputMethodKit 文字事实面的覆盖、日增量和长期成本；
- E2：FSEvents + Spotlight 文件世界；
- E3：KnowledgeC + NSWorkspace 活动时间骨架；
- E4：Endpoint Security / eslogger Agent 行动与 Effect 收据；
- E5：launchd + XPC 生命周期；
- E6：App Intents / Shortcuts / Apple Events 跨 App 行动；
- E7：Unified Logging 作为事实矿藏地图的低强度普查。

E1 的长窗口测量不得阻塞整个研究：启动长期采样后继续执行其他相互独立实验；最终只在需要 E1 长窗口证据的裁决上保持 `unverified`，不得用等待替代推进。

---

## 7. 当前既定架构倾向

这些是研究边界，不由本轮 Plan 重新投票：

- macOS 尽量负责它已经拥有的现实、索引、进程生命周期和系统动作面；
- DCF 自己拥有认知关系、语义任务和长期认知谱系；
- 长期持久世界与 Becsy / ECS 活动世界分离；
- 少数高自由度 AI 处理未知，大量已理解路径下沉为高级语义状态机与确定性执行；
- 成熟 Agent Runtime 与 DCF 自研执行核并存；
- 逻辑动作身份与物理执行分离；
- Effect Projection 是优化权限，不是外部工具接入门槛；
- 不知道 Effect 时保守执行，不去重、不合并、不跨未知因果边界重排；
- 探索可以很深，稳定运行路径必须尽量变薄。

---

## 8. 旧实现状态

Chrome `1.0.0-rc.3`、legacy `0.18.2`、`seed/`、Surface / Companion 以及此前 P0～G7 相关代码与证据继续保留。

它们现在属于：

```text
历史实现
可运行 / 可验证旧基线
架构经验来源
回退与证据材料
```

不得再把旧实现目录结构、旧插件组合、旧阶段名自动提升为当前 DCF 事实所有权。

旧控制平面的 `Desired → Observed → Committed → Reconcile`、Current/LKG/Stable 分离等经验仍可在真正需要对应问题时复用，但不会因为历史存在就自动进入新底座。

---

## 9. 证据纪律

统一使用：

```text
observed
hypothesized
implemented_unverified
runtime_verified
behavior_passed
failed
not_tested
```

任何候选：

```text
API 存在
≠ runtime_verified

事件出现一次
≠ behavior_passed

探针成功
≠ 正式底座已成立

本地报告存在
≠ 证据已经进入仓库
```
