---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

只读工具动词短语聚合行（M10 组件4，Grok verb_group 移植）：read_file/list_dir/search_files 的连续调用不再各占一行——运行中的只读调用直接并入单条动词短语行（`正在读取 2 个文件, 正在搜索 1 个模式`），全部返回后整行翻转过去时；失败成员并进同行红色 `N 失败` 后缀而非独立 ✗ 行；成员路径清单移入点击展开 detail。`toolGroupLine` 由 `readGroupLine(p, ReadGroupView, cols)` 取代。
