# DCF macOS AI 实验宿主当前规范

日期：2026-08-05  
状态：当前有效；作为 `docs/spec/2026-08-04-DCF-当前实施规范.md` 的宿主环境专项补充

> 总规范继续定义“什么才算 DCF”。本文只定义：**专用 macOS AI 宿主应该怎样开放能力，以及 DCF 正式实现怎样优先借用 macOS 已有系统能力。**

关联 ADR：`docs/adr/2026-08-05-macos-ai-host-capability-policy.md`

---

# 1. 宿主定位

这台 Mac 是：

> **专用于 AI、AI Coding、DCF 和系统实验的宿主机。**

因此不得默认套用普通个人电脑的“最小权限优先”策略。

当前首要目标是：

```text
一次性消除不必要的系统限制
↓
让后续研究直接面对真实能力边界
↓
避免为了权限限制反复绕路
↓
DCF 正式实现再从开放环境中选择最稳定、最低耦合的系统能力
```

---

# 2. 两层必须分开

## 2.1 机器能力层

回答：

> **这台 Mac 最多允许做到什么？**

原则：

- 只要解除限制不会立即破坏现有环境或制造明显持续维护负担，就倾向提前开放；
- 不要求 DCF 当前已经证明会使用该能力；
- 不因为某项能力“很底层”就自动判定破坏大；
- “需要重启 / 进 Recovery”只算操作打断，不自动等于环境破坏；
- 研究阶段允许使用深层探真手段证明能力上限。

## 2.2 DCF 正式架构层

回答：

> **长期 DCF 应该依赖什么？**

原则：

- 优先使用 macOS 已经维护的稳定、结构化、低耦合能力；
- 不为了“已经拥有高权限”就优先采用逆向、私有 offset、版本脆弱 hook；
- 深层探真主要用于发现事实、发现系统接缝、验证系统真实行为；
- 如果能退回正式系统接口，探针应退出长期运行路径；
- App 专用 connector 只有在系统公共能力无法吸收需求时才进入。

核心：

> **权限全开是为了让架构不被权限限制带歪，不是为了让正式架构依赖破解。**

---

# 3. 评价标准

所有宿主能力和 DCF 底座候选统一按以下维度判断：

```text
能力收益
复杂度吸收率
跨功能复用程度
长期稳定性
依赖厚度
运行成本
数据增长
环境破坏半径
持续维护成本
```

## 3.1 环境破坏半径

定义：

> **一次改变会让多少已经安装的软件、服务、配置、实验环境和 DCF 建设失效，以及恢复需要多少工作。**

禁止把以下概念混为一谈：

```text
能力很底层
≠
破坏半径很大

需要 Recovery
≠
会破坏现有环境
```

例如：

```text
SIP off
→ 能力深度高
→ 环境破坏低

换 OS
→ 能力与生态整体改变
→ 环境破坏极高
```

## 3.2 安全边界

对本专用实验宿主，安全边界降低本身不作为一票否决项。

只有当它进一步造成真实工程损失时才进入高权重负项，例如：

- 系统不稳定；
- 必需 App 无法运行；
- 更新失败；
- 启动失败；
- 数据增长失控；
- 长期维护成本显著增加。

---

# 4. 当前系统能力开放策略

## 4.1 无需整机重启：尽量一次性开

由本地 AI 自动配置并真实验证：

```text
admin / sudo / passwordless sudo
Developer Tools 调试权限
Full Disk Access
Accessibility
Input Monitoring
Screen & System Audio Recording
Automation / Apple Events
Unified Logging private-data 实验配置
eslogger / Endpoint Security 现成入口
```

TCC 必须人工点击时：

> **直接打开对应 System Settings 页面，让用户完成最小交互，然后继续验证。**

禁止因为不能静默授权就重新设计绕路方案。

---

## 4.2 需要 1TR / Recovery：集中一次处理

当前目标矩阵倾向：

