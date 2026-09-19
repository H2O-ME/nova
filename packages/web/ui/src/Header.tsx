/**
 * The header strip (M11 批3): context gauge, session-level mode switches and
 * the session switcher's button. Everything shown here is state the host
 * reported (`ready`/`state` frames) — the strip renders, it never guesses.
 */
import type { ApprovalMode, ClientFrame, PtcMode } from './types.js';

const APPROVAL_MODES: readonly { code: ApprovalMode; label: string; hint: string }[] = [
  { code: 'read-only', label: '只读', hint: '读操作自动放行，写/执行逐次确认' },
  { code: 'auto-edit', label: '自动编辑', hint: '工作区内写入自动放行，执行仍确认' },
  { code: 'full', label: '全部放行', hint: '一切操作不再确认（信任姿态等同执行任意命令）' },
];

const CODE_MODES: readonly { code: PtcMode; label: string; hint: string }[] = [
  { code: 'native', label: '普通', hint: '只暴露原生工具调用' },
  { code: 'ptc', label: 'PTC', hint: '只暴露 run_code（模型写程序批量调用工具）' },
  { code: 'both', label: '混合', hint: '原生工具与 run_code 同时可用' },
];

export function Header({
  model,
  rootDir,
  approvalMode,
  codeMode,
  usedTokens,
  contextWindow,
  queued,
  sessionsOpen,
  send,
  onToggleSessions,
  onCompact,
  compactBusy,
  canCompact,
}: {
  model: string;
  rootDir: string;
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  usedTokens: number;
  contextWindow: number | null;
  queued: number;
  sessionsOpen: boolean;
  send: (f: ClientFrame) => void;
  onToggleSessions: () => void;
  onCompact: () => void;
  compactBusy: boolean;
  canCompact: boolean;
}): JSX.Element {
  return (
    <div className="border-b border-[#2c2c36] bg-[#16161d]/95 px-6 py-2">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
        <span className="font-medium text-[#e6e6ea]">Nova</span>
        <Gauge usedTokens={usedTokens} contextWindow={contextWindow} />
        <ModeGroup
          items={APPROVAL_MODES}
          current={approvalMode}
          onPick={(mode) => send({ type: 'set_approval_mode', mode })}
        />
        <ModeGroup items={CODE_MODES} current={codeMode} onPick={(mode) => send({ type: 'set_code_mode', mode })} />
        <div className="ml-auto flex items-center gap-2 text-[#6c6c76]">
          {queued > 0 && <span className="text-[#e0af68]">排队 {queued}</span>}
          <span className="max-w-56 truncate" title={rootDir}>{model}</span>
          <button
            onClick={onCompact}
            disabled={!canCompact || compactBusy}
            className="rounded border border-[#505058] px-2 py-0.5 hover:border-[#1abc9c] disabled:opacity-30"
            title="压缩上下文（把历史摘要化，原文存档可回查）"
          >
            {compactBusy ? '压缩中…' : '压缩'}
          </button>
          <button
            onClick={onToggleSessions}
            className={`rounded border px-2 py-0.5 ${sessionsOpen ? 'border-[#1abc9c] text-[#1abc9c]' : 'border-[#505058] hover:border-[#1abc9c]'}`}
            title="切换 / 新建会话"
          >
            会话
          </button>
        </div>
      </div>
    </div>
  );
}

/** Used / window with a severity breakpoint — the terminal's 50/70/90 ladder. */
function Gauge({ usedTokens, contextWindow }: { usedTokens: number; contextWindow: number | null }): JSX.Element {
  if (contextWindow === null || contextWindow <= 0) {
    return <span className="text-[#6c6c76]">上下文 {humanTokens(usedTokens)}</span>;
  }
  const ratio = Math.min(1, usedTokens / contextWindow);
  const color = ratio >= 0.9 ? '#f7768e' : ratio >= 0.7 ? '#e0af68' : ratio >= 0.5 ? '#1abc9c' : '#6c6c76';
  const segments = 16;
  const filled = Math.round(ratio * segments);
  return (
    <span className="flex items-center gap-2" title={`上下文 ${humanTokens(usedTokens)} / ${humanTokens(contextWindow)}`}>
      <span className="flex gap-px">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className="inline-block h-3 w-1.5 rounded-[1px]"
            style={{ backgroundColor: i < filled ? color : '#2c2c36' }}
          />
        ))}
      </span>
      <span style={{ color }}>
        {humanTokens(usedTokens)}/{humanTokens(contextWindow)} · {Math.round(ratio * 100)}%
      </span>
    </span>
  );
}

function ModeGroup<T extends string>({
  items,
  current,
  onPick,
}: {
  items: readonly { code: T; label: string; hint: string }[];
  current: T;
  onPick: (code: T) => void;
}): JSX.Element {
  return (
    <span className="flex overflow-hidden rounded border border-[#2c2c36]">
      {items.map((item) => (
        <button
          key={item.code}
          onClick={() => onPick(item.code)}
          title={item.hint}
          className={`px-2 py-0.5 ${item.code === current ? 'bg-[#1abc9c]/20 text-[#1abc9c]' : 'text-[#6c6c76] hover:text-[#d4d4d8]'}`}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}

export function humanTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}