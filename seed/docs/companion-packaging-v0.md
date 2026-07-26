# Companion Packaging v0 — G2 出口条件证据文档

> 任务：G2 出口条件——companion 自带运行时打包 + launchd 自动启动/恢复 + doctor 自愈。
> 环境：macOS 26.5.2 (darwin/arm64)，Node v22.22.3，仓库 HEAD 基线 951fab9。
> 日期：2026-07-26。

## 1. 交付物总览

| 交付物 | 路径 | 状态 |
|---|---|---|
| SEA 构建脚本 | `scripts/build-companion-sea.js` | ✅ 真实构建成功 |
| SEA 可执行产物 | `dist/dcf-companion`（gitignored） | ✅ 107 MB，独立运行 |
| launchd 模板 | `seed/companion/launchd/com.dcf.companion.plist` | ✅ plutil-lint OK |
| 安装/卸载脚本 | `seed/companion/launchd/{install,uninstall}.sh` | ✅ bash -n OK |
| doctor 自愈 | `seed/companion/doctor.js` + `index.js` 启动集成 | ✅ 单测 15/15 |
| doctor 单测 | `seed/tests/companion-doctor.unit.test.js` | ✅ exit 0 |
| 证据文档 | 本文件 | ✅ |

红线复核：**零 npm 运行时依赖**——产物运行仅依赖 Node 内置模块
（node:sqlite / node:http / node:crypto 等），`package.json` 无 dependencies 新增。

## 2. 构建方式（Node SEA）

`node scripts/build-companion-sea.js` 四步流水线：

1. **Bundle**：把 `seed/companion/{ulid,types,doctor,db,events,index}.js` 合并为
   `dist/companion-sea/bundle.js`。不用 esbuild——手写"模块工厂"包裹：每个源文件
   原样置入独立函数作用域（`module/exports/require` 形参），相对 require 经
   `__registry`/`__require` shim 解析，其余透传给真实 require（仅内置模块，满足
   SEA 约束）。入口用 `__entryRequire.main = __entryModule` 保证
   `require.main === module` 成立。`schema.sql` JSON 转义后内嵌为
   `globalThis.__DCF_EMBEDDED_SCHEMA__`，`db.js` 优先读它——运行时不依赖源码目录。
2. **Blob**：`node --experimental-sea-config sea-config.json`
   （`disableExperimentalSEAWarning: true`）。
3. **注入**：复制当前 node 二进制 → `codesign --remove-signature` →
   `npx --yes postject <bin> NODE_SEA_BLOB <blob>
   --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
   --macho-segment-name NODE_SEA` → `codesign --sign -` ad-hoc 重签。
4. **Sanity**：`dist/dcf-companion --help` 直接运行校验。

### 构建期一次性 npx 工具记录（红线允许项）

- **postject**：仅构建期经 `npx --yes postject` 一次性执行，不进入运行时依赖。
- **坑**：本机用户级 `~/.npm` 缓存含 root 属主文件，npx 报 `EPERM`。
  构建脚本固定使用工作区缓存 `npm_config_cache=<repo>/.tmp-npm-cache` 绕过
  （验证后可删，脚本每次构建会按需重建）。
- 实测注入输出：`💉 Injection done!`；重签与 `--help` 均 exit 0。

### 构建顺序约束（实测发现）

`scripts/build-chrome-extension.js`（被 `npm run test:chrome` 的
chrome-build.integration.test 触发）会 `fs.rmSync(dist/, {recursive})` 清空整个
dist/，**连带删除 dcf-companion**。因此：先跑测试门禁、后（重新）构建 SEA 产物；
或构建后避免再跑 chrome 构建类测试。本次交付按"门禁 → 重建 → 复验"顺序执行。

## 3. doctor 自愈（seed/companion/doctor.js）

`index.js` 的 `main()` 在监听前先 `runDoctor({port, dbPath, baseDir})`；
`--dcf-dir=` 参数可覆盖 baseDir（测试/冒烟不污染 `~/.dcf`）。自检项与修复策略：

| 自检项 | 策略 |
|---|---|
| 目录 | `~/.dcf` 与 `~/.dcf/logs/` 不存在则创建 |
| DB 缺失 | 标记 `missing`，由正常初始化建库（doctor 不代建） |
| DB 损坏 | `PRAGMA integrity_check` 失败 → 重命名为 `<db>.corrupt-<ISO时间戳>.bak`（含 -wal/-shm sidecar，留证不删）→ 状态 `rebuilt`，随后正常初始化重建 |
| 端口被健康 companion 占用 | 探测 `/rpc/health` 返回 healthy → 本进程 exit 0（单实例语义） |
| 端口被其他进程占用 | 递增端口重试（上限 10），最终端口写 `~/.dcf/companion.port` |
| 日志 | 全部自检结果 append 到 `logs/companion-doctor.log` 并打印启动摘要 |

单测 `seed/tests/companion-doctor.unit.test.js`：6 套件 15 断言全过
（目录创建 / 损坏备份重建 / 空闲端口 / 非 companion 占用 / 健康 companion
单实例退出 / 完整流程）。

## 4. launchd 模板与安装脚本

- `com.dcf.companion.plist` 为**模板**（launchd 不展开 `~`/环境变量），install.sh
  渲染 `__COMPANION_BIN__/__DCF_DIR__/__PORT__/__LABEL__` 后写入
  `~/Library/LaunchAgents/`。关键键：`RunAtLoad=true`；
  `KeepAlive.SuccessfulExit=false`（崩溃重启、干净退出不重启——与 doctor 单实例
  exit 0 语义兼容，不会造成 respawn 循环）；`ThrottleInterval=10`；
  日志 `StandardOut/ErrorPath` 指向 `<DCF_DIR>/logs/companion.launchd.{out,err}.log`。
