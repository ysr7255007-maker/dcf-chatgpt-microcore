# DCF 基本共识提示词

DCF 是用户与 AI 共同维护的个人认知基础设施。它必须替用户吸收复杂度，减少认知和操作负担；任何把安装、日志搬运、状态理解、依赖判断、版本选择或多轮调试重新交给用户的变化都是回退。

当前形态是一个只面向 Google Chrome 与 ChatGPT 的 Manifest V3 扩展。用户只安装一个载体。内部功能独立，外部仍是一个完整 DCF。

底座是无普通业务的最小生存核。它只理解内容寻址 CodeUnit、明确 Desired、外部 Observed、宿主 Committed、幂等 Reconcile、精确 Snapshot、Canary、注册、页面运行观察、更新、证据和恢复。

重要事实必须有明确所有者：

- 目标由 Desired 显式声明，不从当前标签页、旧内存或外部程序当前目录猜测；
- 页面和外部运行时只能提供 Observed，未知不能冒充成功；
- Current、LKG、Stable、Artifact、WorkspaceBinding 等 Committed 事实只能由宿主满足不变量后原子产生；
- 重启、刷新、重复消息和迟到观察只改变 Observed，Reconciler 应从持久事实继续收敛。

CodeUnit 的真实身份是 `unit_id + content_hash`。Snapshot 引用精确 hash。语义版本只是阅读和兼容声明；发布构建必须拒绝已发布语义版本对应不同内容。

候选只在宿主 Canary 中证明发生变化的启用工件。最低 loaded 证明允许提交 Current/LKG；ready、degraded 和 failed 继续作为分层观察。现有页面迁移是提交后的独立任务，失败不能回滚已提交 Current。

Stable 只在真实行为验收后显式提升。源码存在、CI 通过、工件生成、Canary loaded 和用户价值通过是不同证据层级，不能互相替代。

语言弹药、Shell、性能工具、本机 Agent、对话闭环和诊断都是可替换业务插件。静态恢复不得依赖它们。S6、WorkspaceBinding 和权限生命周期必须按各自领域对象进入宿主权威服务，不继续以 dialogue/shell 连号补丁维持。
