---
'@nova-agent/web': patch
---

WebUI 首页对齐 ZCode 第二刀：真机对照后的比例/层次/位置修正（参照值全部重读克隆仓源码）。

**Composer 卡两层结构**（参照 `ConversationComposer` + `ChatPromptEditor`）：灰卡壳（3% 黑、16px、无边框）背大柔影 `shadow-xl/5`；白芯（`bg-input`）带 0.5px 边框、hover/focus 加深、紧双层柔影、12px 内距与行距；卡壳 6px 内距承载 header 灰条。hero 卡回归 672 满宽（去掉内层 16px×2 克扣）。发送钮 28px 圆、ink 填充、disabled 0.5（参照 `icon-md`/`bg-brand`）。

**Hero**：线框从全高滚动区中心移回问候行中心、向上溢出（参照的锚定结构；上一版中心落在白卡后面只露一段弧线）；线框重画为占满 400px 盒的「新星 + 轨道环 + 双伴星」构图；墨色加深至 muted × 0.7（参照 effective ~28% alpha）。问候→卡间距 44px（参照 `sm:mb-8`+`mt-3`）。

**侧栏**：头部只留搜索 + 视图菜单两控件（刷新收进视图菜单尾部）；新建任务图标换气泡加号（参照 `MessageCirclePlus`）；底部稳态不再显示「连接成功」胶囊（参照稳态无状态文字，异常/重连态保留）；折叠过渡对齐参照 200ms ease-out（`--nova-dur-panel`/`--nova-ease-panel`）。

**动画核对**：hero 与 composer 参照本无出现动画，不加不减。设计系统 §2.8 随批更新；palette-guard 改钉两层配方契约。
