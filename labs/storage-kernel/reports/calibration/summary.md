# Storage Kernel 操作语义校准 - 结果

Date: 2026-08-01
Protocol: engine `calibrate` mode (count / locate / extract / recover 分离操作)
Repetitions: Count/Locate/Extract 30 次; Open 10 次; Build/Storage 1 次; RecoverAll 每个数据集×引擎 1 次
Cache state: application-hot

## 撤回声明

- "zstd在高频搜索上快10-18倍" -> 撤回（测的是枚举全部命中，不是用户搜索）
- "交叉点在700-900个结果" -> 撤回
- "Locate-only+zstd空间比为0.29-0.33" -> 撤回（当前是zstd-full-scan，不是Locate-only）
- "Spec全部实现" -> 撤回

保留的窄结论：
- Full Trace比Legacy表现出更强的zstd可压缩性
- 枚举全部高频命中时，当前SDSL Locate成本很高
- 全文扫描延迟近似随语料字节规模增长

## 状态

search_matrix_status: complete
full_recovery_status: complete

## 表 1 - 搜索操作延迟 (P50/P95, us)

| Dataset | Engine | Query | Truth Count | Count | Locate1 | Locate10 | Locate100 | LocateAll |
|---------|--------|-------|------------:|------:|--------:|---------:|----------:|----------:|
| full_trace | utf8-a1-sdsl | absent-sentinel | 0 | 3.0/22.0 | 2.9/3.7 | 2.8/3.8 | 2.8/3.5 | 3.0/6.1 |
| full_trace | utf8-a1-sdsl | code-path | 227 | 4.0/15.4 | 9.0/14.8 | 357.2/700.9 | 7271.1/9009.6 | 15276.0/17200.0 |
| full_trace | utf8-a1-sdsl | en-identifier-2 | 76 | 4.6/8.4 | 19.9/40.4 | 465.1/763.5 | 4417.2/5260.1 | 6132.8/7688.2 |
| full_trace | utf8-a1-sdsl | en-reasoning | 2 | 9.5/14.1 | 21.5/36.8 | 219.5/376.2 | 234.9/408.1 | 239.1/380.7 |
| full_trace | utf8-a1-sdsl | json-structure | 0 | 3.8/8.5 | 3.5/6.4 | 3.6/19.8 | 3.5/5.8 | 3.7/5.8 |
| full_trace | utf8-a1-sdsl | thinking-content | 716 | 4.1/7.1 | 63.9/112.5 | 665.8/1032.1 | 8343.1/10512.7 | 67013.3/86734.1 |
| full_trace | utf8-a1-sdsl | tool-name | 3085 | 5.1/21.3 | 11.9/20.8 | 228.9/270.7 | 7211.6/9377.2 | 257789.0/342212.0 |
| full_trace | utf8-a1-sdsl | tool-result-marker | 2915 | 4.3/6.7 | 48.5/74.2 | 310.3/503.0 | 4419.2/5145.0 | 186755.0/227020.0 |
| full_trace | utf8-a1-sdsl | tool-use-marker | 2942 | 4.8/7.2 | 63.7/146.7 | 1129.8/1484.8 | 7178.8/9187.2 | 237372.0/283497.0 |
| full_trace | utf8-a1-sdsl | uuid-pattern | 0 | 4.2/7.5 | 4.0/7.7 | 4.0/7.5 | 4.0/7.9 | 4.1/7.2 |
| full_trace | utf8-a1-sdsl | zh-high-freq-1 | 17545 | 3.3/5.2 | 59.8/117.2 | 475.4/644.5 | 8534.0/10617.6 | 1571760.0/1787140.0 |
| full_trace | utf8-a1-sdsl | zh-high-freq-2 | 12380 | 2.3/3.7 | 17.5/42.5 | 421.8/762.2 | 8153.3/10004.0 | 1057970.0/1198570.0 |
| full_trace | utf8-a1-sdsl | zh-high-freq-3 | 3468 | 2.8/4.4 | 8.5/33.7 | 337.5/615.2 | 8018.5/9529.6 | 283751.0/324726.0 |
| full_trace | utf8-a1-sdsl | zh-medium | 889 | 4.2/8.5 | 39.6/97.4 | 471.2/882.7 | 6491.7/8241.2 | 70065.2/75323.5 |
| full_trace | zstd-full-scan | absent-sentinel | 0 | 82596.6/86402.0 | 82979.4/90059.0 | 82682.9/91227.6 | 83030.9/92427.3 | 83165.2/139753.0 |
| full_trace | zstd-full-scan | code-path | 227 | 131316.5/287724.2 | 14792.4/15545.6 | 14938.4/22483.8 | 93831.4/96708.6 | 131023.3/136472.3 |
| full_trace | zstd-full-scan | en-identifier-2 | 76 | 114520.3/116017.1 | 12922.1/13926.2 | 23475.2/25639.2 | 114766.4/119865.0 | 114722.4/126016.8 |
| full_trace | zstd-full-scan | en-reasoning | 2 | 84502.9/137897.5 | 45498.9/107476.9 | 83697.4/145833.5 | 83910.5/148225.2 | 83430.7/138983.7 |
| full_trace | zstd-full-scan | json-structure | 0 | 115059.4/120410.0 | 114845.1/124873.3 | 115635.5/152817.7 | 115216.6/170938.5 | 115270.0/125069.0 |
| full_trace | zstd-full-scan | thinking-content | 716 | 117038.8/175856.1 | 7.6/9.0 | 553.0/592.1 | 9819.2/10652.4 | 116195.5/160541.8 |
| full_trace | zstd-full-scan | tool-name | 3085 | 115013.8/131815.0 | 3368.9/3612.5 | 6523.5/6657.0 | 11103.2/11326.6 | 114629.8/118021.3 |
| full_trace | zstd-full-scan | tool-result-marker | 2915 | 116225.5/178936.3 | 3448.0/3793.6 | 6706.6/11473.8 | 11266.9/28279.7 | 119508.8/139133.0 |
| full_trace | zstd-full-scan | tool-use-marker | 2942 | 115999.0/154575.2 | 3467.5/13027.8 | 6613.4/14835.9 | 11232.0/13482.0 | 117565.4/185546.1 |
| full_trace | zstd-full-scan | uuid-pattern | 0 | 114801.5/149795.2 | 114743.1/134140.8 | 114622.8/136377.6 | 114879.3/123591.6 | 114744.6/124529.7 |
| full_trace | zstd-full-scan | zh-high-freq-1 | 17545 | 131234.7/158148.1 | 4.8/5.4 | 45.9/58.2 | 529.5/568.8 | 131041.7/137179.6 |
| full_trace | zstd-full-scan | zh-high-freq-2 | 12380 | 130739.0/133471.8 | 3.0/3.2 | 34.0/43.1 | 527.5/571.4 | 131306.3/135733.5 |
| full_trace | zstd-full-scan | zh-high-freq-3 | 3468 | 130593.9/135908.3 | 193.5/243.6 | 782.8/824.5 | 3462.7/3802.8 | 132179.8/141461.7 |
| full_trace | zstd-full-scan | zh-medium | 889 | 115310.2/120579.8 | 193.2/249.1 | 660.0/971.7 | 9068.7/13021.7 | 114999.0/124332.5 |
| legacy_message_text | utf8-a1-sdsl | absent-sentinel | 0 | 1.2/1.8 | 1.2/1.6 | 1.3/1.8 | 1.2/1.8 | 1.2/1.9 |
| legacy_message_text | utf8-a1-sdsl | code-path | 23 | 4.8/21.4 | 13.8/25.1 | 1458.8/1852.7 | 2424.4/2943.8 | 2401.9/2712.5 |
| legacy_message_text | utf8-a1-sdsl | en-identifier-1 | 0 | 4.1/6.5 | 4.2/6.2 | 4.0/5.9 | 4.2/14.7 | 4.2/6.7 |
| legacy_message_text | utf8-a1-sdsl | en-identifier-2 | 9 | 6.5/10.1 | 64.0/84.5 | 635.8/967.8 | 662.6/733.5 | 623.8/698.8 |
| legacy_message_text | utf8-a1-sdsl | en-reasoning | 2 | 11.0/16.0 | 83.0/158.3 | 100.2/179.9 | 107.9/192.2 | 96.0/177.8 |
| legacy_message_text | utf8-a1-sdsl | json-field | 12 | 3.7/10.2 | 113.3/243.6 | 717.8/942.4 | 800.3/1040.3 | 743.9/996.4 |
| legacy_message_text | utf8-a1-sdsl | long-msg-tail | 0 | 2.2/3.4 | 2.2/3.7 | 2.1/3.2 | 2.1/2.9 | 2.3/3.5 |
| legacy_message_text | utf8-a1-sdsl | thinking-marker | 0 | 3.8/5.3 | 4.0/6.0 | 4.0/5.9 | 4.0/6.0 | 3.9/5.8 |
| legacy_message_text | utf8-a1-sdsl | tool-name | 21 | 4.8/14.6 | 21.5/54.8 | 726.2/1038.0 | 1941.9/2912.8 | 2144.8/3173.9 |
| legacy_message_text | utf8-a1-sdsl | uuid-pattern | 0 | 4.2/6.0 | 4.1/6.4 | 4.2/6.3 | 4.3/13.5 | 4.5/6.6 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-1 | 13236 | 2.6/4.2 | 33.0/58.8 | 671.0/1046.5 | 6561.3/9410.8 | 937231.0/1058990.0 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-2 | 8312 | 2.4/3.7 | 81.4/187.4 | 798.4/1160.2 | 6880.0/8316.0 | 624689.0/721568.0 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-3 | 2110 | 2.5/3.5 | 13.2/27.4 | 1174.5/1510.4 | 7441.4/8844.1 | 164687.0/194608.0 |
| legacy_message_text | utf8-a1-sdsl | zh-low-freq-long | 0 | 4.8/8.0 | 4.8/10.0 | 4.8/7.9 | 4.5/7.5 | 4.5/7.4 |
| legacy_message_text | utf8-a1-sdsl | zh-medium | 713 | 3.6/6.1 | 30.1/58.3 | 941.4/1428.0 | 8428.2/10163.0 | 55978.7/62113.1 |
| legacy_message_text | zstd-full-scan | absent-sentinel | 0 | 36786.8/37922.2 | 37132.2/40313.5 | 36895.8/37880.3 | 37001.2/37736.2 | 37948.2/40082.1 |
| legacy_message_text | zstd-full-scan | code-path | 23 | 58888.0/59966.5 | 11419.7/13669.8 | 26500.4/28774.4 | 59137.6/64471.4 | 58990.9/62526.6 |
| legacy_message_text | zstd-full-scan | en-identifier-1 | 0 | 51320.6/52647.5 | 51475.1/57287.8 | 51347.0/52188.7 | 51633.3/60338.0 | 51899.8/58207.2 |
| legacy_message_text | zstd-full-scan | en-identifier-2 | 9 | 51302.1/71975.2 | 9890.8/10712.6 | 51226.4/53655.3 | 51546.7/56673.6 | 51769.0/57768.9 |
| legacy_message_text | zstd-full-scan | en-reasoning | 2 | 38481.4/69369.8 | 18797.2/19868.0 | 37095.9/39961.5 | 37490.2/41852.0 | 37325.5/39641.2 |
| legacy_message_text | zstd-full-scan | json-field | 12 | 59191.9/68449.5 | 12691.0/15227.4 | 30898.4/32263.5 | 59442.4/63109.6 | 59422.7/64240.9 |
| legacy_message_text | zstd-full-scan | long-msg-tail | 0 | 39115.9/47571.3 | 38710.5/43479.8 | 37562.1/43531.8 | 38096.6/47905.5 | 38389.3/44672.3 |
| legacy_message_text | zstd-full-scan | thinking-marker | 0 | 52925.2/63663.7 | 51897.3/59638.2 | 51735.5/60552.5 | 51547.3/54720.2 | 51486.4/64095.8 |
| legacy_message_text | zstd-full-scan | tool-name | 21 | 51240.0/52383.7 | 22118.8/22820.5 | 22418.7/24382.0 | 51513.8/53097.4 | 51446.7/52303.4 |
| legacy_message_text | zstd-full-scan | uuid-pattern | 0 | 51587.4/52490.8 | 51592.0/55030.7 | 51906.0/54448.7 | 52225.3/64867.8 | 51504.5/53018.8 |
| legacy_message_text | zstd-full-scan | zh-high-freq-1 | 13236 | 58749.0/61925.2 | 4.7/5.0 | 45.8/70.9 | 528.6/564.0 | 59160.0/61999.1 |
| legacy_message_text | zstd-full-scan | zh-high-freq-2 | 8312 | 59684.0/86992.2 | 2.9/3.6 | 33.2/53.2 | 525.7/596.7 | 59004.8/60533.9 |
| legacy_message_text | zstd-full-scan | zh-high-freq-3 | 2110 | 58974.8/67202.6 | 193.5/238.2 | 800.0/867.5 | 3467.9/3693.5 | 58988.6/60731.2 |
| legacy_message_text | zstd-full-scan | zh-low-freq-long | 0 | 38101.7/49169.0 | 37058.7/38338.2 | 37074.5/38212.0 | 37254.4/76426.0 | 37209.2/41956.0 |
| legacy_message_text | zstd-full-scan | zh-medium | 713 | 51416.8/54972.8 | 187.8/228.5 | 665.2/744.0 | 7517.3/7828.2 | 52545.5/70872.0 |

