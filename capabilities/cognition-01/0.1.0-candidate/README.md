# create-envelope 运行报告：cognition-01

- 基线：`fee052a1e8af06bf1479550487d7e15ff271e7c7`
- 分支：`feature/create-envelope-cognition-01`
- 输出目录：`capabilities/cognition-01/0.1.0-candidate/`
- 目标：**稳定认知对象 + 不可变修订**
- 最终状态：`DESIGN_NOT_CLOSED`

## 结论

这次运行没有把现行规范“润色”为一个看起来完整的包络，而是成功区分了三类东西：

1. **已经冻结、可以直接进入包络的设计事实**：SQLite 权威、稳定对象、不可变 revision、current_revision 指针、原子提交、旧 revision 不覆写、检索投影不阻塞正式保存。
2. **当前开放但不阻塞本包络的实现问题**：SQLite 物理表名/局部索引；span 最终坐标编码（属于后续锚点能力）。
3. **会直接导致两个施工 Agent 产生不同公开行为的设计缺口**：正式 DAG、公开动作、ID、kind、时间、author_kind、source_refs、content_hash、错误、幂等和性能门槛。

因此本次 workflow 的正确结果不是 `DESIGN_READY`，而是：

```text
DESIGN_NOT_CLOSED
```

并且没有生成伪造的正式 input/output Schema 或 Fixture。

## E0～E8 结果

| 阶段 | 结果 | 说明 |
|---|---|---|
| E0 选择能力 | FAIL（诊断继续） | current-state 指定了样板候选，但仓库没有正式 capability DAG 注册 |
| E1 提取设计事实 | PASS | 已完成来源映射与事实分类 |
| E2 划定能力边界 | PASS | 对象/revision 核心与审核、检索投影、span 能力可以分开 |
| E3 编译接口契约 | FAIL | 公开机器契约未冻结 |
| E4 绑定依赖 | FAIL | 正式 DAG 尚未存在 |
| E5 生成 Fixture | BLOCKED | 没有合法输入 Schema |
| E6 通路验证 | BLOCKED | 最短行为目标可描述，但不能生成确定调用步骤 |
| E7 完整验收 | PARTIAL | 需求/验收意图已映射，执行细节被契约缺口阻塞 |
| E8 Readiness Gate | FAIL | Blind Builder / Blind Verifier 均失败 |

## 为什么没有生成“临时 Schema”

施工控制规范要求：未决定的公开字段不得交给执行层猜测。

如果本流程擅自选择 UUID、RFC3339、SHA-256、错误码或某种 source_refs 结构，就会把 AI 的便利选择伪装成 DCF 设计事实，恰好违反 create-envelope 的目的。

因此 `schemas/` 与 `fixtures/` 目录只留下阻塞说明，不生成会被误当正式契约的伪文件。

## 下一次设计层需要关闭什么

以 `open-design.yaml` 为唯一阻塞清单。设计层关闭这些问题后，重新运行 create-envelope；只有 Readiness Gate 全部通过，候选版本才可以晋级为正式 `1.0.0` 包络并进入 create-story。
