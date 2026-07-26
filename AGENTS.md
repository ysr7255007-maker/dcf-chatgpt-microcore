# DCF (Dialog Control Framework)

## 项目定位

DCF（Dialog Control Framework）是用户与 AI 共同维护的个人认知基础设施。

## 目录结构

- `src/core/` — 核心引擎（artifacts、constants、state 管理）
- `chrome-extension/` — Chrome 扩展（background、content scripts、UI pages）
- `scripts/` — 构建与发布脚本
- `tests/` — 单元与集成测试

## 常用命令

```bash
npm run build:chrome   # 构建 Chrome 扩展
npm run test:chrome    # 运行 Chrome 测试
npm run verify         # 完整验证：构建 + 测试 + 检查
```

## 风险边界

- **不可变代码单元**不应直接编辑，应通过构建流程更新。Do not directly edit immutable code units.
- **真实浏览器验收**仅限 controlled interface 进行。Never perform uncontrolled production validation.
- 修改风险边界前应先 review 相关 ADR。

## 修改后验证

每次修改后必须运行针对性验证，确保改动不破坏现有行为：

- **修改 Chrome 扩展代码** → 运行 `npm run test:chrome`（11 个测试）
- **修改核心引擎代码** → 运行 `npm run test:legacy`（23 个测试）
- **涉及构建流程** → 运行 `npm run verify`（构建 + 测试 + 检查）

仅当改动经过验证确认通过后，才能标记为完成。Run targeted tests after every modification.

## 决策规则

- **ADR 优先**：修改架构前应查阅最新 ADR。Check the latest ADR before architecture changes.
- Prefer consulting existing ADR rather than guessing architecture intent.
- When in doubt, review the `docs/adr/` directory.

## 渐进式披露路由

DCF 采用渐进式披露：本文件是默认加载的唯一入口，更深层的文档按需查阅，避免一次性加载全部上下文。动手前按下表匹配触发场景，按需加载对应文档。Load deeper documentation on demand, not upfront.

### 加载规则

| 触发场景 | 加载文档 | 说明 |
|---|---|---|
| 修改架构、判断方案或评估风险边界前 | [docs/adr/status-index.md](docs/adr/status-index.md) | 先查 ADR 状态索引，按索引指向阅读相关 ADR，再决定是否展开 `docs/adr/` 中的具体条目 |
| 新 AI 窗口接入 DCF、执行维护任务、诊断运行时故障、决定能力归属或准备发布 | [docs/skills/dcf-maintenance-skill.md](docs/skills/dcf-maintenance-skill.md) | 维护技能协议，定义维护 DCF 时的操作规范 |
| 执行或验证 Chrome 原生宿主发布线 | [docs/taskbooks/](docs/taskbooks/) | 任务书，记录历史执行结果与当前规范执行记录 |
| 需要建立共识认知或插入认知提示 | [docs/prompts/](docs/prompts/) | 常驻认知提示词与共识插入指南 |
| 需要确认当前运行态或能力矩阵 | [docs/current-state.md](docs/current-state.md)、[docs/acceptance-matrix.md](docs/acceptance-matrix.md) | 当前状态与验收矩阵 |

### 加载顺序约定

1. **默认只读本文件**：日常编码、测试、构建命令以本文件为准。
2. **先索引后展开**：查 ADR 时先读 `status-index.md`，再按需读单条 ADR；不要一次性加载整个 `docs/adr/` 目录。
3. **维护任务先读技能**：任何涉及 DCF 维护语义的任务，先读维护技能，再按其指引展开其他文档。
4. **任务书仅用于发布线追溯**：不作为日常编码参考，仅在执行或验证 Chrome 原生宿主发布线时加载。
