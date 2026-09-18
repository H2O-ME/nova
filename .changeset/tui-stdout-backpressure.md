---
'@nova-agent/tui': patch
'@nova-agent/cli': patch
---

stdout 背压门（M10 R3，Grok WriterSync 单飞的 Node 等价物）：`LineScreen` 任一写入让 `write()` 返回 false（缓冲越过高水位）即关闭渲染门——后续帧整帧丢弃且**不更新差分缓存**（缓存恒等于屏幕物理内容），`drain` 事件开门并回调重排一次重绘，恢复首帧从旧真相直接 diff 到最新画面（latest-wins）。慢终端（SSH/ConHost）流式高峰期不再堆积一帧比一帧旧的过期写入。
