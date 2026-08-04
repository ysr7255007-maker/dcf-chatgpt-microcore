# ADR：macOS 本地事实源阶段性勘探

日期：2026-08-05  
状态：阶段性研究记录；**不是当前实现定案**  
后续：有新的运行时证据时继续追加，不覆盖本轮结论

---

## 1. 为什么开始这轮勘探

DCF 后续需要把观察范围从 AI 对话扩展到本地电脑活动，但当前目标不是制造一个“什么都能看见”的全能监控器。

本轮真正寻找的是：

> **资源消耗低、依赖少、可靠性高、长期可常驻，而且事实增量天然可控的本地事实源。**

候选源最重要的不是覆盖率，而是体质。

优先满足：

```text
现实本来就在产生这份数据
↓
DCF 只旁路读取 / 增量消费
↓
成本尽量与“真实有价值事实量”成正比
而不是与“电脑开机时间 / 屏幕变化量”成正比
```

因此，本轮明确拒绝把“完整记录现实”当目标。

---

## 2. 当前事实源准入标准

一个本地事实源进入基础候选池前，至少检查以下问题：

1. **事实纯度**：它直接证明了什么，而不是需要 AI 猜什么？
2. **常驻成本**：24×7 运行时 CPU、内存、I/O 是否足够低？
3. **依赖厚度**：是否依赖某个 App 的私有数据库、目录、schema 或 UI 实现？
4. **增量边界**：正常使用时日增量是否天然可控？是否存在一天突然产生数百 MB～GB 原始数据的正常路径？
5. **增量消费**：能否从上次位置继续，而不是每天重新扫描全量历史？
6. **掉线恢复**：DCF 暂停时，事实是否仍由系统 / 原应用保留，之后可以补读？
7. **长期稳定性**：依赖的是系统稳定接缝，还是偶然日志字符串 / App 私有实现？
8. **诚实退化**：拿不到具体内容时，能否明确保留“未知”，而不是推测补齐？

核心目标：

> **成本 ≈ 有意义事实数量，而不是成本 ≈ 电脑运行时间。**

---

## 3. 已排除或降级的路线

### 3.1 屏幕变化 + OCR：不适合作为基础事实源

曾考虑利用桌面 dirty region，只 OCR 发生变化的区域。

该路线被否决为基础方案。

原因不是只有算力成本，更重要的是**事实边界太脏**：

```text
网页正文
历史消息
对方的话
自己的话
按钮
广告
动画
自动补全
重复上下文
```

都会同时进入像素层。

即使 OCR 很准，DCF 仍然必须再次判断：

> “哪些是用户自己的输出？”

高频网页浏览又会制造大量无意义 dirty region，因此硬件消耗和数据增量主要由页面变化决定，而不是由用户表达决定。

结论：

> **OCR 可作为极特殊场景的临时工具，但不进入 DCF 最小事实源。**

---

### 3.2 AX / Accessibility：高价值增益源，但不能承担完整兜底

AX 的优点：

- 事件驱动；
- 标准控件可直接得到角色、焦点、文本和值变化；
- 事实语义远强于 OCR；
- 正常情况下资源消耗很低。

问题：

- 覆盖率由目标 App 决定；
- 很多自绘 / Electron / 特殊 App 只暴露一个外壳；
- 甚至内部所有控件都不可见。

因此 AX 的当前定位是：

> **高可信、低成本、覆盖率不保证的机会主义语义源。**

它适合补充，不适合作为“只要用户真的输入了文字就一定能看见”的基础保证。

---

### 3.3 直接读取 IDE / Agent 本地数据库：信息密度很高，但过厚

AI IDE、Codex、Agent Runtime 往往已经存在 SQLite、JSONL、session history 等本地记录。

优点非常明显：

- 用户输入、AI 回复、工具调用、文件修改等语义已经被整理；
- 可以游标式增量读取；
- DCF 挂掉以后通常还能补读；
- 信息密度极高。

但它作为“最小本地兜底”过厚：

```text
保存目录可能改变
数据库 schema 可能改变
JSONL 格式可能改变
版本升级需要来源适配器跟随
```

