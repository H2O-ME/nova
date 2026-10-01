---
"@nova-agent/cli": minor
"@nova-agent/web": minor
"@nova-agent/plugins": minor
"@nova-agent/core": minor
"@nova-agent/ai": minor
---

彻底删除 TUI（终端全屏界面），只保留 WebUI。

- **删除 `packages/tui` 与 `packages/tui-app` 两个包**：恢复后仍受三件事拖累——渲染层与产品逻辑纠缠、TTY 归属接缝反复出洞、真机验收无法自动化；浏览器界面已是富界面，终端保留 readline REPL（非 TTY 回落不变）。`nova --tui` 变为未知选项（报错并列出 --help）。
- **移除 `AgentSurfaceFlags.tui`**（core 公共面）：host-owned flags 里不再有终端全屏项；`AgentSurface` 契约本身不变——动态 surface 机制（config `surfaces` 行、`loadSurfacePlugins`、`buildSurfaceRuntime` 装配）完整保留，第三方 surface 照常可加载。
- **锁步组收窄为 5 包**（core/ai/plugins/web/cli）：`.changeset/config.json` 的 fixed 组与 `scripts/dep-direction.mjs` 白名单同步移除 tui/tui-app；根 `package.json` 的 `@nova-agent/tui-app` devDependency（运行期解析用）一并删除。
- 文档同步：AGENTS.md §2/§4/§7/§8 重写（形态四种、工作区 7 成员、开放问题第 4 条改为已解决），dsh-parity-inventory.md 的 TUI 节标注为历史记录。
