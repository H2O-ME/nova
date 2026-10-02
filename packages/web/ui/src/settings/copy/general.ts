/**
 * 通用设置 / 外观 / 权限 版块的文案。
 *
 * Split from the single `copy.ts` table (now a re-export barrel) as part of the
 * settings-page rewrite: one file per settings section means two people editing
 * two sections never touch the same file.
 */
export const GENERAL_COPY = {
  'general.nav': '通用设置',
  'settings.close': '关闭',
  'permission.title': '权限',
  'permission.description': '选择新会话的默认权限模式',
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
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
