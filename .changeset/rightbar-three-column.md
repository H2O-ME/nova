---
'@nova-agent/web': minor
---

右栏改为**真实三分**：面板打开时占住自己的网格轨道，中间列让位——此前面板恒以 `position:absolute` 挂在会话之上（`track` 从移植起就没传过 `true`），看起来是悬浮层而不是 dsh 那样的第三列。

- **根因是移植疏漏**：参照件 `ui-layout` 的规则是 `track = shown && !autoFullscreen`——正常打开的右栏**必占轨**，只有窄屏自动全屏才不占。nova 的 `App.tsx` 从 WebUI 首版起恒定上报 `openRightbar(false, false)`，于是 `cols.rightbar` 恒为 0、面板悬在内容上。`columns.ts` / `layout-store.ts` 的机制本来就是对的（`rightbarTrack` 的注释写着「正常面板宽度是否占轨」），只有上报值错。
- **规则结构化，不再有参数可传错**：`openRightbar(state, fullscreen)` 自己把 `rightbarTrack` 置真（shown ⇒ 必占轨；全屏保留轨道，退出落回同一会话宽度）——`track` 参数整个删掉，调用方没有传错的地方。`App.tsx` 的打开路径与全屏切换都走这一个入口。killing test 在 `layout-store.test.ts`（`openRightbar(wide(), false).rightbarTrack === true`；把它改回假即红）。
- **随之而正**：面板与轨道同宽（`normal.rightbar` 与 `cols.rightbar` 同源求解），拖拽手柄正好落在轨道边界；打开/关闭的缓动由既有的 `data-animating` 门控驱动（轨道收放与面板从右缘滑入同一条曲线）。窄到轨道放不下时仍是 `takeover`（`computeColumns` 解出 0 轨，面板占满），不需要参照件的 `autoFullscreen` 标志。
- **停靠列不再画投影**：两块右栏面板（`RightbarPanel` 与工具详情 `ToolPanel`）此前都带 `box-shadow: var(--dsw-shadow-lv3)`，而参照件的阴影只属于浮动窗口（dockkit 的 `.float`）——停靠列是平的页面家具。两份样式表都写着「是页面的一列、不是浮起来的表面」却同时声明投影，自相矛盾；去掉投影后悬浮感才真正消失（用户报告「视觉效果还是悬浮感觉」）。护栏 `style-guard.test.ts` 新增一条：两个面板的 `.panel` 块不得出现 `box-shadow`（把投影加回去即红）。
- `AppFrame.module.css` 与 `RightbarPanel.module.css` / `ToolPanel.module.css` 的头注释按现状改写（不再把「零轨悬浮」与「lv3 elevation 是本前端惯例」写成常态）。
