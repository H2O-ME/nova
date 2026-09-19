/**
 * The approval modal (2b): renders the ApprovalRequest as the kernel sent it
 * (kind + tool + args + effect preview) and answers with resolve_approval.
 * Keys follow the REPL contract (y/a/n) plus the deny-with-reason lane.
 * While the modal is up the composer is inert — one question at a time.
 */
import { useState } from 'react';
import type { ApprovalRequest, ClientFrame } from './types.js';

const KIND_LABELS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

export function Approval({ request, send }: { request: ApprovalRequest; send: (f: ClientFrame) => void }): JSX.Element {
  const [reason, setReason] = useState('');
  const args = request.call.rawArgs.replace(/\s+/g, ' ').trim();
  const answer = (a: 'allow' | 'always' | 'deny' | { reason: string }): void => {
    send({ type: 'resolve_approval', id: request.id, answer: a });
  };
  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-[#505058] bg-[#1c1c24] p-4 shadow-xl">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold text-[#e0af68]">! 需要审批</span>
        <span className="text-[#6c6c76]">[{KIND_LABELS[request.kind] ?? request.kind}]</span>
        <span className="font-medium text-[#e6e6ea]">{request.call.name}</span>
      </div>
      <div className="mb-2 max-h-40 overflow-y-auto rounded-md bg-[#0d0d12] p-2 font-mono text-[12px] leading-5 text-[#a0a0aa]">
        {request.preview !== undefined && request.preview.length > 0 ? (
          request.preview.map((line, i) => (
            <div key={i} className={line.startsWith('+') ? 'text-[#9ece6a]' : line.startsWith('-') ? 'text-[#f7768e]' : undefined}>
              {line}
            </div>
          ))
        ) : (
          <div className="break-all">{args}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => answer('allow')} className="rounded-md bg-[#1abc9c] px-3 py-1.5 text-sm font-medium text-[#0d0d12] hover:bg-[#28d0b0]">
          允许一次 <kbd className="opacity-60">y</kbd>
        </button>
        <button onClick={() => answer('always')} className="rounded-md border border-[#505058] px-3 py-1.5 text-sm text-[#d4d4d8] hover:border-[#1abc9c]">
          总是允许 <kbd className="opacity-60">a</kbd>
        </button>
        <div className="flex min-w-56 flex-1 items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reason.trim().length > 0) answer({ reason: reason.trim() });
            }}
            placeholder="拒绝可附理由（回车发送）…"
            className="min-w-0 flex-1 rounded-md border border-[#505058] bg-[#16161d] px-2 py-1.5 text-sm outline-none placeholder:text-[#5c5c66] focus:border-[#f7768e]"
          />
          <button
            onClick={() => (reason.trim().length > 0 ? answer({ reason: reason.trim() }) : answer('deny'))}
            className="rounded-md border border-[#505058] px-3 py-1.5 text-sm text-[#f7768e] hover:border-[#f7768e]"
          >
            拒绝 <kbd className="opacity-60">n</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
