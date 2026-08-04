# DCF macOS AI 实验宿主当前规范

日期：2026-08-05  
状态：当前有效；作为 `docs/spec/2026-08-04-DCF-当前实施规范.md` 的宿主环境专项补充

> 总规范继续定义“什么才算 DCF”。本文只定义：**专用 macOS AI 宿主现在拥有什么能力，以及 DCF 正式实现怎样优先借用 macOS 已有系统能力。**

关联 ADR：

- `docs/adr/2026-08-05-macos-ai-host-capability-policy.md`
- `docs/adr/2026-08-05-macos-native-public-capability-blackhole-exploration.md`

---

# 1. 宿主定位

这台 Mac 是：

> **专用于 AI、AI Coding、DCF 和系统实验的宿主机。**

机器能力层与 DCF 正式架构层必须彻底分开：

```text
机器能力层
→ 这台 Mac 最多允许做到什么

DCF 正式架构层
→ DCF 长期运行真正应该依赖什么
```

权限开放的目的，是消除研究中的人为限制变量；不是要求正式架构依赖破解、私有 offset、版本脆弱 hook 或自定义 kernel。

---

# 2. 当前能力开放状态：behavior_passed

2026-08-05 的 1TR / Boot 级能力开放已经完成。

用户提供的本地独立复核报告显示，在正常 macOS 重启后以下状态仍同时成立：

| 能力 | 当前状态 |
| --- | --- |
| SIP | disabled |
| Security Mode | Permissive |
| custom kernel / BootKC 能力 | enabled；当前没有 custom KC |
| third-party kext / AuxKC 能力 | enabled；当前没有第三方 kext |
| CTRR enforcement | disabled |
| boot-args filtering | disabled；当前没有实验 boot-args |
| SSV / authenticated-root | disabled |
| Research Guests | enabled |
| FileVault | Off |

关键事实：

```text
门全部打开
≠
已经使用这些能力修改系统本体
```

当前没有：

```text
第三方 kext
custom kernel
custom BootKC / KernelCollection
系统卷 patch
Apple framework / daemon / binary patch
实验 boot-args
custom SSV snapshot
```

因此机器当前是：

> **开放实验宿主，而不是自定义系统构建。**

后续实验如果遇到失败，首先检查能力本身、接口语义、当前系统版本行为、TCC 与实现方法；不得再默认把 SIP / CTRR / boot-args filtering / SSV 当作主要未知变量。

Recovery 证据当前由本地任务保存在：

```text
~/dcf-ai-host-setup/evidence/recovery-open/
Data 卷 dcf-recovery-open/
```

本规范只记录已报告的运行裁决；证据文件在真正进入仓库后再提升为仓库内可复核证据，不伪装已经导入。

---

# 3. 当前仍禁止提前制造的系统状态

能力开放后仍然不要因为“现在能做到”就提前执行：

```text
patch Apple 系统卷
替换系统 framework / daemon / binary
安装长期自定义 kernel
为了未来可能性维护 custom Boot Kernel Collection
无实际需求地安装自定义 kext
```

原因不是“底层所以危险”，而是这些动作开始制造与具体 macOS build、KDK、更新和启动状态耦合的长期维护对象。

只有出现真实结构性收益时才能进入，例如：

```text
一个系统级接缝
→ 能吸掉大量 App connector

一个系统组件修改
→ 同时提供多个 DCF 核心事实面

公开 API + 用户态系统能力 + 普通探真
→ 都无法提供关键公共能力
```

进入该层之前必须单独证明：

- 收益是否跨多个功能复用；
- 维护成本是否低于被吸收掉的上层复杂度；
- 系统升级后的恢复成本是否可接受；
- 是否存在更稳定的系统原生替代。

---

# 4. DCF 的 macOS 底座选择原则

正式 DCF 优先级：

```text
系统公开 / 稳定维护的语义能力
>
系统已经维护的结构化事件、索引与生命周期
>
必要的系统级观察 / 控制接口
>
深层探真用于发现事实与真实接缝
>
App / 来源专用适配
>
脆弱 UI / OCR 猜测
```

核心原则：

> **先寻找系统和成熟软件本来就在维护的事实，再考虑自己制造新的传感器、索引或守护结构。**

