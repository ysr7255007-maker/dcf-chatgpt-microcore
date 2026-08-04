# ADR：macOS 专用 AI 宿主的能力开放与系统原生底座

日期：2026-08-05  
状态：当前有效的阶段性架构裁决  
关联：`docs/adr/2026-08-05-macos-local-fact-source-probe.md`

---

## 1. 背景：前一轮评价函数发生了偏差

前一轮 macOS 本地事实源勘探主要围绕：

- 如何低成本获得本地事实；
- 如何突破 AX / OCR / App 私有数据库的覆盖限制；
- SIP、CTRR、boot-args、kext 等系统限制会不会妨碍深层探真；
- private-data 是否会扩大隐私暴露。

这条路线发现了 InputMethodKit、Unified Logging、Endpoint Security、`eslogger` 等高价值能力，但后续讨论发现评价函数存在两个偏差：

1. 把普通个人电脑的“最小权限 / 安全暴露”默认权重带入了一台**专门用于 AI、AI Coding、DCF 和系统实验的 Mac**；
2. 把“深层探针”逐渐误当成了开放系统限制的主要价值，而忽略了开放后的 macOS 本身能否成为 DCF 多类功能的公共底座。

因此，本 ADR 不覆盖旧研究记录，而是记录新的后续裁决。

---

## 2. 宿主机器的新定位

这台 Mac 的首要身份不是普通个人电脑，而是：

> **专用 AI 实验宿主。**

它的评价函数因此改为：

```text
能力收益
+
复杂度吸收率
+
跨功能复用程度
+
长期稳定性
+
依赖厚度
+
运行成本 / 数据增长
+
环境破坏半径
+
持续维护成本
```

其中，“安全边界降低”本身不再自动计为高权重负项。

只有当它进一步造成真实项目损失，例如：

- 必需软件拒绝运行；
- 系统频繁崩溃；
- 升级反复失败；
- 重要环境被破坏；
- 日常维护成本显著增加；

才作为项目代价进入评价。

---

## 3. 重新定义“破坏半径”

此前曾把 SIP-off 评为“大破坏半径”。该评价已被推翻。

新的定义：

> **破坏半径 = 一项改变会让多少已经完成的环境、服务、配置和实现失效，以及恢复这些建设需要多少工作。**

因此：

```text
关闭 SIP
→ 改变系统保护策略
→ 不会自动卸载软件、删除服务或清空配置
→ 环境破坏半径低

换 OS / 重装宿主
→ App、服务、权限、工具链和实验环境可能全部重建
→ 环境破坏半径极高
```

“修改得很底层”和“破坏半径很大”是两个独立维度。

一个动作完全可能同时具备：

> **能力深度高 + 环境破坏低。**

SIP-off 就属于这一类。

---

## 4. 核心裁决一：机器能力层与 DCF 正式架构层彻底解耦

从现在开始必须区分：

```text
机器能力层
→ 这台专用 AI Mac 允许做到什么

DCF 正式架构层
→ DCF 长期运行时应该依赖什么
```

二者不得互相绑架。

### 4.1 机器能力层

原则：

> **只要解除限制不会立即制造显著的环境破坏或持续维护负担，就倾向一次性开放。**

目标不是让 DCF 永久依赖所有开放能力，而是消除后续研究中的人为限制变量。

以后遇到：

```text
Operation not permitted
attach failed
boot-arg 被过滤
kext 不能加载
kernel probe 失败
```

不应首先花大量时间判断“是不是宿主故意留下的系统保护”。

### 4.2 DCF 正式架构层

原则恰恰相反：

> **正式 DCF 优先消费 macOS 已经维护的稳定、结构化、低耦合能力面。**

开放系统限制是为了自由发现最佳结构，不是为了让正式架构依赖破解、offset、私有函数地址或版本脆弱的 hook。

---

## 5. 核心裁决二：优先“系统给的东西”，深层探真是研究仪器

正式实现优先级改为：

```text
系统已经公开 / 稳定维护的语义能力
>
系统已经维护的结构化事件与索引
>
必要时的系统级观察 / 控制接口
>
深层探真用于发现事实或发现真实接缝
>
App 专用 connector
>
脆弱的 UI / OCR 猜测
```

