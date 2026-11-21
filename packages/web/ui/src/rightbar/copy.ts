/**
 * Every word the right panel renders.
 *
 * A typed dictionary rather than inline strings at the call sites. Keys name
 * the ROLE (what the reader is looking at), never the widget that happens to
 * hold it. The panel now renders exactly two things — the workspace directory
 * and a file preview — so the dictionary carries those keys only.
 */
export const RIGHTBAR_COPY = {
  /** The panel's own accessible name (the tab strip carries no title row). */
  /* The RIGHT column. Named 右侧面板, not 侧边栏: the sidebar is the left
     navigation column and has its own toggle — two controls sharing one word
     was the reason the operator read them as the same button twice. */
  'panel.label': '右侧面板',
  'panel.open': '打开右侧面板',
  'panel.close': '关闭右侧面板',
  'panel.fullscreen': '全屏',
  'panel.exitFullscreen': '退出全屏',
  'panel.closeTab': '关闭标签页',
  'tab.files': '文件',

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
} as const;

/** One key of the panel's dictionary (`keyof` without importing the type name). */
export type RightbarCopyKey = keyof typeof RIGHTBAR_COPY;
