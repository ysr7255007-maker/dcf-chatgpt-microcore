# ADR: DCF GitHub App Bot 身份与治理边界

Date: 2026-07-19  
Status: automated verification complete, real GitHub App creation and installation pending user acceptance

## Context

DCF Local Agent 已具备通过 OpenCode HTTP API 创建会话、执行任务、检查和操作文件的能力。下一步，Local Agent 需要直接在 GitHub 仓库中创建分支、提交和 PR，而用户的个人 GitHub 账号负责审查、Approve 和 Merge。

这要求一个专用的 GitHub App Bot 身份，代理身份可以与用户审查身份严格分离。

关键约束：

- Bot 不得拥有 workflow 和 administration 权限；
- Bot 私钥只应存在本机用户配置目录，不得进入仓库；
- PR 与 CI 是代码修改的默认治理闭环；
- 用户始终保留审批权，Bot 不能绕过审批；
- 首次引导提交（Bot 建立前的文件修改）使用用户身份，是唯一的例外。

## Decision

1. **Bot 身份独立**：创建一个专用的 GitHub App（DCF Local Agent Bot），作为本地 Agent 的实现身份。它与用户个人 GitHub 账号完全独立。

2. **最小权限原则**：
   - `contents: write` — 创建分支和提交；
   - `pull_requests: write` — 创建和管理 PR；
   - `actions: read`、`checks: read`、`statuses: read` — 读取 CI 状态供 Agent 判断；
   - 不申请 `workflows` — Bot 不能修改工作流定义；
   - 不申请 `administration` — Bot 不能修改仓库设置或分支保护；
- Webhook 不激活 — Bot 不需要事件推送，使用拉取式查询。
  - Manifest 仍提供一个合法完整的 loopback `hook_attributes.url`，但 `active: false` 且 `default_events: []`；它不是事件接收端。

3. **凭据安全**：
   - 私钥（PEM）只保存在本机用户配置目录（macOS: `~/Library/Application Support/DCF/github-bot/`）；
   - 目录权限 0700，私钥和 secret 文件权限 0600；
   - 安装令牌（installation token）仅在验证时临时生成，不持久化；
- 私钥、client_secret、webhook_secret 不在终端、网页、日志或测试输出中显示。
   - 敏感文件使用拒绝符号链接、0600 随机独占临时文件、同步和原子 link（NOREPLACE 语义，目标存在时原子失败）的事务写入，提交后清理临时文件；出现失败会清理临时/半成品文件。

4. **仓库内不保存敏感信息**：
   - `.gitignore` 只添加注释说明；
   - 非敏感机器可读配置模板（`bot-config.json`）仅包含 App ID、slug、Installation ID、仓库名、私钥路径和权限验证摘要；
   - 实际私钥和凭据文件完全在仓库之外。

5. **治理闭环**：
   - Bot 负责创建分支、提交代码和创建 PR；
   - 用户账号负责审查代码、Approve 和 Merge；
   - 候选分支（`rebuild/chrome-native-host-v2`）可通过用户管理身份配置分支保护规则；
   - 分支门禁使用用户管理身份配置，不把管理权限永久给 Bot；
   - 首次引导提交使用用户 GitHub 凭据，是建立 Bot 前的唯一例外。

6. **首次引导提交例外**：Bot 建立前的初始代码修改（GitHub App Manifest 创建、向导实现、ADR 等）使用当前用户 GitHub 凭据创建 PR。Bot 建立后，所有后续 git 操作由 Bot 身份完成。

7. **PR 是默认入口**：所有代码修改默认通过 PR 进入，由用户审查和批准。Bot 不直接推送到保护分支。

## Consequences

- Local Agent 获得可编程的代码操作能力，无需共享用户个人凭据；
- 用户始终掌握审批权，Bot 不能绕过审批；
- 凭据泄露的影响范围仅限于创建分支、提交和 PR，不能修改设置或工作流；
- 首次引导提交后，所有 Agent 发起的更改通过 Bot 身份进行，可审计可追踪；
- 分支保护规则需要用户个人身份（PAT）配置，Bot 身份不获得管理权限；
- 初始化向导是本机工具，不持有网络服务、不监听局域网。

## Acceptance

- 自动化测试验证 Manifest 权限集合不包含 workflow 和 administration；
- 自动化测试验证私钥文件权限 0600、目录权限 0700；
- 自动化测试验证凭据不进入仓库；
- 自动化测试验证安装令牌不持久化；
- 自动化测试验证 CSRF state 保护；
- 自动化测试验证 /app 和 /app/installations/{id} 使用 JWT，installation token 只用于仓库和 ref 操作；
- 自动化测试验证原子写入使用 linkSync NOREPLACE 语义，不会覆盖已有目标；
- 自动化测试验证已完成安装验证的向导服务器自动关闭；
- 自动化测试验证 pending-install 状态的保存、恢复、同 installation 重试和不同 installation 拒绝；
- 自动化测试验证完整无网络状态机（manifest 回调 → 凭据保存 → JWT 身份验证 → 限定 installation token → 仓库/ref 验证 → 完成页 → 服务关闭）；
- 实际操作验证：待用户通过向导完成从创建 GitHub App 到安装并验证权限的全流程。真实 GitHub App 创建、manifest 接受与安装仍待用户在本机向导现场完成。自动化验证不宣称已创建真实 App。

## Rejected alternatives

- 使用用户个人 GitHub Token：共享用户身份，无法区分 Agent 操作和用户操作，审计不清晰；
- 使用 SSH 部署密钥：只支持单仓库只读或读写，不支持创建 PR 和读取 CI 状态；
- 使用 OAuth App：不提供独立的 Bot 身份和安装粒度；
- 将私钥放入仓库加密存储：增加复杂性和密钥分发问题，私钥应保持在最小可访问范围内。