```text
SIP                              OFF
CTRR / Kernel Integrity 限制      OFF
boot-args filtering              OFF
third-party kext / AuxKC         ALLOW
authenticated-root / SSV         倾向 OFF，见第 4.3 节
```

实施前必须读取这台机器自己的：

```text
csrutil status
csrutil help
bputil -d
bputil help / man
fdesetup status
```

不得从旧博客复制固定命令串。

必须保存修改前后完整 LocalPolicy 证据。

---

## 4.3 authenticated-root / SSV

当前倾向：

> **如果 FileVault 状态允许，在同一次 Recovery 中关闭 authenticated-root / SSV verification。**

理由：

- 这是“开放以后可以修改系统卷”的资格；
- 本身不等于已经 patch 系统卷；
- 可以避免以后为了验证一个系统级高杠杆能力再次进入 Recovery；
- 它可能成为研究 Apple framework / daemon / 系统文本链 / logging 等公共能力的入口。

但：

- 必须先读本机 FileVault 状态；
- 如果为了关闭 SSV 必须额外制造显著环境迁移或维护成本，再单独评估；
- 不得把“关闭验证”写成“现在立即修改系统文件”。

---

# 5. 当前禁止提前制造的系统状态

即使权限已经开放，当前也**不要只因为可以做到就提前执行**：

```text
patch Apple 系统卷
替换系统 framework / daemon / binary
安装自定义 kernel
为了未来可能性提前维护 custom Boot Kernel Collection
无需求地安装自定义 kext
```

原因不是“太危险”，而是：

> **这些动作开始制造与具体 macOS build、KDK、系统更新和启动状态耦合的长期维护对象。**

只有真实结构性收益足够大时才进入，例如：

```text
一个系统级 hook
→ 能吸掉大量 App connector

一个系统组件修改
→ 同时提供多个 DCF 核心事实面

官方接口 + 用户态探真 + 普通 kext
→ 都无法提供某项关键公共能力
```

进入该层之前必须单独证明：

```text
收益是否跨多个功能复用
维护成本是否低于被吸收掉的上层复杂度
升级后恢复成本是否可接受
是否存在更稳定的系统原生替代
```

---

# 6. DCF 正式实现的 macOS 原生底座优先级

本文不规定所有功能都必须使用同一种 API。

它规定的是一个方向：

> **系统已经维护好的事实、索引、生命周期和动作接口优先。**

当前高价值公共底座如下。

---

## 6.1 `launchd + XPC`：运行生命周期底座

macOS 负责：

```text
按需启动
空闲退出
崩溃重启
IPC
用户态 / 特权 helper 生命周期
```

DCF 负责：

```text
Job 语义
进度
结果
失败
恢复
认知意义
```

禁止无必要地在 DCF 内重新实现一套简化版守护进程 / 服务监督系统。

---

## 6.2 `FSEvents + Spotlight`：文件世界底座

优先组合：

```text
FSEvents
→ “上次游标以后什么变了”

Spotlight / MDQuery / NSMetadataQuery
→ “现在什么存在、什么匹配”

真正需要内容
→ 只读取少数命中文件
```

禁止默认：

```text
定期全盘扫描
维护一份重复的普通文件清单
复制 macOS 已经维护的元数据索引
```

DCF 自己只拥有系统索引无法表达的认知关系和项目语义。

---

## 6.3 `NSWorkspace`：活动时间骨架

用系统通知获得：

```text
App 启动 / 退出
前台 App 变化
睡眠 / 唤醒
挂载等系统上下文
```

它优先承担多个事实源之间的低成本活动分段，不要求每个 App 自己实现 session detector。

---

## 6.4 `InputMethodKit + Unified Logging`：用户文字事实候选

继续验证：

```text
系统文本输入链
↓
最终 commit / insert text
↓
是否可以稳定得到高语义用户输出
```

正式准入重点是：

