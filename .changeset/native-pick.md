---
'@nova-agent/web': minor
---

WebUI 挑文件 / 换工作区改为**宿主原生对话框优先**，手写目录浏览器降为回落。

浏览器给不了文件的真实路径（`File.path` 是 Electron 扩展，`showDirectoryPicker()` 的 handle 也不带 `path`），而 `@` 引用和工作区都按绝对路径采纳——所以新增两个客户端帧 `pick_file` / `pick_directory`，由宿主进程（与其它变更帧同一 launch token 认证）弹出操作系统自己的对话框，把选中的绝对路径经新的 `picked` 帧回给浏览器：

- Windows 走 PowerShell + WinForms（`OpenFileDialog` / `FolderBrowserDialog`，零第三方依赖）；POSIX 走 `zenity`；都没有时回 `picked.error`，前端自动回落到原进程内目录浏览器，行为与从前一致。
- **Windows 对话框弹出前先合成一次 Alt 按键**（`keybd_event(VK_MENU)` down/up）：后台宿主没有前台权，不这样做对话框会开在浏览器后面，用户看到的就是「点了没反应」——这是 dsh `win32-dialog-worker` 的同一机制（实测截屏验证：不带时截屏只有浏览器，带上后对话框在最前）。
- `picked` 的三种读法是三个事实：带 `path` = 选中；带 `error` = 本机没有对话框可开（回落）；两者皆无 = 用户取消（仍回一条裸 `picked`，前端读作「无事发生」，单飞守卫照常落锁）。
- 前端两个入口——composer `+` 菜单「引用本地文件」与 hero 的「打开文件夹」——都改为原生优先；同一时刻只允许一个对话框在飞，断连自动释放挂起的等待。
- 对话框是模态、用户-paced 的，子进程不设超时；取消与空输出是同一结果。
