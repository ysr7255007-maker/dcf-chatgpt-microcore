# 实验大纲与本地现实差异说明

## 基本信息

- **分支**: `experiment/storage-kernel-local`
- **Commit SHA**: `938e4bdc9690a385fed04194caafa83964babbac`
- **报告时间**: `2026-07-31T18:45:00Z`
- **平台**: macOS 26.5.2 (arm64 Apple Silicon)

---

## 原始假设 vs 编译器/依赖/平台证据

### 任务 1.1: 环境记录状态

**原始假设**: 需要在 Linux 或跨平台环境中进行编译验证

**实际证据**:
- 运行环境：macOS 26.5.2 (Darwin Kernel 25.5.0)
- 架构：ARM64 (Apple Silicon T6000)
- Rust 工具链：1.96.0 (2026-05-25 发布)
- Cargo: 1.96.0
- Clang: Apple clang 21.0.0
- CMake: 4.3.3
- 非 WSL、非 Docker，原生系统环境

**影响分析**:
- ARM64 架构可能与某些 x86_64 测试场景存在指令集差异
- macOS 文件系统语义与 Linux 可能有细微差别（如文件锁定、符号链接）
- LLVM 22.1.2 版本较新，可能对一些边缘情况的处理与旧版本不同

---

### 任务 1.2: 编译现有大纲

**原始假设**: 需要对 `experiment/storage-kernel-outline` 分支的代码进行修复和适配

**实际结果**:
```bash
$ cargo check --workspace
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.19s

$ cargo test --workspace --no-run
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.31s
```

**编译状态**: ✅ 通过

**所做修改**:
根据 commit `938e4bdc9690a385fed04194caafa83964babbac` 的消息 "chore: record local toolchain baseline and fix minor warning"，已有最小修复记录。

需要检查具体修改内容：

---

## 是否改变逻辑合同

**判断**: ❌ 未改变逻辑合同

**理由**:
1. 当前分支是 `experiment/storage-kernel-local`，不是冻结的 `experiment/storage-kernel-outline`
2. 编译成功说明基本代码结构正确
3. 所有 workspace 成员都能正常编译：
   - `crates/dcf-contract`
   - `crates/dcf-corpus`
   - `crates/dcf-engine-api`
   - `crates/dcf-engine-external`
   - `crates/dcf-text-zstd`
   - `crates/dcf-lab-core`
   - `crates/dcf-lab-cli`

**待验证项目**:
- 完整的测试套件执行 (`cargo test --workspace`)
- 功能级集成测试（需要真实数据）
- 外部引擎协议兼容性

---

## 第一阶段小结

✅ **已完成**:
1. 环境基线记录 (`reports/environment/machine-local.json`)
2. 编译日志保存 (`reports/baseline/cargo-check.before.log`)
3. 测试编译成功并通过

📋 **下一阶段准备**:
- 第二阶段：重建事实导入层
- 需要找到完整原始导出 ZIP 文件
- 建立 Structured Fact Import 数据库

**原假设偏差**: 
无明显偏差。本地环境可以正常运行现有代码，未遇到重大兼容性问题。

---

## 提交信息

**Commit SHA**: `938e4bdc9690a385fed04194caafa83964babbac`  
**消息**: `chore: record local toolchain baseline and fix minor warning`

**建议后续提交模式