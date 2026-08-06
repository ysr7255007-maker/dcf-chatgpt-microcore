# Schemas — 当前未生成正式机器契约

本目录属于 `cognition-01/0.1.0-candidate`。

`create-envelope` 已确认逻辑模型存在，但公开机器契约尚未闭合，因此**故意不生成**以下正式 Schema：

- 提交/创建对象的输入 Schema；
- 追加 revision 的输入 Schema；
- 读取对象/读取 revision 的输入与输出 Schema；
- 统一错误 Schema；
- source_refs Schema。

原因详见 `../open-design.yaml` 的 `OPEN-002`～`OPEN-010`。

在这些设计问题关闭前，任何 UUID、时间格式、哈希算法、错误码或来源引用字段都只能是实现者猜测，不能进入正式功能包络。