> **系统尽量拥有现实，DCF 自己拥有认知。**

macOS 可以拥有：

```text
文件是否存在
文件发生了什么变化
进程是否存在
哪个 App 在前台
文本客户端收到什么提交
真实机器动作发生了什么
系统动作接口怎样调用
```

DCF 自己必须拥有：

```text
这些现实为什么后来被认为相关
用户目标是什么
哪个项目 / 长期问题真正拥有这些材料
当时怎样理解
后来怎样重新理解
认知关系怎样变化
```

禁止从页面状态、前台 App、路径、时间邻近或 Agent 自报结果推测用户目标与认知事实。

---

# 5. 当前原生公共能力候选

以下是优先勘探对象，不是已经晋级的正式架构清单。

## 5.1 `FSEvents + Spotlight`：文件世界候选

目标组合：

```text
FSEvents
→ 上次持久游标以后什么变了

Spotlight / MDQuery / NSMetadataQuery
→ 现在什么存在、什么匹配

真正需要正文
→ 只读取少数命中文件
```

如果组合成立，DCF 不应再默认维护：

```text
定期全盘扫描
重复普通文件清单
重复系统元数据索引
每来源一套文件 watcher
```

---

## 5.2 `NSWorkspace + CoreDuet / KnowledgeC`：活动时间骨架候选

`NSWorkspace` 提供实时系统上下文，例如：

```text
App 生命周期
前台 App 变化
睡眠 / 唤醒
挂载
```

本轮 Plan 勘探进一步发现：CoreDuet / KnowledgeC 可能已经保存 App usage、屏幕亮灭、媒体 / 通知等活动历史。

当前只把它视为高杠杆候选。

必须实测：

- 语义是否稳定；
- 保留窗口；
- schema / 私有数据库依赖厚度；
- 轮询成本；
- 休眠 / 唤醒连续性；
- macOS 更新后的脆弱度。

如果成立，它可能与 NSWorkspace 共同吸收大量来源自己的 session detector；如果依赖过厚，则应降级为辅助或探真来源。

---

## 5.3 `InputMethodKit + Text Input System + Unified Logging`：用户文字事实候选

当前已经有本地成功证据表明：

```text
subsystem-scoped private-data profile
+
InputMethodKit 日志
→ 可被动观察 insertText / setMarkedText 明文
```

已在 TextEdit / ChatGPT、普通打字 / Fn 语音路径观察到成功样本。

这只证明第一道能力门成立，还不能证明长期正式底座成立。

继续验证：

- 最终 commit 与 composition 的可分离性；
- Chrome、VS Code/Qoder、QQ/微信等常用路径覆盖；
- CPU / I/O；
- 日增量与“每 1 MB 有价值文字对应多少系统日志”；
- 掉线补读；
- 字段跨版本稳定性；
- private-data 配置撤销与长期维护。

Unified Log 默认只作为：

> **事实矿藏地图与窄 predicate 候选源。**

绝对禁止全量同步进 DCF。

---

## 5.4 `Endpoint Security / eslogger`：现实 Effect 与执行收据候选

必须拆成两个独立判断：

### 系统能力

```text
NOTIFY
→ 已经发生的真实机器动作
→ 事实来源 / 执行收据候选

AUTH
→ 即将发生的真实动作
→ 某些 Effect 的系统级允许 / 拒绝边界候选
```

要验证不同 Agent / shell / 普通进程最终是否能在共同系统动作面被观察，而不需要理解各自 Tool Protocol。

### DCF 长期消费能力

正式自建 Endpoint Security 客户端需要单独评估 entitlement、分发、授权与维护依赖。

`eslogger` 可以作为 Apple 签名的零代码探针证明系统能力，但：

> **探针可用 ≠ DCF 已经拥有一个可正式发布和长期维护的 ES 客户端。**

因此系统能力定级与 DCF 接入定级必须分开。

---

## 5.5 `launchd + XPC`：运行生命周期底座候选

目标边界：

```text
launchd
→ 进程生命、按需启动、崩溃拉起、空闲退出

XPC
→ 进程通信、权限宿主边界

DCF 持久层
→ Job / Result / Failure / Receipt 等跨进程语义事实

Becsy / ECS World
→ 当前正在发生的语义活动
```

