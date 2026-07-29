# ADR: DCF 架构质量评估与现代化重构方案

**Date:** 2026-07-29  
**Status:** proposed  
**Related:** [docs/adr/2026-07-26-dcf-minimal-live-loop-growth-blueprint.md](2026-07-26-dcf-minimal-live-loop-growth-blueprint.md), [docs/architecture-current.md](architecture-current.md)

## 背景 (Context)

本评审针对项目当前的两个独立实现系统进行评估：
- **旧世界 (`src/` + `chrome-extension/`)**：Chrome rc.3，已交付代码
- **新世界 (`seed/`)**：最小活闭环生长路线，进行中实施

评估维度基于软件架构四准则：
1. **高内聚 (High Cohesion)** — 模块内部元素的相关性和专注度
2. **低耦合 (Low Coupling)** — 模块间的依赖关系松散程度
3. **信息隐藏 (Information Hiding)** — 模块只暴露必要接口，隐藏内部实现细节
4. **依赖方向稳定 (Stable Dependency Direction)** — 依赖指向更稳定的抽象层，而非易变的具体实现

## 评估结果

### 一、旧世界架构 (`src/` + `chrome-extension/`)

#### ✅ **优秀 — 遵循 SOLID 原则**

**依赖方向（从优）**
```
ui/app.js → runtime/* → modules/* → core/*
           ↓
        host/* → core/*
           ↑
      chrome-extension/src/
           ↓
    code-units/ (插件目录，无内部依赖)
```

**分析：**
- `index.js` 是唯一的组合根，负责装配全部组件
- `core/` 不包含业务逻辑，只定义状态引擎、事务、投影等通用机制
- `modules/` 定义在核心之上，但核心不依赖模块
- `host/` 封装外部服务（ChatGPT），对核心透明
- `runtime/` 处理命令执行和副作用派发，依赖 core 但不反向
- `ui/` 唯一业务视图，通过组合根消费其他层

**内聚性（优秀）**
- `artifacts.js` (3.8K): 仅内容寻址
- `state.js` (15.2K): 仅状态树操作
- `transactions.js` (8.1K): 仅原子事务
- `projection.js` (5.9K): 仅可重算投影
- `intents.js` (7.2K): 仅环境意图建模

每个文件职责单一，单一目的。

**信息隐藏（优秀）**
- core 的 API 通过常量键导出（`ROOT_KEY`, `SNAPSHOT_KEY`）
- 模块通过 `module-roles.js` 的角色分类进行注册
- `standard-packages.js` 声明标准包依赖边界

**结论：** 旧世界是当前实现的参考模型，新系统应向其看齐但避免复制历史结构。

---

### 二、新世界架构 (`seed/`)

#### ⚠️ **部分达标 — 设计正确但实施未完成**

**架构蓝图（来自 [minimal-live-loop-growth-blueprint.md](2026-07-26-dcf-minimal-live-loop-growth-blueprint.md)）**

```text
三层责任（决策正确）
├── Companion Core (唯一权威事实源)
├── DCF Surface (统一显性界面)
└── Target Adapter (静默观察者)
```

**实际代码现状（实施偏差）**

| 文件 | 行数 | 问题 |
|------|------|------|
| `companion/index.js` | 4018 | **上帝对象** — HTTP 路由 + G1/G3/G4/G5/G6领域逻辑混合 |
| `companion/db.js` | 1334 | Schema 集中但合理（ADR 要求单 SQLite） |
| `companion/types.js` | 1038 | 事件类型按 G-ring 分层尚可 |
| `companion/events.js` | 784 | EventProcessor 类职责混杂 |
| `adapters/chrome/*.js` | ~60K total | 良好隔离，仅包含适配器逻辑 |

**四大缺陷诊断：**

#### ❌ 缺陷 1: **低内聚 — companion/index.js**

