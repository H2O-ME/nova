/**
 * Transcript projection of the reducer's blocks. Auto-anchors to the bottom
 * when the user is already near it (the terminal's tail-follow contract), and
 * renders each block by kind — tool rows delegate to ToolCard, so the card
 * shapes live in exactly one place.
 */
import { useEffect, useRef } from 'react';
import { renderMarkdown } from './markdown.js';
import { ToolCard } from './ToolCard.js';
import type { Block } from './state.js';

export function Transcript({ blocks, idle }: { blocks: Block[]; idle: boolean }): JSX.Element {
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
        {blocks.map((block) => <BlockRow key={block.id} block={block} idle={idle} />)}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function BlockRow({ block, idle }: { block: Block; idle: boolean }): JSX.Element | null {
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
        />
      );
    case 'hint':
      return (
        <div className={`ml-7 text-[13px] ${block.tone === 'warn' ? 'text-[#e0af68]' : 'text-[#6c6c76]'}`}>
          ⟳ {block.text}
        </div>
      );
  }
}