- `install.sh`：渲染 → `plutil -lint` → `launchctl bootout || true` →
  `launchctl bootstrap gui/$UID`（现代语法，幂等）。
- `uninstall.sh`：`launchctl bootout gui/$UID/<label>` + 删除 plist，不动数据。

### TCC 关键发现（实测）

launchd 无法执行位于 TCC 保护目录（~/Documents 等）内的二进制：dyld 卡死在
`getOnDiskBinarySliceOffset`（sample 取证，60s 无响应）。因此 **install.sh 将
二进制复制到 `<DCF_DIR>/bin/dcf-companion` 后再指向它**。复制到 /tmp 验证后
3 秒内即 healthy。

### 一次性 bootstrap/bootout 验证（本机不常驻安装）

用测试 label `com.dcf.companion.test`、端口 18473、`/tmp/launchd-test-dcf`：

```
/tmp/launchd-test-render.plist: OK        ← plutil -lint（模板与渲染件均 OK）
bootstrap=OK
healthy after ~3s: {"jsonrpc":"2.0","result":{"status":"healthy","database":"real",...}}
--- launchd out.log tail ---
  GET  http://127.0.0.1:18473/rpc/health
Press Ctrl+C to stop
bootout=OK
no residual process
```

验证后立即 bootout，`launchctl print` 确认服务已移除，无残留进程/plist。
本机未做常驻安装（`~/Library/LaunchAgents/com.dcf.companion.plist` 不存在）。

## 5. 打包产物冒烟验证（真实输出）

`dist/dcf-companion --port=18472 --db=/tmp/smoke-companion.db --dcf-dir=/tmp/smoke-dcf-dir`
直接运行（不经系统 node），启动日志含完整 doctor 摘要。RPC 序列摘录：

```
=== 1. GET /rpc/health ===
{"jsonrpc":"2.0","result":{"status":"healthy","database":"real","event_count":0,...}}
HTTP 200
=== 2. POST /rpc/events/ingest ===
{"jsonrpc":"2.0","result":{"event_id":"01KYEGF8VTEVY8FNQ4WE8F4QRE","duplicated":false}}
HTTP 200
=== 2b. ingest replay (idempotency) ===
{"jsonrpc":"2.0","result":{"event_id":"01KYEGF8VTEVY8FNQ4WE8F4QRE","duplicated":true}}
HTTP 200
=== 3. GET /rpc/events/query ===
{"jsonrpc":"2.0","result":{"events":[{"event_id":"01KYEGF8VTEVY8FNQ4WE8F4QRE",
 "source_id":"01KYEGF8TS53FDDJ5Q98M8HHFT","event_type":"page.visit",...}],"count":1,...}}
HTTP 200
=== 4. GET /rpc/stats ===
{"jsonrpc":"2.0","result":{"event_count":1,"boundary_count":1,
 "db_path":"/tmp/smoke-companion.db","mock_mode":false}}
HTTP 200
```

SIGTERM 关停：

```
Shutting down gracefully...
Database connection closed
HTTP server closed
Shutdown complete
（进程确认退出：clean exit confirmed；companion.port 内容 = 18472）
```

契约备注（冒烟中确认）：ingest body 为 `{"event":{...}}`；`source_id`/`event_id`
须为 ULID；`event_type` 须为点分小写（如 `page.visit`）。HTTP JSON-RPC 契约未改动。

门禁后重建的产物（sha256 前缀 `a8ce1ddd4aac4d916a17`）复验：health 200 + SIGTERM
干净退出。

## 6. 测试门禁结果（全绿）

| 门禁 | 结果 |
|---|---|
| `seed/tests/companion-v0.unit.test.js` | exit 0 |
| `seed/tests/companion-doctor.unit.test.js` | exit 0（15 passed / 0 failed） |
| `seed/tests/g1-redline.test.js` | exit 0（34 passed / 0 failed） |
| `seed/tests/g2-reconnect.acceptance.mjs` | exit 0（5 passed / 0 failed，真实 headless Chrome） |
| `npm run test:chrome` | exit 0 |
| `npm run test:legacy` | exit 0 |

## 7. SEA 失败降级预案

本次 SEA 全链路成功，**未启用降级**。若 postject 失败，构建脚本会明确报错并指出
可运行回退：`node dist/companion-sea/bundle.js`（单文件 bundle 本身可直接由自带
node 二进制 + 壳脚本承载）。历史失败证据：npx 默认缓存 EPERM（见 §2），已在脚本
内固化解法。

## 8. unknown / unverified 项

- **登录时 RunAtLoad 自动拉起**：未真实注销/重启验证（一次性 bootstrap 等价触发
  了 RunAtLoad 路径，但真实登录场景 unverified）。
- **KeepAlive 崩溃重启**：未真实 kill -9 验证 respawn（plist 语义标准，标记
  unverified）。
- **跨机器可移植性**：产物基于本机 node v22.22.3 (darwin/arm64)，仅本机验证；
  其他 macOS 版本/Intel 未验证。
- **Gatekeeper**：ad-hoc 签名在本机可运行；分发到其他机器会遇 Gatekeeper 隔离
  （超出 G2 范围，unverified）。
- **长时间常驻稳定性**：冒烟为分钟级，未做长时运行验证。