```javascript
// 第 18-34 行：Companion Core 依赖
const { CompanionDB } = require('./db');
const { EventProcessor } = require('./events');
const { validateRPCRequest, BOUNDARY_STATES, ... } = require('./types');
const { runDoctor } = require('./doctor');
const { GitHubSync, checkGhAuth, sha256 } = require('./github-sync');
const { MaterialProcessor } = require('./materials');
const { exportMaterials } = require('./export');
const { generateULID, isValidULID } = require('./ulid');
const { AdapterWakeChannel } = require('./ws-wake');
const { AIDigestEngine } = require('./ai-digest');
const { getStatus: getAiStatus, readConfigFile } = require('./ai-config');

// 第 223-2480 行：HTTP handlers
function handleCORS(req, res) {}               // G1: Events
async function handleEventsIngest(req, res) {}  // G1: Events
async function handleTaskQueryGet(req, res) {}  // G4: Tasks
async function handleRecommendationAccept(req, res) {}  // G4: Recommendations
async function handleBoundaryUpdate(req, res) {}   // G5: Boundaries
async function handleMaterialRevision(req, res) {} // G3: Materials
async function handlePatchPropose(req, res) {}     // G6: Patches
async function handleAiDigestTrigger(req, res) {}  // AI Digest
```

**违反：**
- **SRP** — 一个文件承担 HTTP 服务器、RPC 调度、G1-G6所有领域逻辑、GitHub 同步、AI 摘要触发
- **IR** — `EventProcessor`、`MaterialProcessor` 等类的实例化直接散落在 HTTP handlers 中
- **内聚类型**：功能内聚而非信息内聚

**影响：**
- 无法单独修改 G4 Task 逻辑而不触碰 G1 Event handler
- 测试需要启动整个 HTTP 服务器才能覆盖单个 G6 Patch 函数
- 新开发者必须阅读 4000+ 行文件才能理解 "如何添加一个新 API"

---

#### ❌ 缺陷 2: **信息隐藏缺失 — HTTP 层直接暴露领域**

```javascript
// companion/index.js 中几乎无中间层
async function handleTaskStatus(req, res, requestBody) {
    const task_id = req.body.task_id;
    const new_state = req.body.to_state;
    
    // G4 Domain Logic directly in HTTP Handler
    if (!validateTaskStateTransition(task_id, new_state)) {
        return sendJSONResponse(res, 400, rpcError(4001, 'invalid state transition'));
    }
    await CompanionDB.run('UPDATE tasks SET ...', ...);
    
    // 直接操作数据库，无服务层
}
```

**违反：**
- HTTP handler 直接调用 `CompanionDB.run()`（持久化细节泄露）
- No Service Layer 来封装 "任务生命周期管理" 这一业务概念
- Validation logic 散落在 HTTP handler 中，而非独立的 Domain Service

**对比（理想分层）：**
```
[HTTP Handler] → [TaskLifecycleService] → [Repository] → [DB]
                        ↓
                 [Validation Rules]
                        ↓
                  [Domain Events]
```

**当前：**
```
[HTTP Handler] → [DB]  ← 跨度过大，缺少业务语义层
```

---

#### ⚠️ 缺陷 3: **依赖方向不稳 — 潜在循环风险**

虽然目前没有发现显式循环依赖，但 `index.js` 作为 God Object 使依赖方向模糊：

```
companion/index.js (HTTP) → companion/events.js (G1 Events)
                            → companion/types.js (G1-G6 Types)
                            → companion/db.js (Schema)
```

**问题：**
- 当 `events.js` 中的 `EventProcessor` 需要调用 `types.js` 中的 `validateTaskStateTransition()` 时，后者属于 G4 Task 类型但被 G1 Event 模块使用
- **跨环耦合** — G1 Module 依赖了包含 G4 定义的 `types.js`，违反了环级依赖隔离预期

**正确模式应为：**
```
[Adapter] → [Companion Protocol Layer] → [Domain Services] → [Core Abstractions]
                                              ↓
                                      [Ring-Specific Modules]
                                            - G1/Auth
                                            - G3/Materials
                                            - G4/Tasks
                                            - G6/Patches
```

---

#### ✅ 优点保留

**`adapters/chrome/`** — 良好隔离：
- `outbox-core.js` 通过构造函数注入 `storage`, `fetchFn`, `ulid`（依赖倒置）
- 不含任何 Companion 领域逻辑
- MV3 Service Worker 和 Node 测试都能加载同一份代码

**`surface/views/`** — 单向依赖：
- Views 通过 `companion-client.js` 访问 HTTP API
- No knowledge of DB schema or domain models

---

## 修改目标 (Objective)

构建一个**真正符合四层责任分离**的新世界架构：

