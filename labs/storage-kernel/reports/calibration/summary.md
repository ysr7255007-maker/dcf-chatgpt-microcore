# Storage Kernel 操作语义校准 - 结果

Date: 2026-08-01
Protocol: engine `calibrate` mode (count / locate / extract / recover 分离操作)
Repetitions: 30 (recover_all: 3); cache state: application-hot

## 撤回声明

- "zstd在高频搜索上快10-18倍" -> 撤回（测的是枚举全部命中，不是用户搜索）
- "交叉点在700-900个结果" -> 撤回
- "Locate-only+zstd空间比为0.29-0.33" -> 撤回（当前是zstd-full-scan，不是Locate-only）
- "Spec全部实现" -> 撤回

保留的窄结论：
- Full Trace比Legacy表现出更强的zstd可压缩性
- 枚举全部高频命中时，当前SDSL Locate成本很高
- 全文扫描延迟近似随语料字节规模增长

## 表 1 - 搜索操作延迟 (P50/P95, us)

| Dataset | Engine | Query | Truth Count | Count | Locate1 | Locate10 | Locate100 | LocateAll |
|---------|--------|-------|------------:|------:|--------:|---------:|----------:|----------:|
| full_trace | utf8-a1-sdsl | absent-sentinel | 0 | 2.8/3.3 | 2.9/3.7 | 2.9/4.3 | 2.9/4.0 | 2.8/3.9 |
| full_trace | utf8-a1-sdsl | code-path | 227 | 3.8/5.8 | 8.9/21.2 | 261.8/454.2 | 5692.0/6575.8 | 15111.1/17078.7 |
| full_trace | utf8-a1-sdsl | en-identifier-2 | 76 | 4.5/7.3 | 16.0/30.4 | 426.8/723.0 | 3909.3/5003.9 | 4205.6/5136.7 |
| full_trace | utf8-a1-sdsl | en-reasoning | 2 | 10.0/20.3 | 21.6/37.0 | 215.2/249.2 | 215.0/412.8 | 228.9/383.4 |
| full_trace | utf8-a1-sdsl | json-structure | 0 | 3.6/5.6 | 3.5/5.5 | 3.5/5.4 | 3.6/5.3 | 3.5/5.4 |
| full_trace | utf8-a1-sdsl | thinking-content | 716 | 3.9/6.6 | 60.6/88.0 | 633.1/969.8 | 8126.0/9783.0 | 58631.6/70329.8 |
| full_trace | utf8-a1-sdsl | tool-name | 3085 | 4.5/7.5 | 12.1/50.8 | 232.8/368.3 | 7411.1/8673.6 | 259788.0/328859.0 |
| full_trace | utf8-a1-sdsl | tool-result-marker | 2915 | 4.5/7.2 | 45.0/74.1 | 312.4/455.8 | 4547.2/5099.9 | 187643.0/217538.0 |
| full_trace | utf8-a1-sdsl | tool-use-marker | 2942 | 4.8/6.7 | 59.0/82.5 | 1115.0/1743.8 | 7741.0/10490.9 | 252357.0/273028.0 |
| full_trace | utf8-a1-sdsl | uuid-pattern | 0 | 4.0/20.6 | 4.0/7.7 | 4.0/7.4 | 4.1/44.7 | 4.0/6.3 |
| full_trace | utf8-a1-sdsl | zh-high-freq-1 | 17545 | 3.4/6.1 | 40.4/72.8 | 482.0/840.7 | 7260.3/8851.0 | 1454410.0/1588860.0 |
| full_trace | utf8-a1-sdsl | zh-high-freq-2 | 12380 | 2.2/4.2 | 18.6/45.7 | 401.1/686.5 | 7661.5/9555.2 | 1056230.0/1164500.0 |
| full_trace | utf8-a1-sdsl | zh-high-freq-3 | 3468 | 2.5/3.9 | 7.9/14.3 | 296.4/550.7 | 6534.7/7687.7 | 284775.0/337948.0 |
| full_trace | utf8-a1-sdsl | zh-medium | 889 | 4.1/6.8 | 34.7/103.0 | 448.9/565.2 | 6368.3/7127.3 | 69456.8/85146.0 |
| full_trace | zstd-full-scan | absent-sentinel | 0 | 82487.4/83833.2 | 82459.0/83749.4 | 82600.3/83692.4 | 82776.8/85692.7 | 82794.2/84618.3 |
| full_trace | zstd-full-scan | code-path | 227 | 130559.8/136771.8 | 14840.7/15212.3 | 14987.0/15326.1 | 94194.3/96082.2 | 131701.1/143441.5 |
| full_trace | zstd-full-scan | en-identifier-2 | 76 | 115962.0/120655.8 | 13026.0/13743.8 | 23691.5/24762.6 | 116707.8/144443.9 | 115064.5/118332.7 |
| full_trace | zstd-full-scan | en-reasoning | 2 | 82499.0/84645.5 | 44639.6/46172.6 | 82920.8/88902.2 | 83455.3/86408.6 | 83349.3/86141.1 |
| full_trace | zstd-full-scan | json-structure | 0 | 114896.4/116938.8 | 115131.7/116778.6 | 115224.4/117998.7 | 115118.2/116708.9 | 114858.0/116056.8 |
| full_trace | zstd-full-scan | thinking-content | 716 | 120812.2/168654.5 | 7.6/8.0 | 547.5/580.0 | 9749.3/10155.3 | 114819.1/117113.4 |
| full_trace | zstd-full-scan | tool-name | 3085 | 114890.7/116922.5 | 3380.7/3489.2 | 6517.3/6651.2 | 11032.9/11422.3 | 116250.4/210161.4 |
| full_trace | zstd-full-scan | tool-result-marker | 2915 | 115645.7/117887.2 | 3397.7/3519.2 | 6598.9/7338.5 | 11186.9/11964.2 | 115090.6/120168.5 |
| full_trace | zstd-full-scan | tool-use-marker | 2942 | 116227.5/118827.3 | 3383.9/3500.4 | 6575.8/6886.5 | 11289.0/14006.0 | 115244.8/126044.6 |
| full_trace | zstd-full-scan | uuid-pattern | 0 | 115273.7/118764.2 | 115636.0/143616.8 | 117246.2/142933.8 | 116571.1/123391.8 | 116298.7/120656.5 |
| full_trace | zstd-full-scan | zh-high-freq-1 | 17545 | 131854.0/209183.9 | 4.7/5.0 | 45.5/50.4 | 529.5/630.3 | 131084.3/133850.9 |
| full_trace | zstd-full-scan | zh-high-freq-2 | 12380 | 130424.1/151426.4 | 3.0/4.5 | 34.1/56.0 | 530.1/602.2 | 160622.0/255737.7 |
| full_trace | zstd-full-scan | zh-high-freq-3 | 3468 | 134250.6/162543.4 | 191.4/209.1 | 798.0/897.1 | 3445.6/3551.9 | 132176.1/164123.5 |
| full_trace | zstd-full-scan | zh-medium | 889 | 116323.8/128344.9 | 192.5/223.8 | 667.6/702.7 | 9108.1/10180.2 | 117354.1/122496.4 |
| legacy_message_text | utf8-a1-sdsl | absent-sentinel | 0 | 1.3/2.0 | 1.3/7.2 | 1.2/2.0 | 1.3/1.8 | 1.2/7.9 |
| legacy_message_text | utf8-a1-sdsl | code-path | 23 | 4.8/11.9 | 13.3/22.9 | 1547.0/1873.3 | 2512.0/2947.5 | 2527.1/2953.4 |
| legacy_message_text | utf8-a1-sdsl | en-identifier-1 | 0 | 4.2/11.8 | 4.0/6.0 | 4.2/19.5 | 4.0/6.4 | 4.3/6.6 |
| legacy_message_text | utf8-a1-sdsl | en-identifier-2 | 9 | 6.4/9.9 | 55.2/83.4 | 644.8/964.3 | 647.0/896.4 | 601.9/979.5 |
| legacy_message_text | utf8-a1-sdsl | en-reasoning | 2 | 10.1/49.0 | 71.6/172.5 | 104.9/207.7 | 90.5/122.2 | 88.8/196.0 |
| legacy_message_text | utf8-a1-sdsl | json-field | 12 | 3.7/16.5 | 101.5/139.5 | 676.4/841.9 | 750.5/891.3 | 770.5/974.4 |
| legacy_message_text | utf8-a1-sdsl | long-msg-tail | 0 | 2.3/12.2 | 2.4/6.5 | 2.3/3.6 | 2.2/3.5 | 2.2/3.4 |
| legacy_message_text | utf8-a1-sdsl | thinking-marker | 0 | 4.1/6.0 | 4.0/6.0 | 4.0/5.9 | 4.0/6.1 | 4.0/5.8 |
| legacy_message_text | utf8-a1-sdsl | tool-name | 21 | 5.0/6.9 | 19.6/72.7 | 744.8/1166.9 | 1480.8/2112.7 | 1628.9/1933.2 |
| legacy_message_text | utf8-a1-sdsl | uuid-pattern | 0 | 4.2/5.8 | 4.1/6.4 | 4.1/19.6 | 4.4/10.7 | 4.2/6.5 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-1 | 13236 | 2.5/4.2 | 32.8/96.5 | 661.1/915.4 | 7553.2/9231.5 | 985251.0/1103910.0 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-2 | 8312 | 2.4/9.1 | 75.8/137.7 | 794.6/1070.3 | 6841.7/9086.1 | 630227.0/711718.0 |
| legacy_message_text | utf8-a1-sdsl | zh-high-freq-3 | 2110 | 2.5/4.0 | 13.6/24.5 | 947.8/1471.5 | 8068.4/9209.7 | 165468.0/193060.0 |
| legacy_message_text | utf8-a1-sdsl | zh-low-freq-long | 0 | 4.4/7.6 | 4.6/7.3 | 4.9/25.2 | 4.4/7.4 | 4.5/7.5 |
| legacy_message_text | utf8-a1-sdsl | zh-medium | 713 | 3.7/6.2 | 42.5/89.9 | 897.7/1494.3 | 9040.1/10584.6 | 56415.3/63570.5 |
| legacy_message_text | zstd-full-scan | absent-sentinel | 0 | 38233.3/43529.2 | 36867.8/40356.2 | 36948.8/43888.1 | 37079.8/40183.0 | 36786.6/37598.8 |
| legacy_message_text | zstd-full-scan | code-path | 23 | 59067.3/62016.4 | 11220.1/12115.1 | 26322.0/27195.0 | 58637.8/62612.7 | 58399.7/59357.6 |
| legacy_message_text | zstd-full-scan | en-identifier-1 | 0 | 51777.2/56482.3 | 51174.8/52730.6 | 51376.6/56716.9 | 51212.4/52517.1 | 51213.2/52482.6 |
| legacy_message_text | zstd-full-scan | en-identifier-2 | 9 | 51166.5/57948.9 | 9819.5/10504.9 | 51279.8/55774.5 | 51132.8/53093.1 | 51091.8/52261.4 |
| legacy_message_text | zstd-full-scan | en-reasoning | 2 | 36726.3/37391.2 | 18710.8/20161.5 | 37018.8/38707.2 | 36865.9/40759.7 | 37045.2/38548.9 |
| legacy_message_text | zstd-full-scan | json-field | 12 | 59054.7/65047.0 | 12519.2/12946.0 | 30823.5/33259.4 | 58668.2/62254.6 | 59167.2/61945.0 |
| legacy_message_text | zstd-full-scan | long-msg-tail | 0 | 36765.5/38313.1 | 36866.6/38019.8 | 36955.0/38872.7 | 36870.6/38814.6 | 36943.9/38985.8 |
| legacy_message_text | zstd-full-scan | thinking-marker | 0 | 51580.5/56591.5 | 51217.5/52772.8 | 51253.2/56107.2 | 51223.3/53420.0 | 51602.4/55497.3 |
| legacy_message_text | zstd-full-scan | tool-name | 21 | 51225.8/53643.7 | 22082.5/22631.1 | 22461.7/24811.1 | 51209.3/54396.3 | 51814.5/77350.4 |
| legacy_message_text | zstd-full-scan | uuid-pattern | 0 | 51644.4/55601.3 | 51232.8/52853.0 | 51291.2/53528.9 | 51229.4/54185.8 | 51194.1/53753.5 |
| legacy_message_text | zstd-full-scan | zh-high-freq-1 | 13236 | 58927.6/64431.6 | 4.8/6.0 | 44.9/53.5 | 532.2/598.9 | 59721.9/63727.5 |
| legacy_message_text | zstd-full-scan | zh-high-freq-2 | 8312 | 59329.6/63079.7 | 3.0/3.2 | 34.0/39.5 | 526.5/592.2 | 58431.8/62507.1 |
| legacy_message_text | zstd-full-scan | zh-high-freq-3 | 2110 | 58872.4/66201.6 | 190.7/223.2 | 778.6/939.9 | 3487.2/3733.5 | 58481.4/59169.7 |
| legacy_message_text | zstd-full-scan | zh-low-freq-long | 0 | 36951.7/42614.7 | 36890.2/37540.1 | 37102.2/39374.0 | 36793.7/38004.2 | 36892.7/39529.4 |
| legacy_message_text | zstd-full-scan | zh-medium | 713 | 51098.3/52152.1 | 190.3/206.0 | 652.1/723.6 | 7437.7/8149.3 | 51101.8/52189.2 |

