/**
 * Composer + queue lane + status bar (the bottom stack, one left margin —
 * same column discipline as the terminal design language). Enter sends,
 * Shift+Enter newline; disabled while an approval modal owns the keyboard.
 */
import { useState } from 'react';
import type { ClientFrame } from './types.js';

const PHASE_WORDS: Record<string, string> = {
  idle: '',
  thinking: '思考中',
  writing: '输出中',
  tool: '执行工具',
  waiting_approval: '等待审批',
  compacting: '压缩中',
  retrying: '重试中',
  disconnected: '已断线，重连中…',
};

export function Composer({
  send,
  disabled,
  phase,
  queued,
  running,
  meta,
  connected,
}: {
  send: (f: ClientFrame) => void;
  disabled: boolean;
  phase: string;
  queued: readonly string[];
  running: boolean;
  meta: { model: string; approvalMode: string; rootDir: string } | null;
  connected: boolean;
}): JSX.Element {
  const [text, setText] = useState('');
  const submit = (): void => {
    const value = text.trim();
    if (value.length === 0) return;
    send({ type: 'prompt', text: value });
    setText('');
  };
  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#16161d] via-[#16161d] to-transparent px-6 pb-4 pt-2">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {running && (
          <div className="flex items-center justify-end">
            <button
              onClick={() => send({ type: 'abort' })}
              className="rounded-md border border-[#505058] px-2.5 py-1 text-xs text-[#e0af68] hover:border-[#e0af68]"
              title="中断当前轮"
            >
              ■ 中断
            </button>
          </div>
        )}
        {queued.length > 0 && (
          <div className="rounded-md border border-[#2c2c36] bg-[#1a1a22] px-3 py-1.5 text-xs text-[#6c6c76]">
            ⧉ 已排队 {queued.length} 条：{queued.join(' | ').slice(0, 120)}
            {queued.join(' | ').length > 120 ? '…' : ''}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-[#505058] bg-[#1c1c24] px-3 py-2 focus-within:border-[#1abc9c]">
          <span className="select-none pb-1.5 text-[#1abc9c]">❯</span>
          <textarea
            value={text}
            rows={1}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={disabled ? '等待审批…' : '描述任务，Enter 发送 · Shift+Enter 换行'}
            className="max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-[#5c5c66] disabled:cursor-not-allowed"
          />
          <button
            onClick={submit}
            disabled={disabled || text.trim().length === 0}
            className="rounded-md bg-[#1abc9c] px-3 py-1.5 text-sm font-medium text-[#0d0d12] hover:bg-[#28d0b0] disabled:opacity-30"
          >
            发送
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 text-[12px] text-[#6c6c76]">
          <span className={`inline-block size-2 rounded-full ${connected ? 'bg-[#9ece6a]' : 'bg-[#f7768e]'}`} />
          <span>{PHASE_WORDS[phase] ?? phase}</span>
          {meta !== null && (
            <span className="ml-auto truncate">
              {meta.model} · {meta.approvalMode} · {meta.rootDir}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
