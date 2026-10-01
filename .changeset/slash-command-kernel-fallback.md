---
"@nova-agent/plugins": minor
"@nova-agent/cli": minor
---

斜杠命令收口：`/compact` 与 `/goal` 在 REPL / TUI 直达内核 runner，`/help` 合并双目录。

- **`/compact` 不再是 REPL 壳里的第二份实现**：斜杠命令的默认分支先查内核命令目录（`Kernel.runCommand`），未命中才宣布未知。`/compact` 由 `kernel-commands` 的唯一实现执行；轮次进行中时给出一句解释（把关仍在 core 的压缩 runner——它是唯一强制点，壳侧只是文案）。
- **`/goal` 在终端界面可用了**：它一直注册在内核目录里，但此前只有 web 能到达；REPL / TUI 的壳没有这条命令的副本，菜单也不显示。现在经同一 runner 执行，完整语法（`/goal <目标>` / `edit` / `pause` / `resume` / `clear` / 空参数查看）与 web 一致。
- **`/help` 合并目录**：`mergedCommandSpecs(registry)` 把壳条目与内核注册表条目合成一份（壳条目胜同名冲突），活读注册表——第三方插件经 `registerCommand` 注册的命令无需重启即出现在 `/help`。
- **命令执行有回声**：内核 `command` 事件（run/done 两相）在 REPL 与 TUI 各自渲染，命令自己 `log` 的行不再凭空消失。
- **jobs 服务键对齐**：`jobs` 服务改经容器 `must(jobsKey)` 读取（与 `spill` / `sessions` / `llm` 同一条缝），装配点接线不再旁路容器；附一条接缝测试钉住「内核暴露的 jobs 与插件注入的 jobs 是同一实例」。