## 表 2 - 正文恢复延迟 (P50/P95, us)

| Dataset | Engine | Extract128B | Extract1KiB | Extract8KiB | RecoverAll |
|---------|--------|------------:|------------:|------------:|-----------:|
| full_trace | utf8-a1-sdsl | 112.5/164.3 | 1167.7/1853.2 | 10322.6/15339.2 | 913565000.0/923546000.0 |
| full_trace | zstd-full-scan | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | 57485.5/58162.0 |
| legacy_message_text | utf8-a1-sdsl | 144.1/207.0 | 1069.8/1470.7 | 9913.6/16127.9 | 482840000.0/483455000.0 |
| legacy_message_text | zstd-full-scan | 0.0/0.0 | 0.0/0.0 | 0.0/0.0 | 26901.2/27191.5 |

## 正确性

全部 truth set 查询必须 PASS（不允许 14/15）：338/338 结果 correct

- legacy_message_text / utf8-a1-sdsl: 87/87 correct
- legacy_message_text / zstd-full-scan: 87/87 correct
- full_trace / utf8-a1-sdsl: 82/82 correct
- full_trace / zstd-full-scan: 82/82 correct

注：SDSL recover_all 返回字节数比语料多 1 字节（CSA 哨兵字符，逐字节 extract 的既有行为，spec 要求保留）。
