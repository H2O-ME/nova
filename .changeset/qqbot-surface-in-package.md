---
'@nova-agent/qqbot': minor
---

qqbot 的产品形态整体迁入本包（`src/surface/`）：`nova qqbot` 的 surface 工厂（`createQqBotSurface`）、`nova --web` 进程内的通道桥（`startQqBotBridge`，含 `bridge.runtime()` 活通道缝）、设置页连接读数（`QqBotRuntimeSeam` / `QqBotLiveReading`）与凭据探针（`testQqBotConnection`）现在都由本包导出，与既有的 `createQqBotChannel` 同在一份公开面。cli 不再含任何 qqbot 实现文件：只剩 `qqbot-api.ts`（结构性镜像，一处动态装载）与 `qqbot-surface.ts`（认领行 + 凭据端口适配——凭据的 raw 文档读法是配置层规则，留在宿主）。宿主注入两个读法（`credentialsProblem` / `readCredentials`）与一个日志口，其余全是包的行为。

同批修一处存量读数缺陷：活通道缝把通道计数平铺返回，而帧型声明的是嵌套 `stats`——真实通道下设置页的「收到 / 回复 / 最近」行永不渲染（夹具恰好喂了嵌套形状，测试全绿）。现在 seam 产出 `stats: { received, replied, lastReceivedAt? }`，并有直测钉住（平铺即红）。
