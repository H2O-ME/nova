---
"@nova-agent/tui-view": minor
"@nova-agent/cli": minor
---

版本号单一来源与展示：新增 `cliVersion()`（createRequire 读 `packages/cli/package.json`），取代 `index.ts` 硬编码 `VERSION`；TUI 开屏（`buildSplash`）与 REPL banner（`banner`）改渲染 `nova vX.Y.Z`，`/session` 面板展示版本与模式。引入 `@changesets/cli` 与 root `release`/`changeset` 脚本，monorepo 以 fixed 锁步组统一版本。新增 SemVer 2.0.0 合规校验（官方 ECMAScript 正则 + 7 个包版本一致），由 vitest 覆盖。