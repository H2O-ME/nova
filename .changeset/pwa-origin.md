---
"@nova-agent/web": minor
"@nova-agent/core": minor
---

WebUI 支持作为 PWA 安装：origin 持久化（端口记忆 + 配对持久化）+ manifest 与图标。

- **端口记忆**（`web/src/listen.ts` + `port.ts`）：未显式指定端口时，先尝试 `~/.nova/cache/web-port.json` 记住的上次端口，被占用则回落临时端口；实际绑定结果回写。此前每次启动都随机分配端口，浏览器视每次启动为新 origin——localStorage（工作区列表、主题、字号）随端口蒸发，PWA 安装更无从谈起。`NOVA_WEB_PORT` 显式设置时语义不变（指定端口被占用仍然报错），但同样会回写记忆。
- **配对持久化**（`web/src/auth-store.ts`）：`~/.nova/cache/web-auth.json` 持久化 cookie 身份（`cookieToken` + HMAC `secret`），cookie 增加 `Max-Age=31536000`——**安装的 PWA 冷启动直接进界面，无需 URL 参数**。启动 URL 里的 `?t=` token 保持每进程随机（一次性配对性质不变），但签出的 cookie 现在跨进程重启有效；删除 `web-auth.json` 即吊销全部已发 cookie。POSIX 上该文件 0600。
- **PWA 资产**（`web/ui/public/`）：`manifest.webmanifest`（standalone、暗色主题色、`start_url: "/"`）+ 四枚图标（192/512 × any/maskable）与 `favicon.svg`，由 `scripts/make-pwa-icons.mjs` 零依赖生成——纯 Node zlib PNG 编码器；标志取 README hero 的**星芒徽标**（琥珀 `#e8a13c` 主星 + 0.55 透明度的伴星），构图对齐参考应用图标：白色圆角方块 + 居中标志，maskable 档满幅白底、标志收进 80% 安全区。
- **`/manifest.webmanifest` 与 `/icons/*` 免认证下发**：Chromium 的安装检测管线在认证上下文之外取 manifest 并预取图标（可能不带 cookie），401 会静默杀死安装入口。这两类路径是仅有的绕过 cookie 门禁的静态资产——品牌标志与 manifest 名称，无任何机密；其余路径（含 `index.html`）维持 401 门禁不变。
- **core**：`paths.ts` 新增 `webPortStorePath` / `webAuthStorePath`（路径布局唯一定义处）。
- 存储故障一律**尽力而为**：损坏读作「无偏好」、写失败只告警，任何情况下不挡服务器启动。