深层探真的正确岗位是：

```text
不知道系统 / App 内部真正在哪里拥有事实
↓
用 LLDB / Frida / DTrace / Mach / kext / kernel debug 等探索
↓
找到真正稳定的系统接缝或最小观察点
↓
正式实现尽量退回稳定接口
↓
探针退出常规运行路径
```

如果正式 DCF 最终变成：

```text
每个 App 一个 Frida hook
每次更新修 offset
内部函数一变就重新逆向
```

那么这不是复杂度吸收，只是把普通 connector 换成了更脆的 connector。

---

## 6. 当前发现的 macOS 原生公共底座

### 6.1 `launchd + XPC`

系统已经负责：

- 按需启动服务；
- 空闲退出；
- 崩溃重启；
- 进程间通信；
- 用户态 / 特权 helper 的生命周期边界。

DCF 不应重复实现一个简化版服务管理器。

建议边界：

```text
macOS
→ 管进程生命、宿主权限、IPC

DCF
→ 管 Job 的语义进度、结果、失败、恢复和认知意义
```

### 6.2 `FSEvents + Spotlight`

组合岗位：

```text
FSEvents
→ 从持久事件 ID 补读“什么发生了变化”

Spotlight / MDQuery / NSMetadataQuery
→ 查询“现在有哪些相关文件 / 元数据”
```

DCF 应避免重新全盘扫描、复制一份普通文件清单或重复维护系统已经存在的文件元数据索引。

### 6.3 `NSWorkspace`

适合作为低成本的本地活动时间骨架：

- App 启动 / 退出；
- 前台 App 切换；
- 睡眠 / 唤醒；
- 挂载等系统活动。

它可以帮助多个事实源在同一系统时间线上形成低成本上下文，而不要求每个 App 自己实现 session detector。

### 6.4 `InputMethodKit + Unified Logging`

当前作为“用户文字输出”高杠杆事实面继续实机验证。

旧 ADR 中“必须优先局部开启 private data、隐私暴露是正式门禁”的结论不再作为当前宿主配置原则。

新的判断是：

> **实验阶段先证明能力是否成立；正式 DCF 再决定最终使用哪一种最稳定、最低成本的配置。**

仍然必须测量日志增量、字段稳定性和长期运行成本，因为这些是真实工程代价。

### 6.5 `Endpoint Security`

价值不只是一条事实源。

它同时可能承担：

```text
NOTIFY
→ 机器真实动作观察 / 执行收据

AUTH
→ 某些现实副作用发生前的系统级控制边界
```

它可能成为 DCF 行动层中“AI 意图 → 真实机器效果”之间的一部分公共系统底座。

### 6.6 `App Intents / Shortcuts / Apple Events`

优先作为跨 App 行动语义面。

对于支持这些系统能力的 App，DCF 应优先调用 App 主动暴露给系统的动作，而不是先走 UI 自动化或逆向。

DCF 自己未来也可以反向暴露 App Intents，使 Shortcuts、Spotlight、Siri / Apple Intelligence 等系统体验可以调用 DCF 的高层动作。

---

## 7. 系统开放策略：一次开门，避免以后反复避让

当前原则：

> **提前解除限制，可以；提前制造复杂系统状态，不要。**

### 7.1 无需整机重启的能力

本轮由本地 AI 尽量一次性配置并真实验证：

- admin / sudo / passwordless sudo；
- Developer Tools 调试权限；
- Full Disk Access；
- Accessibility；
- Input Monitoring；
- Screen & System Audio Recording；
- Automation / Apple Events；
- Unified Logging private-data 实验配置；
- `eslogger` / Endpoint Security 现成入口。

需要用户在 System Settings 点选的 TCC 授权不算架构阻塞。

### 7.2 集中一次 Recovery 处理的“开门项”

当前已倾向统一开放：

- SIP off；
- `sip2`：CTRR / Kernel Integrity 相关限制放开；
- `sip3`：boot-args filtering 放开；
- 允许第三方 kext / AuxKC 能力。

