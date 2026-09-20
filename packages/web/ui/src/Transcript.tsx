/**
 * Transcript projection of the reducer's blocks. Auto-anchors to the bottom
 * when the user is already near it (the terminal's tail-follow contract), and
 * renders each block by kind — tool rows delegate to ToolCard, so the card
 * shapes live in exactly one place.
 *
 * Two rows exist for things the transcript would otherwise swallow: a run's
 * `meta` line (when it ran, how long, how fast) and a background `job` row
 * that is rewritten in place as the job progresses.
 */
import { useEffect, useRef } from 'react';
import { renderMarkdown } from './markdown.js';
import { ToolCard } from './ToolCard.js';
import { formatClock, runMetaText } from './format.js';
import type { JobSnapshot } from './types.js';
import type { Block } from './state.js';

export function Transcript({
  blocks,
  idle,
  hidden,
  onLoadEarlier,
  onOpenTool,
  selectedCallId,
}: {
  blocks: Block[];
  idle: boolean;
  /** Older blocks the baseline holds but the browser has not loaded yet. */
  hidden: number;
  onLoadEarlier: () => void;
  onOpenTool: (callId: string) => void;
  selectedCallId: string | null;
}): JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) endRef.current?.scrollIntoView({ block: 'end' });
  }, [blocks]);

  return (
    <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto max-w-3xl space-y-2">
        {hidden > 0 && (
          <div className="pb-1 text-center">
            <button
              type="button"
              onClick={onLoadEarlier}
              className="rounded-full border border-[#2c2c36] px-3 py-1 text-[12px] text-[#8a8a94] hover:border-[#3c3c46] hover:text-[#d4d4d8]"
            >
              加载更早（还有 {hidden} 条）
            </button>
          </div>
        )}
        {blocks.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            idle={idle}
            onOpenTool={onOpenTool}
            selectedCallId={selectedCallId}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function BlockRow({
  block,
  idle,
  onOpenTool,
  selectedCallId,
}: {
  block: Block;
  idle: boolean;
  onOpenTool: (callId: string) => void;
  selectedCallId: string | null;
}): JSX.Element | null {
  switch (block.kind) {
    case 'user':
      return (
        <div className="flex gap-3 pt-3">
          <span className="select-none text-[#1abc9c]">❯</span>
          <span className="whitespace-pre-wrap text-[#e6e6ea]">{block.text}</span>
        </div>
      );
    case 'text':
      return (
        <div className="flex gap-3">
          <span className="select-none text-[#5c5c66]">•</span>
          <div className="min-w-0 flex-1 text-[#d4d4d8]">{renderMarkdown(block.text)}</div>
        </div>
      );
    case 'reasoning':
      return (
        <details className="ml-7 text-[13px] text-[#6c6c76]">
          <summary className="cursor-pointer select-none">{block.streaming ? '思考中…' : '已思考'}</summary>
          <div className="whitespace-pre-wrap py-1">{block.text}</div>
        </details>
      );
    case 'tool':
      return (
        <ToolCard
          name={block.name}
          args={block.args}
          view={block.view}
          result={block.result}
          tail={block.tail}
          idle={idle}
          selected={block.callId === selectedCallId}
          onOpen={() => onOpenTool(block.callId)}
        />
      );
    case 'meta':
      return (
        <div className="ml-7 text-[11px] text-[#5c5c66]">
          {formatClock(block.stats.startedAt)} · {runMetaText(block.stats)}
        </div>
      );
    case 'job':
      return <JobRow job={block.job} />;
    case 'hint':
      return (
        <div className={`ml-7 text-[13px] ${block.tone === 'warn' ? 'text-[#e0af68]' : 'text-[#6c6c76]'}`}>
          ⟳ {block.text}
        </div>
      );
  }
}

const JOB_MARK: Record<string, string> = { running: '⧗', completed: '✓', failed: '✗', killed: '⊘' };
const JOB_CLS: Record<string, string> = {
  running: 'text-[#1abc9c]',
  completed: 'text-[#9ece6a]',
  failed: 'text-[#f7768e]',
  killed: 'text-[#6c6c76]',
};

/** A background job: one row, rewritten in place until it settles. */
function JobRow({ job }: { job: JobSnapshot }): JSX.Element {
  const mark = JOB_MARK[job.status] ?? '⧗';
  return (
    <div className="ml-7 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px]">
      <span className={JOB_CLS[job.status] ?? 'text-[#8a8a94]'}>{mark}</span>
      <span className="text-[#8a8a94]">后台 {job.id}</span>
      <span className="min-w-0 flex-1 truncate text-[#6c6c76]">{job.label}</span>
      {job.detail !== undefined && <span className="text-[#6c6c76]">{job.detail}</span>}
      {job.progress !== undefined && <span className="w-full truncate text-[#5c5c66]">{job.progress}</span>}
    </div>
  );
}