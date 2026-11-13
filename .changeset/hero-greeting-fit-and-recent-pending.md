---
'@nova-agent/web': minor
'@nova-agent/web-ui': minor
---

Hero 首屏打磨（对齐 ZCode 免试错参数）：标题按时段问候分六档（5/9/12/14/18/23 点边界，边界定时器自动换档，整日挂机不 stale）；标题字号在 20–28px 区间自适应防换行（隐藏探针测量 + 双 ResizeObserver + 直写 CSS 变量，不走 React state，避免旧字号先画两行再弹回）；最近工作列表在首个 sessions 帧落地前显示载入占位，行落地不再整块弹入。顶栏拖放遮罩经核实已有全视口 DropOverlay 覆盖，不再重复实现。
