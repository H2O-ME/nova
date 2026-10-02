/**
 * Every word the right panel renders.
 *
 * A typed dictionary rather than inline strings at the call sites, the same rule
 * the sidebar column follows: the panel is four pages in one box, and a label
 * that exists only where it is drawn is a label nobody finds when the wording
 * moves. Keys name the ROLE (what the reader is looking at), never the widget
 * that happens to hold it.
 *
 * Rebuilt with the panel: the previous dictionary carried the pages this one
 * replaced (an editor tab, a session-file list, a terminal made of jobs), and a
 * key no page reads is a promise nothing keeps.
 */
export const RIGHTBAR_COPY = {
  /** The panel's own accessible name (the tab strip carries no title row). */
  'panel.label': '侧边栏',
  'panel.open': '打开侧边栏',
  'panel.close': '关闭侧边栏',
  'panel.fullscreen': '全屏',
  'panel.exitFullscreen': '退出全屏',
  'panel.newTab': '打开开始页',
  'panel.closeTab': '关闭标签页',
  'tab.guide': '开始',
  'tab.changes': '变更',
  'tab.files': '文件',
  'tab.tasks': '任务',
  'tab.terminal': '终端',
  'start.changes.note': '本会话动过的文件与工作区 git 状态',
  'start.files.note': '浏览会话工作区的文件',
  'start.tasks.note': '后台命令与子代理',
  'start.terminal.note': '在会话工作区运行命令',

  // ---- 变更 ----
  'changes.lens.label': '改动视角',
  'changes.lens.git': '工作区',
  'changes.lens.session': '本会话',
  'changes.empty': '本会话还没有文件改动',
  'changes.empty.note': '改动来自本会话的工具调用（edit_file / write_file），不是工作区当前状态',
  'changes.summary': '{files} 个文件 · +{added} −{removed}',
  'changes.list.label': '改动文件',
  'changes.cut': '已折叠 {n} 行未变内容',
  'changes.running': '进行中',
  'changes.failed': '失败',
  'changes.done': '已完成',

  // ---- git（变更页的工作区视角） ----
  'git.loading': '正在读取 git 状态…',
  'git.setup.title': '源代码管理',
  'git.setup.body': '为了使用 Git 功能，可打开包含 Git 仓库的文件夹，或从 URL 克隆一个仓库。',
  'git.setup.open': '打开文件夹',
  'git.setup.clone': '克隆仓库',
  'git.clone.placeholder': '仓库 URL（https:// 或 git@…）',
  'git.clone.run': '克隆',
  'git.clone.running': '正在克隆…',
  'git.clone.cancel': '取消',
  'git.empty': '工作区是干净的',
  'git.branch': '分支 {branch}',
  'git.refresh': '刷新 git 状态',
  'git.stagedSection': '已暂存',
  'git.unstagedSection': '未暂存',
  'git.stage': '暂存',
  'git.unstage': '取消暂存',
  'git.openTab': '打开文件标签页',
  'git.stageAll': '全部暂存',
  'git.unstageAll': '全部取消暂存',
  'git.select': '选择一个文件查看改动',
  'git.untrackedNote': '新文件为空、是二进制或超出预算，这里不放内容；可用文件页打开。',
  'git.diffTruncated': '差异过长，只显示了一部分',
  'git.diffMore': '差异过长，其余行未渲染',
  'git.commit.placeholder': '提交说明',
  'git.commit.nothingStaged': '先暂存改动，再提交',
  'git.commit': '提交',
  'git.log': '最近提交',

  // ---- 文件（树 + 预览） ----
  'files.workspace': '工作区',
  'files.noWorkspace': '当前会话没有工作区',
  'files.loading': '正在读取…',
  'files.empty': '工作区里没有可列出的条目',
  'files.emptyDir': '（空目录）',
  'files.truncated': '条目过多，只列出前一部分',
  'files.search.label': '过滤文件树',
  'files.search.placeholder': '过滤文件名…',
  'files.search.empty': '没有匹配的文件（只过滤已加载的目录）',
  'files.reload': '刷新工作区目录',
  'files.hidden': '隐藏',
  'files.open': '打开',
  'files.reference': '引用为 @ 文件（插入输入框）',
  'files.copyPath': '复制路径',
  'files.copied': '已复制',
  'files.menu': '文件操作',
  'files.newFile': '新建文件',
  'files.newFolder': '新建文件夹',
  'files.rename': '重命名',
  'files.reveal': '在文件管理器中显示',
  'files.delete': '删除',
  'files.delete.confirm': '删除 {name}？目录会连同其中的内容一起删除。',
  'files.name.placeholder': '名称',
  'files.selected': '已选择 {count} 项',
  'files.deleteSelected': '删除所选',
  'files.deleteSelected.confirm': '删除选中的 {count} 项？此操作不可撤销。',
  'files.clearSelection': '取消选择',
  'files.hideTree': '收起文件树',
  'files.showTree': '展开文件树',
  'files.resizeTree': '拖动调整文件树宽度',

  // ---- 文件标签页（只读查看器） ----
  'file.wrap': '自动换行',
  'file.copy': '复制内容',
  'file.copied': '已复制',
  'file.reread': '重新读取',
  'editor.close': '关闭文件标签页',
  'editor.binary': '这是二进制文件，没有可显示的文本',
  'editor.truncated': '文件超过 {kb} KB，只读通道不取全文',
  'editor.readError': '无法读取：{message}',
  'editor.loading': '正在读取…',

  // ---- 任务 ----
  'tasks.title': '后台任务',
  'tasks.refresh': '刷新后台任务',
  'tasks.loading': '正在读取后台任务…',
  'tasks.empty': '没有后台任务',
  'tasks.empty.note': '后台命令与子代理会出现在这里；输出在转录里看',
  'tasks.running': '运行中',
  'tasks.stopping': '正在停止',
  'tasks.completed': '已完成',
  'tasks.killed': '已取消',
  'tasks.failed': '已失败',
  'tasks.stop.row': '停止任务 {label}',
  'tasks.stop.confirm': '再次点击确认停止',
  'tasks.stop.action': '确认停止',
  'tasks.expand': '展开 {label} 的详情',
  'tasks.collapse': '收起 {label} 的详情',
  'tasks.duration.live': '已运行 {duration}',
  'tasks.duration.done': '耗时 {duration}',
  'tasks.meta.progress': '进度',
  'tasks.meta.started': '开始',
  'tasks.meta.finished': '结束',
  'tasks.meta.id': '任务 ID',

  // ---- 终端 ----
  'term.output': '终端',
  'term.off': '未开启',
  'term.running': '运行中',
  'term.exited': '已退出',
  'term.code': '退出码 {code}',
  'term.unavailable': '终端不可用',
  'term.restart': '重开终端',
  'term.new': '新建终端',
  'term.shellLoading': '正在探测 Shell…',
  'term.loadfailed': '终端模拟器加载失败：{message}',
  'term.shell': 'Shell',
} as const;

/** One key of the panel's dictionary (`keyof` without importing the type name). */
export type RightbarCopyKey = keyof typeof RIGHTBAR_COPY;