禁止同时让 launchd、Becsy 和 DCF 数据库各自维护一份“真实运行状态”并互相猜测。

---

## 5.6 `App Intents / Shortcuts / Apple Events`：跨 App 行动候选

优先研究 App 主动暴露给系统的高语义动作。

推荐退化梯度：

```text
正式语义接口
↓
系统自动化接口
↓
Accessibility 结构化 UI
↓
ScreenCaptureKit / OCR 视觉兜底
```

不得因为某个 App 没有统一正式接口，就把所有 App 都降级成 UI 点击。

DCF 自己未来也可以暴露高层 App Intents，使系统其他能力调用 DCF。

---

# 6. 与 DCF 既定执行架构的协调

macOS 公共能力必须和当前 DCF 架构一起评价，而不是孤立选 API。

当前执行方向：

```text
少数高自由度 AI
↓
高级语义状态机
↓
DCF 自研智能执行核
↓
Action Intent
↓
现实执行 / Effect
↓
结果回注
```

成熟 Agent Runtime 与 DCF 自研执行核并存：

```text
未知能力
→ 成熟 Agent Runtime 探索
→ 真实轨迹
→ 发现稳定高频模式
→ 执行模板 / 语义状态机
→ DCF 执行核规模运行
```

同时保留：

```text
Logical Operation
≠
Physical Execution
```

以及 Effect Projection：

```text
Resource / Scope
ReadSet
WriteSet
EffectKind
Ordering Constraint
PayloadRef
ContinuationRef
```

macOS 如果能直接提供资源身份、事实收据、生命周期或 Effect 线索，应优先利用；但系统事件不能替代 DCF 的逻辑调用身份和认知关系。

---

# 7. 原生公共能力黑洞准入门禁

每个候选进入正式架构前必须回答：

1. 它是否由系统本来就在维护？
2. 它真实证明什么，不能证明什么？
3. 它能否同时服务多个 DCF 岗位？
4. 它能删除多少 DCF 自有 watcher / connector / index / daemon / 状态机？
5. 与其他候选组合后是否减少胶水，而不是制造双写和映射？
6. 谁拥有权威事实，谁只是观察？
7. 掉线以后哪些事实可补读，哪些必须 `unknown`？
8. 常驻成本是否近似随有价值活动量增长？
9. 数据增长是否可控？
10. 跨 macOS 版本需要维护多少自有适配？
11. 失败时是否能清晰退化？
12. 是否减少 App / Agent 专用适配数量？

如果只是：

```text
10 个 connector
→ 10 个更脆的 hook
```

不算复杂度吸收。

真正目标是：

> **一个系统公共能力面吸掉多个上层需求。**

---

# 8. 当前研究流程

当前正式进入：

```text
Role Discovery
→ Leverage Discovery
→ 组合架构
→ Runtime Proof
→ Architecture Promotion
```

具体任务与执行顺序见：

- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探任务书.md`
- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探执行计划.md`

候选最终定位：

```text
A 正式公共底座
B 辅助公共能力
C 探真 / 研究仪器
D App / 来源专用适配
E 淘汰
unverified 尚未验证
```

Plan 模式只拥有战术规划权：可以补候选、安排实验、选择探针；不得重新定义 DCF、重新讨论权限开放、推翻认知关系边界或把既定执行架构重新投票。

---

# 9. 深层探真的岗位

允许使用：

```text
LLDB
Frida
DTrace
Mach APIs
kext
kernel debugging
custom kernel（仅极端研究）
```

但这些工具的正式岗位是：

> **当系统表面没有答案时确认真实事实在哪里，然后寻找最低耦合的长期接缝。**

原则：

```text
探索态可以很重
↓
发现稳定接缝
↓
稳定态必须尽量变薄
```

如果深层探针最终变成每个 App 一个 hook、每次升级修 offset，它就没有吸收 connector 复杂度。

---

# 10. 一句话当前裁决

> **宿主开门阶段已经 behavior_passed。现在不再追求更深权限，而是系统性寻找 macOS 已经替我们维护的公共现实面，让 DCF 尽量只拥有认知、语义任务和真正无法下放的长期关系。不要寻找最深的系统入口，寻找最能让 DCF 少造东西的系统入口。**
