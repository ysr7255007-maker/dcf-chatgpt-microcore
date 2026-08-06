# Fixtures — 当前阻塞

Fixture 必须是“符合已经冻结输入契约的最小合法输入”。

当前 `cognition-01` 没有冻结公开输入 Schema，因此 create-envelope **不得生成看似合理的 Fixture**。

否则 Fixture 会反过来决定：

- object_id / revision_id 格式；
- kind 值域；
- created_at 格式与产生责任；
- author_kind 值域；
- source_refs 结构；
- content_hash / 幂等语义。

解除 `open-design.yaml` 中相应阻塞项后，再由 create-envelope 生成 `minimal/`、`boundary/` 与 `invalid/` Fixture。
