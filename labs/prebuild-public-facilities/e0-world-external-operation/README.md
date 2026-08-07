# E0 — World × 外部异步能力接缝实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§4。

## 研究问题

AI API、ACP Agent、数据库查询、外部 Probe 的执行发生在 World 外，但其运行身份、
生命周期与结果能否统一由 Becsy World 管理，而不为每类外部能力另造一套生命周期？

## 结构

```text
World (Becsy)
 ├─ ExternalOperation Component   # 领域稳定 opId、状态机、lease、结果应用计数
 ├─ OperationDrain System         # 唯一写者：intake/cancel/action/事件守卫/lease 监管
 └─ OperationReadback System      # 只读快照（entitlement 自动排在写者之后）
        ▲              │
        │ events       │ commands (outbox)
 OperationGateway（有界事件队列 + 背压 + 可观察计数）
        │              ▼
 ExternalExecutor 接口（唯一）
  ├─ SyntheticWorker       # 14 场景故障注入剧本
  ├─ HttpTurnExecutor      # 真实异步 AI HTTP Turn（provider 无关）
  └─ AcpSessionExecutor    # 真实 ACP Agent Session（SDK 编解码）
```

关键纪律：

- World 主循环只做内存队列操作；外部 I/O 命令在帧之间交付（G1）；
- 取消、去重、迟到、死亡全部由 Drain 集中裁决，执行器不拥有生命周期（G2）；
- 长期身份只用领域稳定 opId，entity 句柄每帧重建（G6）；
- 核心四文件零 provider 字符串（G7，源码扫描测试）。

## 运行

```bash
bun install
bun test tests/                 # 20 tests：14 场景 + G1/G6/G7 + R1/R2/G2
```

R1/R2 需要：`../../.env.local` 中的凭据（不入库）与本机已登录的 Codex CLI。
R2 使用实验隔离的 `scratch/codex-home-e0`（原因见 failures.md F1）。

## 结果

两次独立完整复跑：20/20 PASS。裁决见 [decision.md](./decision.md)。
