---
'@nova-agent/core': patch
---

G2：12 个 `session-*.ts` 收进 `core/src/session/`。

`session-aggregate`、`session-event-schema`、`session-files`、`session-index`、`session-listing`、`session-log`、`session-peek`、`session-projection`、`session-repair`、`session-target`、`session-title`、`session-workspace` 移入 `packages/core/src/session/`，文件名不变（文件内的互引注释按 basename 写，改名会让它们失效）。

`core/src/session.ts`（`Session` 对象本体）不在 `session-*` 之列，留在原地；新目录不放 `index.ts`，因此 `./session.js` 与 `./session/xxx.js` 的解析互不冲突。公共 API 不变——所有名字仍经 `core/src/index.ts` 桶文件原样再导出。