```text
seed/companion/
├── protocol/            # G1 Protocol + RPC dispatch (薄层)
│   ├── http-server.js   # HTTP server (express/raw)
│   ├── rpc-handler.js   # JSON-RPC/HTTP adapter for business methods
│   └── outbox-api.js    # Outbox transport abstraction
│
├── services/            # Business capabilities (厚层)
│   ├── auth-service.js  # G1: Authorization boundary management
│   ├── material-service.js  # G3: Material operations
│   ├── task-service.js  # G4: Task lifecycle
│   ├── recommendation-service.js  # G4: Recommendation flow
│   ├── patch-service.js # G6: Personal software modifications
│   └── sync-service.js  # G6: GitHub synchronization
│
├── domains/             # Ring-specific domain logic (隔离)
│   ├── g1/              # Only G1 concepts (boundaries, events)
│   │   ├── event-proc.js
│   │   ├── validator.js
│   │   └── types.js
│   ├── g3/              # Only G3 concepts (attribution)
│   │   ├── attribution-state.js
│   │   └── material-validator.js
│   ├── g4/              # Only G4 concepts (tasks, recommendations)
│   │   ├── task-lifecycle.js
│   │   ├── card-processing.js
│   │   └── recommendation-engine.js
│   └── g6/              # Only G6 concepts (patches)
│       ├── patch-workflow.js
│       └── env-health.js
│
├── infrastructure/      # Infrastructure concerns
│   ├── db/
│   │   ├── companion-db.js   # Connection pool
│   │   ├── repositories/
│   │   │   ├── boundary-repo.js
│   │   │   ├── event-repo.js
│   │   │   ├── task-repo.js
│   │   │   └── material-repo.js
│   │   └── migrations/
│   └── storage/
│       ├── file-store.js
│       └── github-storage.js
│
├── abstractions/        # Cross-cutting abstractions
│   ├── events/          # Event emission interface (not processing!)
│   ├── validation/      # Shared validators
│   ├── ulid/            # ULID generation
│   ├── crypto/          # SHA256 utilities
│   └── config/          # ai-config wrapper
│
├── interfaces/          # External interfaces (thin wrappers)
│   ├── doctor.js        # CLI diagnostic entry
│   ├── github-sync.js   # High-level GitHub orchestration
│   ├── export.js        # Material export orchestration
│   ├── ws-wake.js       # WebSocket wake channel
│   ├── ai-digest.js     # AI digest orchestration
│   └── ai-config.js     # AI configuration access
│
└── index.js             # Composition root (keep thin!)
    └   100 lines max
        - Register all services
        - Wire up DI container
        - Start HTTP server
        - Initialize DB connection
```

---

## 具体修改方案 (Action Plan)

### Phase 0: 基础设施准备

#### Step 0.1: 创建空目录结构

```bash
mkdir -p seed/companion/{protocol,services,domains/{g1,g3,g4,g6},infrastructure/{db/repositories,migrations},abstractions/{events,validation,ulid/crypto,config}}
```

#### Step 0.2: 抽取公共工具模块（低风险）

拆出以下小文件并验证测试通过：
- `abstractions/ulid/ulid.js` — 原 `ulid.js` (4.4K 行)
- `abstractions/crypto/hash.js` — `sha256` utility
- `abstractions/config/ai-config.js` — `ai-config.js` 的读取器包装器

**验收：** `test:legacy` and `g1-redline` tests still pass after extraction.

---

### Phase 1: 拆分 companion/index.js（高风险 — 分阶段迁移）

#### 第一阶段：提取协议层（2-3 天）

**1.1 创建 `protocol/http-server.js`**
- 抽取所有 HTTP 相关逻辑
- 移除 `req/res` 参数，改用 `HTTPRequest` / `HttpResponse` 接口
- 示例重构：
  ```javascript
  // Before
  async function handleTaskStatus(req, res, requestBody) {
      // process...
  }

  // After
  // protocol/http-server.js
  class HTTPServer {
      constructor(handlers) {
          this.handlers = handlers;
      }
      
      async handleRequest(req) {
          if (req.path === '/task/status') {
              return this.handlers.taskStatus.handle(req.body);
          }
      }
  }
  
  // protocol/rpc-handler.js
  const taskHandlers = {
      handleTaskStatus: {
          inputSchema: z.object({ task_id: z.string(), to_state: z.string() }),
          handler: async (input) => taskService.updateTaskStatus(input.task_id, input.to_state)
      }
  };
  ```