因此它仍然是优秀的**高语义扩展事实源**，但当前不把它当最小基础事实源。

---

## 4. 关键突破：不要追踪输入设备，追踪 macOS 文本输入系统的接缝

讨论豆包 Fn 语音输入时出现了一个关键问题：

> 输入法不可能自己监听所有 App 的鼠标点击，然后猜用户是否点进了文本框。

真正发生的是：

```text
目标 App 的文本对象进入可输入状态
↓
macOS 文本输入系统建立 / 激活文本客户端关系
↓
当前输入法参与输入 session
↓
中间组合文本与最终提交文本进入系统文本链
```

这使研究目标从：

```text
监听键盘
监听屏幕
读取 AX 树
```

转为：

> **寻找 Input Method ↔ macOS Text Input System ↔ Text Client 之间已经存在的系统级事实接缝。**

这是本轮最重要的方向变化。

---

## 5. 本地实验的当前已报告结果

以下内容来自本地 AI 已完成的实机勘探；当前作为阶段性实验结论记录，后续若进入正式实现门禁，需要继续把对应运行证据纳入仓库。

### 5.1 已经能够观察到 InputMethodKit 相关文本事件

本地实验已经找到 `com.apple.inputmethodkit` 相关的 Unified Logging 事件。

日志能够暴露文本输入流程中的事件形态，但动态文本字段显示为：

```text
<private>
```

最初一度怀疑这是输入法与客户端之间的 IPC 加密。

该判断已被推翻。

---

### 5.2 `<private>` 不是豆包加密，而是 Apple Unified Logging 的隐私脱敏

当前查实结论：

> **`<private>` 来自 macOS Unified Logging / `os_log` 的 privacy redaction，不是豆包自己对字符串做了私有加密。**

也就是说：

```text
InputMethodKit 已经知道真实动态文本
↓
写入 Unified Log
↓
默认 privacy policy 不保存 / 不暴露 private payload
↓
普通 log stream / log show 只能看到 <private>
```

因此不存在“把已经记录下来的密文以后解密回来”的正常路线。

如果 private data 在记录时没有被允许保存，之后 sudo / `log show` 也无法恢复原始明文。

这把问题从：

> 破解文本输入 IPC

降成了：

> **是否可以通过 Apple 支持的日志配置，让指定 subsystem 在记录时保留 private payload。**

---

### 5.3 本地已验证的两条 private-data 配置路线

#### 路线 A：直接写 subsystem plist

尝试路径：

```text
/Library/Preferences/Logging/Subsystems/com.apple.inputmethodkit.plist
```

目标配置：

```text
DEFAULT-OPTIONS
→ Enable-Private-Data = true
```

本地 macOS 26.5.2 实测：

```text
root 写入
→ Operation not permitted
```

当前判断：被 SIP / 系统保护挡住。

本地证据文件：

```text
evidence/private-data-plist-attempt.md
```

此路线当前判定不可用。

#### 路线 B：`com.apple.system.logging` 配置描述文件

Apple 支持通过配置描述文件修改 Unified Logging 行为。

本地已经生成：

```text
~/dcf-imk-voice-probe/evidence/Enable-Unified-Log-Private-Data.mobileconfig
```

当前尚未完成的关键验证是：

> 安装 profile 后，`com.apple.inputmethodkit` 日志中的 `<private>` 是否会变成真实输入文本。

安装需要用户在 macOS 系统设置中批准，CLI 安装路径当前不可直接完成。

---

## 6. 当前比“全局开启 private data”更优的实验方向

如果继续实验，优先验证：

> **只针对 `com.apple.inputmethodkit` subsystem 打开 `Enable-Private-Data`，不要第一步就全系统开启 private data。**

理由：

- 目标边界更小；
- 隐私暴露范围更小；
- 更容易测量增量；
- 不会因为其他 subsystem 的 private payload 同时展开而污染实验结果；
- 更符合 DCF “只摘高价值事实”的体质。

实验目标不是“成功看到一次明文”就结束。

还必须测：

```text
private profile OFF
vs
private profile ON
```

