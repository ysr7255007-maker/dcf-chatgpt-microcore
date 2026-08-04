# ADR：从“权限开放”转向 macOS 原生公共能力黑洞勘探

日期：2026-08-05  
状态：当前有效的阶段性架构裁决

关联：

- `docs/spec/2026-08-04-DCF-当前实施规范.md`
- `docs/spec/2026-08-05-DCF-macOS-AI实验宿主规范.md`
- `docs/adr/2026-08-05-macos-ai-host-capability-policy.md`
- `docs/adr/2026-08-05-macos-local-fact-source-probe.md`

---

## 1. 背景

上一阶段的核心问题是：

> 专用 AI Mac 的系统保护会不会持续让 DCF 的研究方向被权限边界带歪？

2026-08-05，1TR / Boot 级能力开放完成，用户提供的正常 macOS 重启后独立复核报告状态为 `behavior_passed`。

SIP、Permissive Security、CTRR、boot-args filtering、第三方 kext 能力、SSV / authenticated-root、Research Guests 等目标状态已经同时成立，同时没有实际安装 kext、custom kernel、custom BootKC、系统卷 patch 或实验 boot-args。

因此旧问题已经发生变化：

```text
以前
→ 机器是否允许我们看见真实能力边界？

现在
→ 机器已经允许以后，哪些能力根本不应该由 DCF 自己重新实现？
```

---

## 2. Decision — 机器能力层暂时退出主要架构争论

当前不再把“继续解锁更深权限”作为主线。

以后遇到能力失败，优先判断：

```text
能力本身不存在
接口语义理解错误
当前 macOS 行为不同
TCC / entitlement 等独立授权边界
实现方式错误
候选结构本身不成立
```

而不是重新把 SIP / SSV / CTRR 当默认解释。

只有真实实验重新证明权限边界是阻塞时，才重新打开对应问题。

---

## 3. Decision — 从 API 调研改为公共能力黑洞勘探

本阶段不按 API 清单逐个打勾。

研究从 DCF 的现实需求出发，再反向寻找 macOS 已经长期维护的公共结构。

重点不是：

```text
FSEvents 能做什么
Endpoint Security 能做什么
XPC 能做什么
```

而是：

```text
文件世界
活动时间
用户表达
机器 Effect
生命周期
跨 App 行动
```

这些 DCF 岗位中，有多少可以由少数系统公共面共同吸收。

真正高价值的候选应该改变问题成立条件，例如：

```text
系统已经维护文件变化历史 + 当前索引
→ DCF 不再需要一套全盘 watcher + 普通文件索引

系统已经维护跨进程现实动作面
→ DCF 不再给每个 Agent 重新制造一套“我做了什么”的观察器
```

---

## 4. Decision — 系统拥有现实，DCF 拥有认知

这是当前边界的核心表达。

macOS 可以成为以下事实的权威或主要观察来源：

```text
文件 / 进程 / App 的系统身份
文件变化
当前索引
进程生命周期
文本客户端最终提交
机器动作
系统级动作接口
睡眠 / 唤醒 / 前台活动
```

DCF 不把这些系统事实重复维护成第二份同义权威状态。

但 macOS 不拥有：

```text
用户目标
项目归属
长期问题
认知关系
当时理解
后来理解
理解为什么发生转变
```

因此系统公共能力越强，DCF 自己理论上越应该变薄，而不是反过来把操作系统事件模型变成新的认知模型。

---

## 5. Decision — 必须研究组合，而不只评价单项 API

即使多个候选单独都很好，如果组合后需要：

```text
大量自定义 ID 映射
重复 watcher
双写状态
多份“当前运行事实”
来源之间互相猜测
```

整体仍然不是黑洞架构。

因此每组推荐能力必须画出事实所有权：

```text
谁拥有事实
谁只观察
谁缓存
谁推进
谁恢复
```

并与既定 DCF 结构共同评价：