- 语义纯度；
- 覆盖率；
- 日增量；
- CPU / I/O；
- 字段跨系统版本稳定性；
- 掉线补读能力。

隐私暴露不再作为本专用实验机的前置否决项。

---

## 6.5 `Endpoint Security`：机器动作与效果边界候选

两类用途必须区分：

```text
NOTIFY
→ 已发生的真实机器动作
→ 观察 / 执行收据 / 事实来源

AUTH
→ 正准备发生的真实动作
→ 某些 Effect 的系统级允许 / 拒绝边界
```

DCF 不应因为 Agent 来源不同就为每种工具重新制造一套机器行为观察器。

如果多个 AI 工具最终落到相同的系统动作面，应优先在系统动作面统一。

---

## 6.6 `App Intents / Shortcuts / Apple Events`：跨 App 行动底座

对于 App 主动暴露给 macOS 的动作：

```text
App Intents / Shortcuts
Apple Events / ScriptingBridge
```

应优先于：

```text
UI 猜测
屏幕点击脚本
App 私有数据库写入
逆向内部函数
```

DCF 自己未来也可以暴露高层 App Intents，让系统其他能力调用 DCF。

---

## 6.7 Accessibility / ScreenCaptureKit：系统级兜底，不是第一抽象

Accessibility：

> 有稳定语义时直接使用；覆盖不足时诚实退化。

ScreenCaptureKit / OCR：

> 只在缺少更干净结构时使用，不得因为“什么都能看到”就成为基础记录面。

---

# 7. 深层探真的正式岗位

深层探真不是被否定，而是被重新归位。

工具可能包括：

```text
LLDB
Frida
DTrace
Mach APIs
kext
kernel debugging
custom kernel（仅极端研究）
```

它最有价值的工作是：

> **当系统表面没有现成答案时，直接确认真实程序 / 系统内部到底在哪里拥有这个事实，然后寻找最低耦合的长期接缝。**

正式实现判断：

```text
探索态可以很重
↓
发现稳定接缝
↓
稳定态必须尽量变薄
```

禁止默认把探索工具原样变成 24×7 承重墙。

---

# 8. 复杂度吸收门禁

每个新 macOS 能力进入 DCF 正式架构前，必须回答：

```text
1. 它是否由系统本来就在维护？
2. 它能否同时服务多个 DCF 功能岗位？
3. 它是否减少 App 专用 connector 数量？
4. 它是否减少 DCF 自己维护的状态机 / watcher / index / daemon？
5. 系统升级后，我们需要维护多少自有适配？
6. 失败时是否可以清晰退化，而不是猜测？
7. 常驻成本是否与有价值活动量近似相关？
```

如果一个方案只是：

```text
把 10 个 connector
换成
10 个更脆的 hook
```

则不算复杂度吸收。

真正的优选目标是：

> **一个系统公共能力面吸掉多个上层需求。**

---

# 9. 当前实施顺序

当前顺序不是按“权限危险程度”，而是按“越晚处理越容易造成重复避让”的程度：

```text
第一步
→ 完成所有无需整机重启的能力开放与证据记录

第二步
→ 基于本机真实 LocalPolicy 生成一次 Recovery 配置矩阵

第三步
→ 一次性完成 SIP / CTRR / boot-args / kext / 条件性 SSV 开门

第四步
→ 重启后验证机器能力上限

第五步
→ 正式 DCF 优先实测 macOS 原生公共底座

第六步
→ 只有遇到真实能力缺口时才使用深层探真寻找新接缝

第七步
→ 只有结构性收益足够大时才 patch 系统或维护自定义 kernel
```

---

# 10. 一句话实施原则

> **先把专用 AI Mac 的门一次性打开，免去以后所有权限绕路；再让 DCF 尽量薄薄地长在 macOS 已经替我们维护好的事实、索引、生命周期和动作平面上。开放能力不等于滥用底层能力；深层探真是发现真相的仪器，系统原生稳定结构才优先成为正式底座。**