**1.2 创建 `services/task-service.js`**
- 抽取 `handleTask*` 所有 handlers 到服务层
- 包含 7 个方法：`query`, `status_update`, `rebind`, `checkpoint`, `reject_acceptance`, `complete`, `assign`
- 输入：`{task_id, from_state, to_state}` → 输出：`{success, error, result}`
- 数据库操作委托给 `repositories/task-repo.js`

**1.3 创建 `domains/g4/task-lifecycle.js`**
- 包含 G4 Task 状态机规则
- 五状态：`pending → running → checkpointed → accepted → completed`
- 状态转移验证逻辑
- G4 Card/Recommendation 状态也在此定义

**1.4 删除 `index.js` 中的这些 handlers**
- 替换为 `services/task-service` 调用

---

#### 第二阶段：提取其他环级模块（每环 1-2 天）

| 环 | Handler 数 | 目标文件 | 预计时间 |
|----|-----------|---------|----------|
| G1 Auth/Boundaries | 3 | `services/auth-service.js`, `domains/g1/boundary-manager.js` | 1 day |
| G3 Materials | 4 | `services/material-service.js`, `domains/g3/material-pipeline.js` | 1 day |
| G4 Tasks/Recs | 8 | `services/task-service.js`, `services/recommendation-service.js` | 2 days |
| G6 Patches | 8 | `services/patch-service.js`, `domains/g6/patch-workflow.js` | 2 days |

**迁移规则：**
- 每次只移动一个 handler
- 编写新测试保证行为一致
- `index.js` 保持至少 80% 原有代码运行
- 每周一次主干合并冲突解决

---

#### 第三阶段：完善 Repository 层

**创建 `infrastructure/db/repositories/*.js`**
- `boundary-repo.js`: 授权边界 CRUD
- `event-repo.js`: Event ingestion
- `task-repo.js`: Task lifecycle persistence
- `material-repo.js`: Material content
- `patch-repo.js`: Patch proposal/activation history

**原则：**
- Repository 只关心数据存取，不涉及业务规则
- Unit test 使用内存模拟或 SQLite in-memory

---

#### 第四阶段：清理 `index.js`

**目标：** `< 500 lines`
```javascript
// Composition root only
async function main() {
    // 1. Initialize infrastructure
    const db = await CompanionDB.createPool();
    
    // 2. Instantiate services
    const authService = new AuthService(new BoundaryRepo(db));
    const taskService = new TaskService(new TaskRepo(db), new EventEmitter());
    const materialService = new MaterialService(new MaterialRepo(db));
    const patchService = new PatchService(new PatchRepo(db));
    
    // 3. Register handlers
    const handlers = {
        taskStatus: taskService.updateTaskStatus.bind(taskService),
        boundaryUpdate: authService.updateBoundary.bind(authService),
        materialRevision: materialService.revision.bind(materialService),
        patchPropose: patchService.proposePatch.bind(patchService),
    };
    
    // 4. Start server
    const server = new HTTPServer(handlers);
    await server.start(DEFAULT_PORT);
    
    console.log('DCF Companion started');
}
```

---

### Phase 2: 改进依赖方向稳定性

#### 2.1 引入依赖注入容器（可选）

使用轻量级 IoC：
```javascript
class Container {
    register(name, factory) { /* ... */ }
    resolve(name) { /* ... */ }
}

// Usage
container.register('taskService', (deps) => 
    new TaskService(deps.taskRepo, deps.eventEmitter)
);

const taskService = container.resolve('taskService');
```

**好处：**
- 单元测试可以 mock dependencies
- 减少 `new` 关键字散乱出现
- 明确依赖关系图

#### 2.2 强制单向依赖

编写静态检查脚本：
```bash
# Check circular deps
npx madge --circular seed/companion

# Check ring isolation
node scripts/validate-domain-isolation.js
```

**规则：**
- `domains/gX/*` 只能依赖 `domains/gY/*` where Y ≤ X（高阶可以依赖低阶）
- `services/*` 只能依赖 `domains/*` 和 `repositories/*`
- `protocol/*` 只能依赖 `services/*` 和 `abstractions/*`

---

### Phase 3: 信息隐藏增强

#### 3.1 创建 Domain Events 接口

