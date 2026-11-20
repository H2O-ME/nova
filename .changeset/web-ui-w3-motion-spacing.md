---
"nova-agent": patch
---

### W3：动效与间距去重

#### 七份相同的入场动画合并为一份

`from { opacity: 0 }` 这一个动画在仓里有**七份私有副本**：`wide-in`（Sidebar、
SidebarFoot、SessionBrowser 三处）、`rail-in`、`rail-fade-in`、`row-in`、
`dock-row-in`、`change-row-in`。CSS module 只解析自己文件里声明的 keyframes，
所以这七份**互相不可达**，只能各自漂移——正是「第二份实现」缺陷族的教科书样本。

现在只剩 `design/motion.css` 里的 `@keyframes nova-fade-in`，七处引用指向它。
`motion-guard.test.ts` 新增一条守卫：这些 sheet 里出现任何一个旧名字即失败
（已做变异验证：加回 `@keyframes row-in` → 红；移除 → 绿）。

#### 间距阶梯补入 `space-10` / `space-14`

全仓 159 处间距字面量里，**10px 占 63 处、14px 占 39 处**，而阶梯只有
2/4/6/8/12/16/24/32——够不到这两个值。作者只能在「改视觉」和「写字面量」之间
二选一，102 次都选了后者。

用户拍板：**承认设计中真实在用的值**，新增 `--nova-space-10` / `--nova-space-14`，
再机械替换这 102 处。全仓 spacing 债务 **165 → 126**，门禁上限同步收紧到 146。

真机量测确认视觉零变化：`--nova-space-10` 解析为 `10px`、`--nova-space-14` 解析为
`14px`（CDP `getComputedStyle` 实测），设置页卡片几何不变。

`docs/NOVA-DESIGN-SYSTEM.md` §2.1 记录了这两个非 4 倍数台阶的来由与判据。

#### 验证

- `pnpm check` 全绿：207 测试文件 / 2203 断言。
- 前端产物重建成功。
- 变异验证：重复 keyframe 回归 → 红；恢复 → 绿。