## 表 2 - 正文提取与完整恢复

| Dataset | Engine | Extract128B P50/P95 (us) | Extract1KiB P50/P95 (us) | Extract8KiB P50/P95 (us) | RecoverAll 总耗时 (s) | SHA-256 |
|---------|--------|--------------------------:|-------------------------:|-------------------------:|----------------------:|---------|
| full_trace | utf8-a1-sdsl | 122.4/351.1 | 1082.1/1416.7 | 9056.7/12116.4 | 923.6 | match |
| full_trace | zstd-full-scan | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | 0.1 | match |
| legacy_message_text | utf8-a1-sdsl | 140.8/209.9 | 1088.3/1660.0 | 9865.8/12565.5 | 426.7 | match |
| legacy_message_text | zstd-full-scan | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | 0.0 | match |

## 表 3 - 存储 / 构建 / 打开

| Dataset | Engine | Index/Store bytes | bytes/input | Build (ms) | Open P50/P95 (ms) |
|---------|--------|------------------:|------------:|-----------:|------------------:|
| full_trace | utf8-a1-sdsl | 21632965 | 0.4280 | 7592.1 | 6.4/6.7 |
| full_trace | zstd-full-scan | 14597924 | 0.2888 | 10412.5 | 7.6/8.0 |
| legacy_message_text | utf8-a1-sdsl | 9978037 | 0.4409 | 3534.8 | 3.1/4.0 |
| legacy_message_text | zstd-full-scan | 7491202 | 0.3310 | 4753.6 | 3.5/3.6 |

## 正确性

搜索操作（全部 truth set 查询，不允许 14/15）：290/290 correct

- legacy_message_text / utf8-a1-sdsl: 75/75 correct
- legacy_message_text / zstd-full-scan: 75/75 correct
- full_trace / utf8-a1-sdsl: 70/70 correct
- full_trace / zstd-full-scan: 70/70 correct

- recover_all legacy_message_text / zstd-full-scan: success, 0.0 s, sha256 match, peak_rss 129007616 bytes
- recover_all legacy_message_text / utf8-a1-sdsl: success, 426.7 s, sha256 match, peak_rss 127762432 bytes
- recover_all full_trace / utf8-a1-sdsl: success, 923.6 s, sha256 match, peak_rss 323731456 bytes
- recover_all full_trace / zstd-full-scan: success, 0.1 s, sha256 match, peak_rss 323731456 bytes

注：SDSL recover_all 原始字节数比语料多 1 字节（CSA 哨兵字符，逐字节 extract 的既有行为）；SHA-256 校验在丢弃尾部哨兵后比对。
