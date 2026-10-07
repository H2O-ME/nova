---
'@nova-agent/web': minor
---

WebUI 动效优化：新增全局动效层 `styles/motion.css`（共享缓动/时长 token + `nova-fade-up` / `nova-pop-in` / `nova-draw` 关键帧 + `prefers-reduced-motion` 全局兜底），用户气泡与助手消息接入淡入上移入场；SVG 动画——空会话 hero 的鱼标新增待机缓慢游动（悬停快摆保留）、工具完成态的勾改为画线入场。不引第三方动效库，全部合成器驱动；`motion-guard.test.ts` 守卫挂载与引用。这是对 dsh 参照的操作者点名偏离，已记入 `docs/dsh-parity-inventory.md`。
