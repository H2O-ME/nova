/**
 * The process group's summary — port of the harness `ui-chat`'s
 * `conversation-nodes/process-activity.ts` (classification, ranking, live
 * detail) + `chat/step-process.ts` (the closed title's composition), (c) 2026
 * DeepSeek — MIT License, read over this repo's own flow blocks.
 *
 * A CLOSED group's title names the work without counts (已读取文件并搜索代码…)
 * so a settled turn's steps collapse to one honest line; a LIVE group's title
 * names the running activity with its task detail (正在运行命令 · git status).
 * Both are pure derivations of the turn's span — the flow hands them over, no
 * renderer classifies tool calls itself.
 */

/** The flow block kinds a turn's span carries (the reducer's union). */
export interface ProcessSpanBlock {
  kind: string;
  /** `tool` blocks: the call's name and its raw JSON arguments. */
  name?: string | undefined;
  args?: string | undefined;
  /** A tool call still in flight (no result yet). */
  running?: boolean | undefined;
  /** `reasoning` blocks: the streamed thought. */
  text?: string | undefined;
}

/** The work categories a group's title can name (the reference's union). */
export type ProcessActivity =
  | 'read' | 'search' | 'write' | 'edit' | 'commands' | 'code'
  | 'webSearch' | 'webFetch' | 'subagents' | 'plan' | 'questions' | 'tools';

/** Ranked distinct-call categories plus the live task evidence. */
export interface ProcessActivitySummary {
  readonly counts: readonly { readonly kind: ProcessActivity; readonly count: number }[];
  readonly running: ProcessActivity | undefined;
  readonly runningDetail: string;
}

/** Settled labels, one per category (the reference's `done.*` vocabulary). */
const DONE_LABEL: Record<ProcessActivity, string> = {
  read: '已读取文件',
  search: '已搜索代码',
  write: '已写入文件',
  edit: '修改了文件',
  commands: '执行了命令',
  code: '运行了代码',
  webSearch: '已搜索网页',
  webFetch: '已访问网页',
  subagents: '已协调子智能体',
  plan: '更新了计划',
  questions: '向用户提出了问题',
  tools: '已调用工具',
};

/** Running labels, one per category (the reference's step-process vocabulary). */
export const RUNNING_LABEL: Record<ProcessActivity, string> = {
  read: '正在读取文件',
  search: '正在搜索代码',
  write: '正在写入文件',
  edit: '正在编辑文件',
  commands: '正在运行命令',
  code: '正在运行代码',
  webSearch: '正在搜索网页',
  webFetch: '正在访问网页',
  subagents: '正在协调子智能体',
  plan: '正在更新计划',
  questions: '等待你的操作',
  tools: '正在调用工具',
};

/** Title fragments (the reference's `joinTwo` / `comma` / `more` / shared prefix). */
const JOIN_TWO = '{first}并{second}';
const COMMA = '，';
const MORE = '{title}等';
const SHARED_PREFIX = '已';

/** Which category a tool call belongs to, by the tool's name. */
function activityOf(name: string): ProcessActivity {
  if (name === 'read_file') return 'read';
  if (name === 'search_files') return 'search';
  if (name === 'write_file') return 'write';
  if (name === 'edit_file') return 'edit';
  if (name === 'bash') return 'commands';
  if (name === 'run_code') return 'code';
  if (name === 'web_search') return 'webSearch';
  if (name === 'web_fetch') return 'webFetch';
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents';
  if (['todo_write', 'create_goal', 'update_goal'].includes(name)) return 'plan';
  if (name === 'ask_user_question') return 'questions';
  return 'tools';
}

/** Characters kept of a live task detail. */
const DETAIL_MAX = 160;
/** Args keys a live detail may name, in priority order (the reference's list). */
const DETAIL_KEYS = [
  'title', 'description', 'objective', 'task', 'name', 'question', 'prompt', 'message',
  'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'file_path', 'path', 'target',
] as const;

