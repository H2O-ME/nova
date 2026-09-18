---
'@nova-agent/plugins': minor
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

编号选项与拒绝转追问（Grok 组件7 移植）：模型/会话选择列表 1-9 数字键快选（会话行补绝对编号，提示行同步）；审批弹窗选中「拒绝」行后打字即补充拒绝理由（⌫ 删字、Enter 携理由拒绝、y/a 快捷批准不受影响），理由经 `{answer:'deny', reason}` → `decideDetailed` → hook verdict 一路回流，模型看到 `Permission denied: by user: <理由>` 而非光秃拒绝；AskFn 加宽 DenyGrant（老询问器零改动），空/畸形理由回落普通拒绝。
