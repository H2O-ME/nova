---
"@nova-agent/core": patch
"@nova-agent/web": patch
---

**工作区选择器不再只能选 C 盘**。用户报的是「选择工作区文件夹怎么只能选 C 盘的」，根因是两条规则叠加：`crumbChain` 只靠 `path.dirname` 往上走，而**盘符是路径树的死端**（`dirname('C:\') === 'C:\'`）；同时面包屑被裁剪到从主目录开始，而主目录只落在**一个**盘上。于是 Windows 上除了 home 所在的那个卷，其它盘（`D:` 数据盘、挂载的备份卷、第二块 SSD）无论往上点多少次都到不了。

- **卷列表成为宿主事实**（`core/directory-roots.ts`）：随每一层下发 `roots`，Windows 逐个 `stat` 探活（空光驱与未分配盘符**不出现**——点了报错的行比没有这行更糟；探活并发，成本是一轮 syscall 而非 26 次串行），POSIX 缩成单个 `/`。前端画成盘符行，任意深度一键可达。这条也解释了为什么不能靠浏览器自带的文件夹选择器：`showDirectoryPicker()` 在 `http://127.0.0.1` 上**确实存在**（回环算安全上下文），但它 resolve 出的 `FileSystemDirectoryHandle` **不带路径**——只有 `name`/`kind`/`isSameEntry`，`path` 是 Electron 的扩展；而工作区是按**绝对路径**被采纳的（内核拿它重指 bash/search/fs 的根），所以一个宿主叫不出名字的 handle 不可用。
- **按 dsh 原样补上路径编辑框**（`.crumbEditZone`）：面包屑右侧的铅笔把 crumb 条换成输入框，回车即去。这是表达任何链上位置之外地点的通用出口，也是参考实现自己的答案。分隔符从宿主下发的 `home` 读，浏览器不猜（POSIX 上反斜杠是合法文件名字符）。
- **按职责拆文件**（行数天花板就是「拆它」的指令）：`directory-listing.ts`（189 行）拆为 listing / roots / create 三份，创建的名字校验随写入走。
- `DirectoryBrowser` 拆成 portal 包装 + 无 portal 的 `DirectoryBrowserDialog` 纯 markup，让无 DOM 的静态测试车道能直接走它（与 `SettingsPanel` 的 `SettingsDialog` 同一手法）。
- 测试：core 侧钉住「roots 随层下发」「Windows 只出现能 stat 的盘」「POSIX 是 `/`」；UI 侧新增 `directory-browser.test.tsx` 钉住盘符行、路径框、拒绝态与 `..` 行的存在条件。