- 持久事实 / 认知层；
- Becsy / ECS 活动世界；
- 成熟 Agent Runtime；
- DCF 自研执行核；
- Logical Operation / Physical Execution；
- Effect Projection。

---

## 6. Decision — Plan 模式只有战术规划权

本阶段采用：

```text
任务书
→ 一次 Plan 模式现场勘探
→ 直接执行
```

原因：本地 AI 最接近真实 macOS，可以发现当前系统版本上的新候选、安排实验顺序和用最小探针优先否决弱路线。

但 Plan 不得重新决定：

```text
DCF 是什么
认知关系边界
Becsy / ECS 的既定岗位
成熟 Agent Runtime 与自研执行核的并存关系
是否重新关闭 / 开启 SIP
项目价值目标
```

除非发现任务书关键事实错误、机器状态严重不一致、会不可逆修改系统本体或需要改变事实所有权，否则 Plan 完成后不进行第二轮无限规划。

---

## 7. Plan 勘探的新发现

本地只读 Plan 已经加入三个值得运行验证的新方向。

### 7.1 CoreDuet / KnowledgeC

发现系统已有 App usage、屏幕亮灭等活动分段。

这可能与 NSWorkspace 形成：

```text
实时活动通知
+
系统保存的活动历史
```

从而吸收来源级 session detector。

但它依赖系统私有数据库 / schema 的厚度尚未裁决，因此当前只是候选，不是正式底座。

### 7.2 Spotlight 使用型元数据

`kMDItemLastUsedDate`、`kMDItemContentModificationDate`、`kMDItemWhereFroms` 等可能补充“什么被使用过 / 从哪来”的辅助事实，不需要 DCF 单独维护同义状态。

### 7.3 eslogger 作为 Endpoint Security 探针

Apple 已签名的 `eslogger` 可以先证明系统是否存在跨 Agent 的统一机器动作面。

但正式 DCF 自建 Endpoint Security 客户端仍受 entitlement / 分发边界影响。

因此必须把：

```text
ES 系统能力成立
≠
DCF 正式接入成立
```

写成两个独立裁决。

---

## 8. IMK 阶段认知更新

旧 `2026-08-05-macos-local-fact-source-probe.md` 记录当时尚未证明 subsystem-scoped private-data profile 能否得到真实 InputMethodKit 明文。

后续本地 Plan 已报告：

- `com.dcfprobe.logging-imk-private` 已系统级安装；
- `insertText / setMarkedText` 明文已经在 TextEdit / ChatGPT 路径被动观察到；
- 普通打字与 Fn 语音均有成功证据。

因此旧 ADR 中“明文是否可得”这一未决项已经出现新的后续证据。

按照 DCF 的追加式叙事原则：

> **不回写旧 ADR 让它假装当时已经知道答案；在本 ADR 追加记录“后来已经出现明文成功证据”。**

仍未解决：覆盖率、长期成本、掉线补读、字段稳定性与正式架构准入。

---

## 9. Consequence — 当前实验结构

正式执行分为：

```text
E1 用户文字事实
E2 文件世界
E3 活动时间骨架
E4 Agent Effect / Receipt
E5 生命周期
E6 跨 App 行动
E7 Unified Log 矿藏普查
```

E1 的长时间窗口不得成为全局串行阻塞：启动采样后继续其他独立实验。

所有实验通过真实证据定级：

```text
A 正式公共底座
B 辅助能力
C 探真 / 研究仪器
D 来源专用适配
E 淘汰
unverified
```

---

## 10. 当前裁决

> **宿主开门阶段已经结束。下一阶段不是继续向更底层钻，而是系统性寻找 macOS 已经替我们维护的公共现实面，并验证这些能力组合后能否从源头删除 DCF 自己的 watcher、connector、index、daemon、状态机和同步关系。系统越能可靠拥有现实，DCF 就越应只保留认知、语义任务和长期关系。**
