---
"@nova-agent/tui-view": patch
---

思考流式尾行去掉轮换动画字符：最后一行显示纯暗色正文，不再前缀 braille 码字（"生成中"由 composer 前缀 spinner 表达）；spinner tick 对 reasoning 活窗口的周期性重绘随之移除。
