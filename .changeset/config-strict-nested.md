---
'@nova-agent/cli': minor
---

配置 schema 的 `strict()` 补齐到每个嵌套段（`provider` / `ui` / `tools` / `tools.bash` / `tools.code` / `plugins` / `skills` / `qqbot`）：拼错的嵌套键（如 `provider.temprature`、`tools.code.modee`）此前被 zod 静默剥掉、加载照常通过，现在与顶层一致——加载即报错并点名。若配置里有未知的嵌套键，请先修正键名再启动。
