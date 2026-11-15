/**
 * 通用设置 / 外观 / 权限 版块的文案。
 *
 * Split from the single `copy.ts` table (now a re-export barrel) as part of the
 * settings-page rewrite: one file per settings section means two people editing
 * two sections never touch the same file.
 */
export const GENERAL_COPY = {
  'general.nav': '常规',
  'settings.close': '关闭',
  /* Group heads (2026-11-15, ZCode alignment): every card on the 常规 page now
     sits under a subject line and one sentence of explanation
     (`SettingsGroup`), the reference's own shape. The two group names and their
     descriptions are the reference's wording for the same two concerns. */
  'general.groupRun': '行为与工具',
  'general.groupRunDesc': '设置会话的操作权限与工作步骤的展示方式。',
  'general.groupUi': '界面设置',
  'general.groupUiDesc': '设置应用主题和界面文字大小。',
  'permission.title': '权限',
  'permission.description': '选择新会话的默认权限模式',
  /* 外观 is its own nav page (the reference's `appearance` entry); the label is
     the page name, the group head below stays 界面设置. */
  'appearance.nav': '外观',
  'appearance.title': '界面主题',
  'appearance.description': '选择浅色、深色或跟随系统主题。',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '系统',
  'fontSize.title': '界面字号',
  'fontSize.description': '调整应用界面的文字大小，图标和布局尺寸不受影响。',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'transcript.title': '工作步骤展示',
  'transcript.description': '选择希望看到多少工具调用细节',
  'transcript.compact': '简洁',
  'transcript.standard': '标准',
  'transcript.detailed': '详细',
  'transcript.verbose': '完全展开',
  'config.title': '配置文件',
  'config.description': '内核的唯一配置来源，改动后重启生效',
  'config.copy': '复制路径',
  'config.copied': '已复制',
} as const;
