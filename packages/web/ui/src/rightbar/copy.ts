/**
 * Every word the right panel renders.
 *
 * A typed dictionary rather than inline strings at the call sites, the same rule
 * the sidebar column follows: the panel is three surfaces in one box, and a
 * label that exists only where it is drawn is a label nobody finds when the
 * wording moves. Keys name the ROLE (what the reader is looking at), never the
 * widget that happens to hold it.
 */
export const RIGHTBAR_COPY = {
  /** The panel's own accessible name (the tab strip carries no title row). */
  'panel.label': '侧边栏',
  'panel.open': '打开侧边栏',
  'panel.close': '关闭侧边栏',
  'panel.fullscreen': '全屏',
  'panel.exitFullscreen': '退出全屏',
  'tab.changes': '变更',
  'tab.files': '文件',
  'tab.terminal': '终端',
  'changes.empty': '本会话还没有文件改动',
  'changes.empty.note': '改动来自本会话的工具调用（edit_file / write_file），不是工作区当前状态',
  'changes.summary': '{files} 个文件 · +{added} −{removed}',
  'changes.list.label': '改动文件',
  'changes.select': '选择一个文件查看改动',
  'changes.cut': '已折叠 {n} 行未变内容',
  'changes.running': '进行中',
  'changes.failed': '失败',
  'changes.done': '已完成',
  'files.workspace': '工作区',
  'files.sessions': '会话文件',
  'files.reload': '刷新工作区目录',
  'files.empty': '工作区里没有可列出的条目',
  'files.emptyDir': '（空目录）',
  'files.loading': '正在读取…',
  'files.truncated': '条目过多，只列出前一部分',
  'files.copyPath': '复制路径',
  'files.copied': '已复制',
  'files.expand': '展开目录',
  'files.collapse': '折叠目录',
  'files.sessions.empty': '还没有会话文件',
  'files.sessions.current': '当前会话',
  'files.noWorkspace': '当前会话没有工作区',
  'terminal.input.label': '在会话工作区运行命令',
  'terminal.input.placeholder': '输入命令，回车运行',
  'terminal.run': '运行',
  'terminal.stop': '停止',
  'terminal.empty': '还没有命令',
  'terminal.empty.note': '非交互：命令一次提交、输出增量读取，不能输入交互式内容',
  'terminal.running': '运行中',
  'terminal.completed': '已完成',
  'terminal.failed': '失败',
  'terminal.stopped': '已停止',
  'terminal.stopping': '正在停止',
} as const;

/** One key of the panel's dictionary (`keyof` without importing the type name). */
export type RightbarCopyKey = keyof typeof RIGHTBAR_COPY;
