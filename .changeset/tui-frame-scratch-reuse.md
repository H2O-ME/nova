---
'@nova-agent/tui': patch
---

帧数组双缓冲乒乓（M10 R8）：`LineScreen.render` 的整帧数组不再每帧新建——prev 与本帧各占一块 scratch 缓冲、原位重填后轮换，流式高峰期每帧少一次 rows 长度数组分配（跨帧别名由乒乓排除）。
