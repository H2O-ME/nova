/**
 * Transcript projection of the reducer's blocks. Auto-anchors to the bottom
 * when the user is already near it (the terminal's tail-follow contract).
 */
import { useEffect, useRef } from 'react';
import { renderMarkdown } from './markdown.js';
import type { Block } from './state.js';

export function Transcript({ blocks }: { blocks: Block[] }): JSX.Element {
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
        {blocks.map((block) => <BlockRow key={block.id} block={block} />)}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function BlockRow({ block }: { block: Block }): JSX.Element | null {
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
          <summary className="cursor-pointer select-none">
            {block.streaming ? '思考中…' : '已思考'} {block.text.length > 0 ? '' : ''}
          </summary>
          <div className="whitespace-pre-wrap py-1">{block.text}</div>
        </details>
      );
    case 'tool': {
      const icon = block.state === 'running' ? '⠙' : block.state === 'ok' ? '✓' : '✗';
      const iconCls = block.state === 'fail' ? 'text-[#f7768e]' : block.state === 'ok' ? 'text-[#9ece6a]' : 'text-[#1abc9c]';
      return (
        <div className="ml-0">
          <div className="flex gap-3">
            <span className={`select-none ${iconCls}`}>{icon}</span>
            <div className="min-w-0 flex-1">
              <span className="font-medium text-[#e6e6ea]">{block.name}</span>
              <span className="ml-2 truncate font-mono text-[12px] text-[#6c6c76]">{oneLine(block.args)}</span>
            </div>
          </div>
          {block.tail !== undefined && block.state === 'running' && (
            <div className="ml-7 truncate border-l-2 border-[#1abc9c]/60 pl-2 font-mono text-[12px] text-[#6c6c76]">{block.tail}</div>
          )}
          {block.detail !== undefined && (
            <div className="ml-7 truncate border-l-2 border-[#f7768e] pl-2 font-mono text-[12px] text-[#f7768e]">{block.detail}</div>
          )}
        </div>
      );
    }
    case 'hint':
      return (
        <div className={`ml-7 text-[13px] ${block.tone === 'warn' ? 'text-[#e0af68]' : 'text-[#6c6c76]'}`}>
          ⟳ {block.text}
        </div>
      );
  }
}

function oneLine(args: string): string {
  const flat = args.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}
