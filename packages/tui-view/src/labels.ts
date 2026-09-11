/** Human-facing labels for modes, tools and permission kinds. */

/** Fixed cycle order for /approvals. */
export const APPROVAL_ORDER = ['read-only', 'auto-edit', 'full'] as const;

const APPROVAL_LABELS: Record<string, string> = {
  'read-only': '只读',
  'auto-edit': '自动编辑',
  full: '全部放行',
};

export function approvalLabel(mode: string): string {
  return APPROVAL_LABELS[mode] ?? mode;
}

/**
 * Approval options as {code,label} pairs. The popup highlights by index and
 * resolves by code — previously a Chinese label array and an English code
 * array were aligned by implicit index, so inserting one option silently
 * remapped the other.
 */
export const APPROVAL_OPTIONS = [
  { code: 'allow', label: '允许一次' },
  { code: 'always', label: '总是允许' },
  { code: 'deny', label: '拒绝' },
] as const;

export type ApprovalChoice = (typeof APPROVAL_OPTIONS)[number]['code'];

const TOOL_LABELS: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  list_dir: '列出目录',
  search_files: '搜索工作区',
  jobs: '后台任务',
  todo_write: '更新待办',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `调用 ${name}`;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

export function permissionLabel(kind: string): string {
  return PERMISSION_LABELS[kind] ?? kind;
}
