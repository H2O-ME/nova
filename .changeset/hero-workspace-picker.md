---
'@nova-agent/core': patch
'@nova-agent/web': patch
---

网络界面：修复 hero 工作区切换

- 工作区 chip 移出 HeroShell，按 dsh 装配为 composer hero 栈里的平级行，修复 chip 与卡片轴线错位（此前继承外壳 24px 内边距而右偏 24px）。
- 弹出菜单必须有真实行才渲染：菜单现存工作区 + 「打开文件夹…」，首次访问再也不会出现空白白条（此前 recentWorkspaces 为空导致菜单零行）。
- 新增进程内目录浏览器（`list_directory` / `create_directory` 帧 + DirectoryBrowser 弹窗）：主目录起、面包屑导航、仅列目录、绝不跟随符号链接、创建文件夹、拒绝与空列表区分。
- 设置面板关闭按钮归位右上角（补回 `.actions` 席位）。