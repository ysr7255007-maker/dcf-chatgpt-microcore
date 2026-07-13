# DCF 期望对话环境架构 To Do List

Updated: 2026-07-13

目标：不推翻 0.12.0 的单根事务、能力包与 Runtime 体检基础，将 DCF 连续收拢为“对话驱动的个人认知环境回流运行时”。

## 阶段 1：Environment Facade

- [ ] 从现有 `dcf.state.root.v1` 和 registry 推导统一的 `dcf.environment.snapshot.v1`。
- [ ] Snapshot 明确表达能力构成、用户认知资源、环境政策、产品组织、来源与 Runtime 投影。
- [ ] 不新增第二权威状态，不迁移用户数据。
- [ ] 包管理、维护和 Runtime API 开始读取同一 Environment Snapshot。

验收：当前全部长期行为都能被解释为期望对话环境的一部分。

## 阶段 2：统一 Intent 模型

- [ ] 定义有限的 `dcf.intent.v1` 顶层语义。
- [ ] 对话工件、包管理按钮、弹药增删、设置修改、角色修改和回滚都编译为 typed intent。
- [ ] 环境变化 Intent 与一次性 Action Intent 保持不同失败语义。

验收：同一种用户意图只有一个正式语义，不因入口不同而改变。

## 阶段 3：Environment Reconciler

- [ ] 将 Package Reconciler 提升为 Environment Reconciler。
- [ ] Artifact 先编译为 Intent，再形成候选环境迁移。
- [ ] 包安装、启停、revision 切换、用户资源增删、政策修改、Profile 激活和恢复共用一条计划、验证、提交、重投影链路。
- [ ] 失败时旧根保持不变。

验收：所有持久环境变化只有一条正式迁移路径。

## 阶段 4：统一 Resource Compiler

- [ ] 为 content、action、view、style、policy/setting 建立有限资源族。
- [ ] 统一资源身份、提供者、替换/扩展、冲突、投影目标和观察契约。
- [ ] registry 输出资源图和来源所有权。

验收：新增同类能力主要通过增加资源表达，不新增平行子系统。

## 阶段 5：统一环境视图

- [ ] 弹药、功能、包管理、维护都成为包拥有的声明式 View Resource。
- [ ] Core 只保留 View 宿主、安全组件、Intent 发射和最低恢复渲染。
- [ ] 页面标签、排序、说明和投影类型由包 revision 更新。

验收：页面是同一环境的内容、行动、构成、观察投影，不再拥有私有业务状态。

## 阶段 6：Environment Profile、迁移与恢复

- [ ] 增加环境 Profile：保存包选择、政策和产品组织，不复制用户弹药正文。
- [ ] Profile 激活、历史快照恢复和旧数据迁移统一解释为环境迁移来源。
- [ ] 维护页提供保存、激活和删除 Profile 的低频入口。

验收：工作模式切换、实验环境和历史恢复不需要新建独立工作区系统。

## 全局约束

- [ ] `dcf.state.root.v1` 继续是唯一权威状态。
- [ ] GM storage 继续是唯一权威写后端。
- [ ] 外部 Effect 不进入环境事务。
- [ ] 用户内容与包默认定义继续分离。
- [ ] 临时 UI session 不进入权威根。
- [ ] 不执行远程 JavaScript，不使用 eval。
- [ ] Runtime 体检保持独立观察，不复用被检查投影的同一结论函数。
- [ ] 每阶段均有回归测试，最终通过 `npm run verify` 与 userscript 语法检查。
