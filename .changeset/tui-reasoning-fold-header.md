---
'@nova-agent/tui-view': patch
'@nova-agent/cli': patch
---

reasoning 折叠头回归文档契约（M10 批次3 组件11）：答案起笔时思考段不再整块消失，而是定格为一行 `▸ 已思考 N.Ns` 摘要头与答案同组紧排，点击展开全文（全文只留会话内存，reasoning 从不落盘）；未提交到头答案就中断/重试/转工具调用时仍整块清场。`summaryRow` 秒数格式化：<10s 保留一位小数，≥10s 取整。
