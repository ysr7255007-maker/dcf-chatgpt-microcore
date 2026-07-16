# DCF Local Agent Bridge

这是 `dcf.next.local-agent` 的 loopback 本机执行端。它不实现 GitHub、终端或代码修改逻辑，只把网页任务绑定到配置好的本地工作区，并通过一个现有工具型 Agent 命令执行。

## 启动

1. 复制 `bridge/config.example.json` 为 `bridge/config.json`。
2. 将工作区路径改为本机绝对路径，并填写实际可用的 Agent 命令。
3. 运行：

```bash
node bridge/local-agent-bridge.js
```

进程只监听 loopback，并在终端打印本次进程有效的六位配对码。打开 DCF 的“本机”面板，输入配对码完成当前浏览器会话绑定。

## Agent 命令契约

Bridge 以工作区为 `cwd` 启动配置中的命令，并从 stdin 写入：

```json
{
  "schema": "dcf.local-agent.input.v1",
  "task_id": "...",
  "workspace_alias": "dcf",
  "workspace_path": "...",
  "task": {
    "schema": "dcf.local-task.v1",
    "instruction": "..."
  }
}
```

命令成功退出时，stdout 最好输出一个完整的 `dcf.local-result.v1` JSON。若 stdout 不是该 JSON，Bridge 会把 stdout 作为结果摘要回传。

## Echo 验证

将配置中的 Agent 改为：

```json
{ "mode": "echo" }
```

即可先验证配对、页面注册、任务提交和结果回填，不调用真实 Agent。

## 权限边界

- 工作区只能使用配置中声明的别名，网页不能提交任意本地路径。
- Bridge 不提供任意 Shell HTTP 端点。
- GitHub 登录、模型密钥、SSH Key 和 Agent 凭据只留在本机环境。
- 会话令牌只在 Bridge 进程生命周期和浏览器 `sessionStorage` 中存在，不写入 DCF 持久化备份。
