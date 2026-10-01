---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

新增 `context` 上下文洞察插件（advanced 档，需 `plugins.enable` 打开）与浏览器「上下文」视图：会话窗口组成、逐次请求趋势、压缩/切换事件与文件活动。开关即插件本身的行——关掉后读数与 tab 一起消失。计费/跨会话仪表盘、智能体网络等 dsh-context 其余面刻意未移植（见 AGENTS.md）。
