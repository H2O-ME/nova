---
'@nova-agent/tui-view': minor
'@nova-agent/tui': patch
---

**dark 主题换绑 GrokNight RGB + truecolor 探测补齐**（M10 批13，Grok 观感对齐四层里的层 1）：

- `theme.ts` 新增 `createDarkPalette(truecolor)`（导出）：truecolor 终端逐值用 Grok 的 `groknight.rs` 规范色——accent 青 `#1abc9c`（原纯青 `36`）、次要文本 `#6c6c6c`（原 faint SGR 2）、边框 `#505058`（原 bright-black）、成功 `#9ece6a`、警告 `#e0af68`、失败 `#f7768e`、`blue`/`magenta` 槽对齐 `#7aa2f7`/`#bb9af7`（markdown 分级标题下一批接上）。**只报 16 色的终端不量化**，整屏逐字节沿用原 ANSI 调色板：最近邻数学会把 h2 蓝与 h1 青压成同一个青，等于把这套色的层次抹平（与 light 主题同一姿态）。
- `detectCaps` 的 truecolor 判定补两处：只报 256 色的终端按**品牌名升回** truecolor（iterm2/ghostty/kitty/wezterm/vscode/Windows Terminal…），且 **win32 无条件为真**——ConHost 自 Win10 起就吃 `38;2`，Windows Terminal 也不一定把 `COLORTERM` 传下来，原先只认环境变量的写法会整屏漏回 ANSI-16，改了等于没改。`detectCaps` 新增第三个可选入参 `platform`（默认 `process.platform`，可测）。
- 红线更新：AGENTS.md §3 与 tui-design 的"dark 默认观感与引入主题层前逐字节一致"只对 **16 色档**成立。

**破坏面**：`detectCaps` 签名加可选第三参（向后兼容）；`createDarkPalette` 为新增导出；dark 主题在 truecolor 终端下的全部颜色输出变更（呈现面，非 API 面）。
