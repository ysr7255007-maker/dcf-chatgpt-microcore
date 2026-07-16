# DCF 编译启动快照浏览器验收单

## 隔离

1. 停用 `DCF ChatGPT Next Core Review`。
2. 暂时停用完整捆绑审查版，但不要卸载。
3. 同一时间只启用一份 `DCF ChatGPT Next Snapshot Review`。

## A. minimal 快照

安装 `dcf-chatgpt-next-snapshot-minimal.user.js`。

应确认：

- 页面出现 DCF Shell；
- 启动组合只有 Shell、ChatGPT、插件管理器和维护诊断；
- userscript 不请求 localhost 权限；
- 刷新后启动组合和插件私有存储保持；
- 当前脚本能够进入安全模式并返回正常组合。

## B. standard 快照

安装 `dcf-chatgpt-next-snapshot-standard.user.js`。它与 minimal 使用相同 userscript 身份，应替换当前快照而不是并行安装第二套 DCF。

应确认：

- 语言弹药、长对话减负、性能归因、外观和备份出现；
- Local Agent 不存在；
- userscript 仍不请求 localhost 权限；
- minimal 阶段写入的同插件数据仍然可见；
- 新建一枚测试弹药并刷新后仍然存在。

## C. complete 快照

安装 `dcf-chatgpt-next-snapshot-complete.user.js`。

应确认：

- Local Agent 作为普通插件出现；
- localhost 权限只在该快照存在；
- 本机 Bridge 未运行时，Local Agent 显示未连接但不触发生存盒恢复；
- standard 阶段的数据继续存在。

## D. Echo

启动 Local Agent Bridge 的 Echo 模式，完成：

```text
当前网页任务
→ Local Agent 插件
→ 本机 Bridge
→ Echo 结果
→ 当前输入框
```

确认结果返回发起任务的同一页面。

## E. 回滚

重新安装 minimal 或 standard 快照，确认：

- Local Agent 从运行组合消失；
- 其他插件数据不被删除；
- 不需要清理代码库存储或动态模块状态；
- Tampermonkey 安装的完整快照就是当前真实代码组合。

每一步记录版本、启动清单、诊断、页面现象和控制台错误。不能以“看起来正常”代替状态证据。