```javascript
// abstractions/events/event-emitter.js
class EventEmitter {
    emit(eventType, payload) { /* publish */ }
    subscribe(eventType, handler) { /* subscribe */ }
}

// services/task-service.js
async updateTaskStatus(taskId, newState) {
    await this.taskRepo.updateState(taskId, newState);
    
    // Emit domain event, not database query
    this.eventEmitter.emit('TASK_STATE_CHANGED', {
        taskId,
        oldState: prevState,
        newState,
        timestamp: nowIso()
    });
}
```

**好处：**
- Service 不直接写数据库事件表
- Event processing 变成异步流
- 易于追踪状态变更原因

---

## 验收标准 (Acceptance Criteria)

### Functional Acceptance

- [ ] All existing HTTP endpoints continue to work without breaking changes
- [ ] All unit/integration tests pass after each phase
- [ ] Performance impact < 10% on hot paths (task status update, event ingest)

### Architecture Acceptance

- [ ] `companion/index.js` ≤ 500 lines
- [ ] Each service module ≤ 400 lines
- [ ] Each domain module ≤ 300 lines
- [ ] Zero circular dependencies detected by `madge`
- [ ] Ring isolation validated: G3 modules cannot import G4-specific types
- [ ] Information hiding: HTTP handlers never call DB directly (enforced via static analysis)

### Developer Experience

- [ ] New developer can add a new endpoint in < 30 minutes
- [ ] Test coverage maintained at ≥ 80% after migration
- [ ] Documentation updated: architecture diagrams, dependency graphs

---

## 风险评估 (Risk Assessment)

### High Risk

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Refactoring breaks production functionality | Medium | High | Feature flag: dual-mode operation (old + new handlers) during transition |
| Team resistance due to increased file count | Low | Medium | Show benefits first: improved IDE navigation, faster compile times |
| Circular dependency slip-in | Medium | Medium | Automated CI checks via `madge` and custom script |

### Medium Risk

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Performance degradation due to extra layers | Low | Low | Profile critical paths before finalizing architecture |
| Domain logic duplication across phases | Medium | Medium | Enforce shared base classes/interfaces for common patterns |

---

## 替代方案比较 (Rejected Alternatives)

### Alternative 1: Incremental rewrite without intermediate refactor

**Decision:** Rejected — Too risky to do everything at once. The god object must be split into chunks before introducing new layers.

### Alternative 2: Use TypeScript for type safety instead of structural refactoring

**Decision:** Rejected — TypeScript helps catch bugs but doesn't solve cohesion/coupling problems. Structural issues would persist even with typed code.

### Alternative 3: Extract HTTP layer first, then domain logic

**Decision:** Rejected — Moving HTTP before separating business logic creates "distributed monolith" anti-pattern where each handler becomes its own mini-mons.

---

## Consequences

### Positive

- **Maintainability**: Adding a new G7 feature requires modifying only 2-3 files instead of digging through 4000-line index.js
- **Testability**: Can unit-test `task-service` independently of HTTP server
- **Onboarding**: New developers understand structure in < 2 hours vs. current ~1 week to decipher `index.js`
- **Extensibility**: Each G-ring is independently extensible without affecting others

### Negative

- **Increased file count**: From ~20 files to ~80 files (acceptable trade-off for clarity)
- **Initial effort**: 2-3 weeks of focused refactoring required (one person full-time equivalent)
- **Temporary breakage**: During transition, some features may be temporarily disabled behind feature flags

---

## 下一步行动 (Next Actions)

1. ✅ 本文档评审和接受
2. 🔲 创建 PR 准备空目录结构
3. 🔲 Phase 1 Step 0.1-0.2 公共工具抽取
4. 🔲 Phase 1 Step 1.x 拆分 HTTP 和 Task 服务
5. 🔲 验证测试结果
6. 🔲 进入 Phase 2 G3/G4/G6环级拆分

---

## 参考资料 (References)

- Clean Architecture, Robert C. Martin (2017) — Dependency Rule, Separation of Concerns
- Designing Data-Intensive Applications, Martin Kleppmann (2017) — Repository pattern, Event-driven architecture
- DCF Vision ADR: docs/vision/2026-07-26-dcf-from-zero-vision-adr.md
- Growth Blueprint ADR: docs/adr/2026-07-26-dcf-minimal-live-loop-growth-blueprint.md