/** One line, whitespace collapsed, cut on code points so a surrogate pair never splits. */
function normalizeDetail(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value.join(', ')
      : '';
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= DETAIL_MAX ? flat : `${chars.slice(0, DETAIL_MAX - 1).join('').trimEnd()}…`;
}

/** The live detail for a running call: the first args key that says something. */
function liveDetailOf(name: string, argsRaw: string | undefined): string {
  let args: unknown;
  try {
    args = argsRaw === undefined ? undefined : JSON.parse(argsRaw);
  } catch {
    return normalizeDetail(name);
  }
  if (args === null || typeof args !== 'object') return normalizeDetail(name);
  for (const key of DETAIL_KEYS) {
    if (key in args) {
      const detail = normalizeDetail((args as Record<string, unknown>)[key]);
      if (detail !== '') return detail;
    }
  }
  return normalizeDetail(name);
}

/**
 * Rank a turn's tool calls into categories — distinct-call counts, ties broken
 * by first appearance — plus the newest running call's category and task
 * detail; with no running call the detail falls back to the thought's newest
 * finished paragraph (the reference's `liveReasoningDetail`).
 */
export function processActivityOf(span: readonly ProcessSpanBlock[]): ProcessActivitySummary {
  const counts = new Map<ProcessActivity, number>();
  let running: ProcessActivity | undefined;
  let runningDetail = '';
  for (const block of span) {
    if (block.kind !== 'tool' || block.name === undefined) continue;
    const kind = activityOf(block.name);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (block.running === true) {
      running = kind;
      runningDetail = liveDetailOf(block.name, block.args);
    }
  }
  if (running === undefined) {
    for (let at = span.length - 1; at >= 0; at -= 1) {
      const block = span[at];
      if (block?.kind !== 'reasoning') continue;
      const paragraphs = (block.text ?? '').split(/\r?\n[\t ]*\r?\n/);
      for (let p = paragraphs.length - 1; p >= 0; p -= 1) {
        const detail = normalizeDetail(paragraphs[p]?.replaceAll('**', ''));
        // `running` stays undefined: the renderer reads the empty category as
        // "analyzing" (the reference's `?? 'thinking'` at the header seat).
        if (detail !== '') return { counts: ranked(counts), running, runningDetail: detail };
      }
    }
  }
  return { counts: ranked(counts), running, runningDetail };
}

/** Count-descending ranking; a Map keeps first-appearance order for ties. */
function ranked(counts: Map<ProcessActivity, number>): ProcessActivitySummary['counts'] {
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
}

/** The live group's title: the running activity, its task detail only when the policy shows it. */
export function liveTitleOf(summary: ProcessActivitySummary, detailed: boolean): string {
  const label = summary.running === undefined ? '正在分析请求' : RUNNING_LABEL[summary.running];
  return detailed && summary.runningDetail !== '' ? `${label} · ${summary.runningDetail}` : label;
}

/**
 * Compose a closed group's title from its top three categories — one names
 * itself, two join with 并 (the shared 已 prefix dropped from the second ONLY
 * when both carry it), three or more join with commas; 等 marks a cut list,
 * so it appears only past three categories. (The reference lowercases the
 * continuation labels for English; that continuation is a no-op in zh.)
 */
export function processTitle(summary: ProcessActivitySummary): string {
  const labels = summary.counts.slice(0, 3).map(({ kind }) => DONE_LABEL[kind]);
  const first = labels[0];
  if (first === undefined) return '已完成分析';
  const second = labels[1];
  if (second === undefined) return first;
  if (labels[2] === undefined) {
    const shared = first.startsWith(SHARED_PREFIX) && second.startsWith(SHARED_PREFIX);
    return JOIN_TWO
      .replace('{first}', first)
      .replace('{second}', shared ? second.slice(SHARED_PREFIX.length) : second);
  }
  const title = [first, ...labels.slice(1)].join(COMMA);
  return summary.counts.length > 3 ? MORE.replace('{title}', title) : title;
}
