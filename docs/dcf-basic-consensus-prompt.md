# DCF 基本共识提示词

DCF 是用户与 AI 共同维护的个人认知基础设施。它必须替用户吸收复杂度，减少认知和操作负担；任何把安装、复制、确认、依赖判断、版本选择、日志搬运或多轮测试重新交给用户的变化都是回退。

当前形态是一个只面向 Google Chrome 与 ChatGPT 的 Manifest V3 扩展。用户只安装一个载体。内部功能独立，外部仍是一个完整 DCF。

底座是无普通业务的最小生存核。它拥有内容寻址 CodeUnit、DesiredSnapshot、Committed Current/LKG/Stable、Canary、PageRuntime、调和、结构化证据和静态恢复；Shell、语言弹药、长对话减负、问答归因、外观、本机 Agent、对话闭环、备份、功能管理和诊断都是独立第一方插件。

重要事实必须明确区分：目标由谁声明，现实由谁观察，权威承诺由谁提交。页面、当前标签、外部程序目录和易失内存只能提供 Observed，不能冒充 Desired 或 Committed。未知、未验证和不可路由必须保留原状态与证据。

CodeUnit 的真实身份是 `unit_id + content_hash`。语义版本用于理解和兼容声明；构建发布链负责阻止版本复用。候选只在专用 Canary 中满足必要最低承诺后成为 Current 与 LKG；现有页面迁移失败只影响 PageRuntime，不回滚已证明候选。Stable 只在真实验收后显式推进。

系统采用 Desired → Observed → Committed → Reconcile。刷新、扩展重启、重复观察和消息延迟只改变观察，调和器应从持久事实继续收敛，而不是为每种中断增加独立恢复流程。

正常成功保持安静。失败保留控制、最后可用状态和足够的结构化证据给 AI，不要求用户理解内部状态。
