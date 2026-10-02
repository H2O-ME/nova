---
"@nova-agent/web": minor
---

WebUI 右侧栏接线：变更 / 文件 / 终端三个面板从「已实现但不可达」变为可打开。

面板、tab 条、reducer 片段与帧协议（`list_directory` / `run_terminal`）此前均已落地，唯独 `App` 的右栏槽只渲染工具详情——整簇组件零消费者。本次补上缺的那根线：

- **头部角落座位新增开栏按钮**（dsh 把右栏的展开控件就放在这里），右栏关闭时可见，不依赖会话里是否有工具调用。
- **右栏槽的双居住者**：点开的工具详情优先占栏（显式点击胜出）；否则右栏开着时渲染三页签面板。Escape 逐层关闭，右栏在最上层。
- 变更页是 `changesModel(blocks)` 的纯推导（从会话工具调用折叠出改动文件与行级 diff），文件页与终端页直接消费已有的 reducer 片段与帧协议。

（本条的终端页随后被整体重写取代：`run_terminal` 帧删除，改为持久 shell 的 `shell_run` / `shell_read` / `shell_stop`；开栏按钮与「工具详情优先占栏」两条接线不变——见 `rightbar-rewrite.md`。）