Apple Silicon 的 LocalPolicy 明确把 `sip0`、`sip1`、`sip2`、`sip3` 分成独立策略字段，因此 Recovery 操作必须基于本机 `csrutil` / `bputil` 实际状态验证，不得把“关 SIP”错误等同为“所有限制自动全部解除”。

---

## 8. 当前仅剩的两个更深层决策

### 8.1 `authenticated-root / SSV verification off`

性质：

> **仍属于“开门”，不等于真正修改系统卷。**

它允许 iBoot 接受 SSV root hash 验证失败，为以后验证“修改 Apple 系统组件是否能形成高杠杆公共能力”留下入口。

当前倾向：

> **如果当前 FileVault 状态允许，倾向在同一次 Recovery 中一起关闭 authenticated-root / SSV verification。**

但必须先读取本机 FileVault 与 LocalPolicy 真实状态。

Apple 明确说明：FileVault 开启时系统不会允许关闭 SSV，因为两者的 at-rest protection 必须一致。

### 8.2 真正 patch 系统卷 / 安装自定义 kernel

性质已经不同：

```text
开门
→ 只是增加未来能力

真正修改系统卷 / 自定义 kernel
→ 开始制造需要我们长期维护的系统状态
```

因此当前裁决是：

> **现在不因为“可以”而提前 patch 系统卷，也不提前安装自定义 kernel。**

只有出现真实结构性收益时才进入该层，例如：

- 修改一个系统组件可以吸掉大量 App connector；
- 一个稳定系统 hook 可以提供多个 DCF 功能共同需要的事实面；
- 用户态、官方系统接口和普通 kext 都无法提供某项关键公共能力。

一旦进入这一层，必须单独计算：

- 与 macOS build / KDK 的版本耦合；
- 系统更新后的恢复 / 重做成本；
- crash / boot failure 风险；
- 是否真的以一个结构吸收了足够多上层复杂度。

---

## 9. Recovery 批次的操作纪律

最终 Recovery 任务不得直接复制网络上的固定命令串。

必须：

```text
进入 paired 1TR
↓
读取本机 csrutil / bputil help 和当前 LocalPolicy
↓
保存修改前状态
↓
按目标矩阵一次性修改
↓
每一步重新读取状态
↓
确认最终 LocalPolicy 与目标完全一致
↓
再重启
```

原因：`bputil` 的安全模式和策略选项可能重建或重签 LocalPolicy；错误命令顺序可能覆盖前一步已经设置的策略位。

---

## 10. 当前一句话裁决

> **把这台专用 AI Mac 尽量一次性变成开放实验宿主，消除后续权限绕路；但正式 DCF 仍优先长在 macOS 已经维护的稳定系统能力面上。深层探真用于发现真相和发现接缝，不应自动成为长期承重墙。提前开门，不提前制造需要长期维护的自定义系统状态。**

---

## 11. 参考资料

- Apple Platform Security：LocalPolicy 字段（`sip0` / `sip1` / `sip2` / `sip3` / `smb2`）  
  https://support.apple.com/zh-cn/guide/security/secc745a0845/web
- Apple Platform Security：Apple silicon 启动磁盘安全策略 / Permissive Security  
  https://support.apple.com/en-euro/guide/security/sec7d92dc49f/web
- `bputil(1)` Xcode man page 镜像  
  https://keith.github.io/xcode-man-pages/bputil.1.html
- Apple Platform Security：Signed System Volume  
  https://support.apple.com/en-ie/guide/security/secd698747c9/web
- Apple Platform Security：第三方 kext / AuxKC  
  https://support.apple.com/ja-jp/guide/security/sec8e454101b/web
- Apple Developer：XPC  
  https://developer.apple.com/documentation/xpc
- Apple Developer：Endpoint Security  
  https://developer.apple.com/documentation/endpointsecurity
- Apple Developer：NSMetadataQuery / Spotlight metadata  
  https://developer.apple.com/documentation/foundation/nsmetadataquery
- Apple Developer：App Intents  
  https://developer.apple.com/documentation/appintents
