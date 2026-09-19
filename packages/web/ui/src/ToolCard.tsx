/**
 * The tool card — the presentation vocabulary's first real consumer (M11 批3).
 *
 * All the reasoning (which card, which headline, did it fail, what footnote)
 * lives in `card-view.ts` as a pure function; this file is the dumb projection
 * of that model onto JSX. **No tool name is ever compared here**, and a card
 * this bundle has never heard of still renders, because the model is built from
 * the card's own fields. Copy and color live here, in the surface, which is the
 * other half of the presentation contract.
 */
import { toolCardModel } from './card-view.js';
import type { CardBody, CardModel } from './card-view.js';
import type { FileDiff, ToolCallView, ToolResultView } from './types.js';

const MARK: Record<CardModel['state'], string> = { running: '⠙', stale: '·', ok: '✓', fail: '✗' };
const MARK_CLS: Record<CardModel['state'], string> = {
  running: 'text-[#1abc9c]',
  stale: 'text-[#5c5c66]',
  ok: 'text-[#9ece6a]',
  fail: 'text-[#f7768e]',
};
const FOOT_CLS: Record<'ok' | 'fail' | 'muted', string> = {
  ok: 'text-[#9ece6a]',
  fail: 'text-[#f7768e]',
  muted: 'text-[#6c6c76]',
};

export function ToolCard({
  name,
  args,
  view,
  result,
  tail,
  idle,
}: {
  name: string;
  args: string;
  view: ToolCallView;
  result: ToolResultView | undefined;
  tail: string | undefined;
  /** Nothing is running: an unfinished call is stale, not in-flight. */
  idle: boolean;
}): JSX.Element {
  const model = toolCardModel({ name, args, view, result, idle });
  return (
    <div className="ml-0 space-y-1">
      <div className="flex items-baseline gap-3">
        <span className={`select-none ${MARK_CLS[model.state]}`}>{MARK[model.state]}</span>
        <div className="min-w-0 flex-1 text-[13px]">
          {model.mono ? (
            <code className="font-mono text-[#e6e6ea]">{model.headline}</code>
          ) : (
            <span className="break-all text-[#e6e6ea]">{model.headline}</span>
          )}
          {model.subtitle !== undefined && <span className="ml-2 text-[#6c6c76]">{model.subtitle}</span>}
        </div>
      </div>
      {tail !== undefined && model.state === 'running' && (
        <div className="ml-7 truncate border-l-2 border-[#1abc9c]/60 pl-2 font-mono text-[12px] text-[#6c6c76]">{tail}</div>
      )}
      <div className="ml-7">
        <Body body={model.body} />
      </div>
      {model.foot !== undefined && (
        <div className={`ml-7 text-[11px] ${FOOT_CLS[model.footTone ?? 'muted']}`}>{model.foot}</div>
      )}
    </div>
  );
}

function Body({ body }: { body: CardBody }): JSX.Element | null {
  switch (body.kind) {
    case 'none':
      return null;
    case 'args':
      return <div className="truncate font-mono text-[12px] text-[#5c5c66]">{body.text}</div>;
    case 'text':
      return <div className="text-[12px] text-[#a0a0aa]">{body.text}</div>;
    case 'output':
      return (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#0d0d12] p-2 font-mono text-[12px] leading-5 text-[#a0a0aa]">
          {body.text.length > 0 ? body.text : '(无输出)'}
        </pre>
      );
    case 'diff':
      return (
        <div className="space-y-1">
          {body.diffs.map((diff) => (
            <DiffBody key={diff.path} diff={diff} />
          ))}
        </div>
      );
    case 'matches':
      return (
        <div className="max-h-56 space-y-0.5 overflow-auto font-mono text-[12px] text-[#a0a0aa]">
          {body.matches.map((m, i) => (
            <div key={`${m.path}:${m.line ?? 0}:${i}`} className="truncate">
              <span className="text-[#e6e6ea]">{m.path}</span>
              {m.line !== undefined && <span className="text-[#6c6c76]">:{m.line}</span>}
            </div>
          ))}
        </div>
      );
    case 'read':
      return (
        <div className="truncate font-mono text-[12px] text-[#6c6c76]">
          {body.path} · {body.lineCount} 行{body.truncated ? ' · 仅片段' : ''}
        </div>
      );
    case 'plan':
      return (
        <div className="space-y-0.5 text-[12px]">
          {body.items.map((item, i) => (
            <div key={i} className={item.status === 'completed' ? 'text-[#6c6c76] line-through' : 'text-[#d4d4d8]'}>
              <span className={item.status === 'in_progress' ? 'text-[#1abc9c]' : 'text-[#5c5c66]'}>
                {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▸' : '·'}
              </span>{' '}
              {item.text}
            </div>
          ))}
        </div>
      );
  }
}

function DiffBody({ diff }: { diff: FileDiff }): JSX.Element {
  const oldLines = diff.oldText === null ? [] : diff.oldText.split('\n');
  const newLines = diff.newText.split('\n');
  return (
    <div className="overflow-hidden rounded-md border border-[#2c2c36]">
      <div className="bg-[#1a1a22] px-2 py-1 font-mono text-[11px] text-[#6c6c76]">
        {diff.path}
        {diff.oldText === null && <span className="ml-2 text-[#9ece6a]">新建</span>}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all bg-[#0d0d12] p-2 font-mono text-[12px] leading-5">
        {oldLines.map((line, i) => (
          <div key={`o${i}`} className="bg-[#f7768e]/10 text-[#f7768e]">- {line}</div>
        ))}
        {newLines.map((line, i) => (
          <div key={`n${i}`} className="bg-[#9ece6a]/10 text-[#9ece6a]">+ {line}</div>
        ))}
      </pre>
    </div>
  );
}