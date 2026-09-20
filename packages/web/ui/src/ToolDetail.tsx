/**
 * The tool detail panel (M11 批6): one call, in full.
 *
 * The transcript row is a summary — a verb, a target, a verdict. Everything a
 * summary has to leave out lives here: the exact arguments, the complete
 * result text, the tool's own metadata. The panel is deliberately dumb: it
 * receives the block the reducer already holds and shows its fields, so a tool
 * the bundle has never heard of is just as inspectable as bash.
 */
import { toolCardModel } from './card-view.js';
import { formatClock } from './format.js';
import type { Block } from './state.js';

export function ToolDetail({ block, onClose }: { block: Extract<Block, { kind: 'tool' }>; onClose: () => void }): JSX.Element {
  const model = toolCardModel({
    name: block.name,
    args: block.args,
    view: block.view,
    result: block.result,
    idle: true,
  });
  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-[#26262e] bg-[#111117]">
      <header className="flex items-center gap-2 border-b border-[#26262e] px-4 py-2">
        <span className="text-[12px] font-medium text-[#e6e6ea]">{block.name}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#6c6c76]">{model.headline}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-[13px] text-[#6c6c76] hover:bg-[#1c1c24] hover:text-[#d4d4d8]"
          aria-label="关闭详情"
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {block.ts !== undefined && <Section title="时间">{formatClock(block.ts)}</Section>}
        <Section title="参数" mono>
          {block.args.length > 0 ? block.args : '(无参数)'}
        </Section>
        {block.tail !== undefined && (
          <Section title="实时输出" mono>
            {block.tail}
          </Section>
        )}
        <div>
          <div className="mb-1 text-[11px] text-[#6c6c76]">结果</div>
          {block.result === undefined ? (
            <div className="text-[12px] text-[#6c6c76]">（尚未返回）</div>
          ) : (
            <>
              {model.foot !== undefined && <div className="mb-1 text-[11px] text-[#8a8a94]">{model.foot}</div>}
              <pre className="whitespace-pre-wrap break-all rounded-md bg-[#0d0d12] p-2 font-mono text-[12px] leading-5 text-[#a0a0aa]">
                {block.output !== undefined && block.output.length > 0 ? block.output : '(无输出)'}
              </pre>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({ title, children, mono }: { title: string; children: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] text-[#6c6c76]">{title}</div>
      <div className={mono === true ? 'whitespace-pre-wrap break-all font-mono text-[12px] text-[#a0a0aa]' : 'text-[12px] text-[#a0a0aa]'}>
        {children}
      </div>
    </div>
  );
}
