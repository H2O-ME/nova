---
'@nova-agent/web': minor
---

# WebUI 构建与托管管线迁移：Vite → Next.js（App Router，静态导出）

## 起因

前一轮（`webui-aceternity-token-rewrite.md`）只重写了 token 层，得出「Aceternity 不是
可安装的组件库、装它只会换装饰」的结论，并据此**零新依赖**。操作者随后连续三次
否掉这个结论，最终明确：「**完全逐行重写 webui 重构为 aceternity**」「**装 Next.js
换掉整个构建与托管管线**」。本轮即执行后者：真的装依赖、真的换管线。

## 关键约束：Next 只能是构建工具，不能是 runtime

`packages/web/src/server.ts` 是**单个 `node:http` 进程**，同一个 handler 同时承担
四件事：`/ws` upgrade 协议、launch-token/cookie 鉴权、plugin 路由、静态托管。
让 Next 当 server 会抢走这个 handler —— 应用能加载，但 `/ws` 永远连不上，
即"能看不能聊"。

因此采用 `output: 'export'`：`next build` 产出 `ui/out/`，`scripts/sync-export.mjs`
同步进 `packages/web/public`，服务端除 `cachePolicy` 的 `/_next/static/` 前缀外
**一行未改**。

## 迁移中真正卡住的三件事（均已修）

1. **753 处 `.js` 导入全仓不解析**。本仓 ESM-only，源码以 `./x.js` 指向 `./x.ts`；
   webpack / Turbopack 都不认。用 `next.config.ts` 的
   `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }` 一处解决——
   改源码会波及 Node 侧同一份文件的 ESM 图，不可接受。
2. **静态导出在 Node 里预渲染客户端树**，报 `window is not defined`。根组件改用
   `dynamic(..., { ssr: false })`，一次声明"此树只在浏览器存在"。
3. **boot 脚本位置**。它调 `document.body.toggleAttribute(...)`：在旧
   `index.html` 里位于 `<body>` 末尾，body 已存在；搬进 `<head>` 后 body 还是 null，
   抛 `TypeError`，**静默杀掉每次加载的暗色分支**（CDP 实测捕获）。现置于
   `<body>` 第一个子节点——既让 `body` 存在，又仍在首帧前执行，不产生主题闪烁。

## Aceternity 组件层（`src/ui/`）

`cn` / `AuroraBackground` / `GlowCard` / `GlowButton`，Tailwind v4 经 `@theme inline`
映射到既有 `--nova-*` token。`inline` 是必须的：否则 Tailwind 把亮色值烤进工具类，
`body[data-nova-dark]` 对整层失效。`app/globals.css` 的引入顺序也是负载的——
`index.css` → `design/index.css` → `tailwind.css`，Tailwind 必须最后。

## 实测证据

- `next build` 通过；`public/` 变为 `_next/ _not-found/ 404/ icons/ index.html …`。
- 服务端 `GET /?t=…` → 200 / 8140 bytes，含 `id="root"`、`data-nova-dark`、`/_next/static`。
- 带 cookie 取 `/_next/static/chunks/*.js` → 200 / 203720 bytes；无 token → 401（与 Vite 时代一致）。
- **Edge headless + CDP 真机截图**（亮/暗双主题，1280×860）：控制台 0 错误；
  输入卡 672px / 主区 67%、圆角 24px；极光层 998×820（此前两次落在 624×34 /
  656×34 的标题带上，属实测才可见的缺陷）。
- `pnpm check`：209 文件 / 2215 断言全过，lint 0 error。

## 守卫的两处必要改写（不是放宽）

- `style-guard.test.ts` 的挂载文档入口从已删除的 `index.html` 改为 `app/layout.tsx`，
  保持"不过组件表的裸标记"这一被守护属性。
- `theme.test.ts` 原本逐字比对 `index.html` 里手抄的 boot 脚本。新布局**直接调用**
  `bootThemeScript()`，没有副本可比；断言改为钉更强的性质——布局必须调用该函数、
  且**不得**内联副本（注释先剥离）。变异验证：重新内联副本 → 精确报红。

## 遗留

Next 16 对 React 18 有 deprecated 警告（peer 仍支持 `^18.2.0`），Next 17 将移除；
升级 React 19 是独立任务，未在本轮夹带。