比较：

- InputMethodKit 事件数；
- Unified Log store 增长；
- DCF 最终可提取文本字节量；
- CPU；
- 内存；
- I/O；
- 休眠 / 唤醒；
- DCF 不运行时的日志保留和补读能力。

核心杠杆指标：

> **为了得到 1 MB 用户真实输入，系统额外产生多少 MB 日志和多少资源消耗？**

如果输入 1 MB 导致数百 MB 额外长期数据，则直接失去基础事实源资格。

---

## 7. 为什么这个候选目前很有价值

如果上述 profile 验证成功，这条路线拥有几个非常突出的结构性优势。

### 7.1 不依赖目标 App 的 AX

即使 QQ / 微信 / 自绘 App 不暴露内部 AX 树，只要正常走 macOS 文本输入系统，理论上仍可能在 InputMethodKit 的系统边界留下输入事件。

### 7.2 不解析豆包自己的数据库

不关心豆包把自己的数据库存在哪里，也不关心它的 schema。

观察的是 macOS 系统边界，而不是第三方 App 私有实现。

### 7.3 DCF 自己不需要制造新的高频传感流

不是：

```text
DCF 捕获屏幕
DCF OCR
DCF 扫 UI
DCF 记录每个键
```

而是：

```text
macOS 正常文本输入
↓
macOS 本来就在产生诊断事件
↓
DCF 只消费少数高价值事件
```

### 7.4 事实纯度很高

如果最终确认日志中的 `insertText` / composition / commit 语义足够稳定，那么这类事件天然已经过滤掉：

- 网页正文；
- 对方历史消息；
- 页面按钮；
- 大量视觉重复上下文。

它关注的是：

> **文本输入系统正在处理的用户输入。**

这正是 OCR 无法天然给出的语义边界。

---

## 8. 新发现：Unified Log 可能不是一个单独事实源，而是一张“事实矿藏地图”

进一步调查 `Enable-Private-Data` 的原始用途后，发现现实中它被用于多种诊断和取证：

```text
InputMethodKit
→ 文本输入诊断

mDNSResponder / 网络 subsystem
→ DNS / 网络访问诊断

AccountPolicy / OpenDirectory / Kerberos
→ 登录与身份认证排障

Gatekeeper / syspolicyd / LaunchServices
→ App 运行、路径、策略评估

第三方 App 自己的 os_log
→ 应用自己的高语义动态事件
```

因此出现一个比单独 InputMethodKit 更大的研究方向：

> **macOS 自己可能已经把大量现实行为压缩成了结构化、带时间的系统事件，只是高价值动态参数被 privacy policy 隐藏。**

这意味着 Unified Log 可以被理解成：

> **事实源发现总线 / 事实矿藏地图。**

注意：这不意味着把整个 Unified Log 同步进 DCF。

正确方向是：

```text
巨大的 macOS Unified Log
↓
只识别少数高价值 subsystem / category
↓
predicate 精确过滤
↓
提取很少的结构化事实
↓
DCF 长期保存
```

原始系统日志继续由 macOS 自己轮转。

---

## 9. 当前明确的盲区与风险

### 9.1 Unified Log 不是业务协议

日志字符串、category、subsystem 的细节可能随 macOS 版本改变。

因此：

> **它可以成为低成本旁路事实源，但不能未经验证就被当作永远稳定的正式业务 API。**

### 9.2 不是所有 private 字段都保证能通过 profile 还原

Apple 还存在其他 masking / hash 处理。

必须逐个 subsystem、逐个字段实测。

### 9.3 未提前启用 private data 的历史明文无法事后补回

如果真实值在记录时已经被 privacy policy 丢弃：

```text
昨天：<private>
今天：启用 profile
```

不能恢复昨天的原始字符串。

因此这类事实源的“事件可补读”和“private payload 可补读”必须分开评价。

### 9.4 全量 Unified Log 数据量巨大

绝对禁止：

```text
Unified Log
↓
全量同步到 DCF
```

DCF 只允许 predicate 式窄读取和二次提纯。

### 9.5 开启 private data 会扩大隐私暴露面

尤其全系统开启时，可能使用户名、路径、域名、消息文本等原本隐藏的数据进入系统日志。

因此任何正式方案都必须证明：

- 能否只局部开启；
- 日志保留多久；
- 哪些其他进程 / 管理工具可读取；
- 如何撤销；
- 是否值得承担这个隐私代价。

当前不得因为“能拿到文本”就跳过这项门禁。

---

## 10. 下一阶段建议的实验顺序

### P0-1：InputMethodKit private payload 实机验证

只为 `com.apple.inputmethodkit` 开启 private data。

验证：

```text
豆包作为当前活动输入法
↓
TextEdit / Chrome / ChatGPT / VS Code 输入固定字符串
↓
InputMethodKit 日志是否从 <private> 变成真实文本
```

必须同时区分：

```text
中间 composition / marked text
最终 commit / insert text
```

### P0-2：24×7 成本与增量实验

至少测：

```text
OFF 基线
ON 受控 profile
```

最终给出：

```text
CPU
内存
I/O
系统日志日增量
InputMethodKit 事件日增量
提纯后的 DCF 文本日增量
```

### P0-3：覆盖矩阵

验证不同目标 App：

```text
TextEdit
Chrome
ChatGPT 网页
VS Code
QQ / 微信等 AX 不完整 App
其他常用自绘 App
```

重点看：

> 是否只要通过当前输入法向文本客户端提交，就都能在这个系统边界观察到。

### P1：Unified Log 事实矿藏勘探

先在默认脱敏状态下统计：

```text
subsystem
category
process
事件数量
<private> 比例
事件频率
与明确用户动作的相关性
```

然后只挑少数候选做受控 private-data 实验。

对每个 subsystem 评价：

```text
事实纯度
覆盖率
正常日增量
系统稳定度
private-data 收益
隐私代价
```

---

## 11. 当前阶段裁决

本轮还没有得到“DCF 本地事实源已经定案”的结论。

但是已经得到几个稳定的阶段性认识：

### 已成立

1. **屏幕 / OCR 不适合作为基础事实源。**
2. **AX 是高价值低成本增益源，但覆盖率不能作为基础保证。**
3. **读取第三方 IDE / Agent 数据库可以很强，但依赖和适配厚度偏高。**
4. **macOS 文本输入系统存在比 AX / OCR 更接近用户输出本身的系统接缝。**
5. **当前观察到的 `<private>` 是 Apple Unified Logging 隐私脱敏，不是豆包字符串加密。**
6. **系统本身已经产生的结构化日志，比 DCF 自己重新监控现实更符合“低成本事实源”的方向。**
7. **Unified Log 值得被当作“事实源发现平面”继续勘探，但禁止全量同步。**

### 尚未成立

1. `com.apple.inputmethodkit` 的 subsystem-scoped private-data profile 是否能在当前 macOS 上真实输出文本明文；
2. 开启后 24×7 日增量和系统 I/O 是否仍满足 DCF 标准；
3. InputMethodKit 日志对不同 App / 不同文本提交路径的真实覆盖率；
4. 日志字段和事件语义跨 macOS 更新后的稳定性；
5. private data 的隐私暴露是否可以缩小到可接受边界；
6. 除 InputMethodKit 外，Unified Log 中是否还存在其他具有同等结构优势的低频高语义事实源。

因此当前最准确的定位是：

> **InputMethodKit + Unified Logging 已进入 DCF 本地事实源的 P0 杠杆候选，但必须先通过“明文可得、日增量可控、覆盖率足够、隐私边界可接受”四项实机门禁。**

---

## 12. 当前研究原则

这轮探索留下一个值得长期保留的方法论：

> **先寻找系统和成熟软件本来就在维护的事实，再考虑自己制造新的传感器。**

优先级：

```text
已有的低频结构化事实
>
事件驱动的轻量观察
>
高频原始传感流
```

DCF 不需要拥有“现实高清录像”。

它需要的是：

> **足够真实、足够便宜、足够长期，让未来还能重新进入当时语境的事实锚点。**
