/**
 * Markdown-lite → REACT ELEMENTS. The sanitizer is the architecture: raw
 * text becomes createElement trees with string children, so there is no
 * HTML-string path, no dangerouslySetInnerHTML, and provider output can
 * never execute. Subset only (headings, fenced code, inline code, bold,
 * lists) — anything exotic renders as plain text, which is the safe default.
 */
import type { ReactNode } from 'react';

export function renderMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  let fence: string[] | undefined;
  let list: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('```')) {
      if (fence === undefined) fence = [];
      else {
        out.push(
          <pre key={i} className="my-2 overflow-x-auto rounded-md bg-[#0d0d12] p-3 text-[13px] leading-5 text-[#9ece6a]">
            <code>{fence.join('\n')}</code>
          </pre>,
        );
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      fence.push(line);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      list.push(bullet[1] ?? '');
      continue;
    }
    flushList();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '#').length;
      const cls = level === 1 ? 'text-lg font-semibold' : level === 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      out.push(<div key={i} className={`mt-3 mb-1 ${cls}`}>{inline(heading[2] ?? '')}</div>);
      continue;
    }
    if (line.trim().length === 0) continue;
    out.push(<p key={i} className="my-1 leading-6">{inline(line)}</p>);
  }
  if (fence !== undefined) {
    out.push(<pre key="open-fence" className="my-2 overflow-x-auto rounded-md bg-[#0d0d12] p-3 text-[13px] leading-5"><code>{fence.join('\n')}</code></pre>);
  }
  flushList();
  return out;

  function flushList(): void {
    if (list.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-1 ml-5 list-disc space-y-0.5 leading-6">
        {list.map((item, k) => <li key={k}>{inline(item)}</li>)}
      </ul>,
    );
    list = [];
  }
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<code key={k++} className="rounded bg-[#23232c] px-1 py-0.5 font-mono text-[13px] text-[#1abc9c]">{m[1]}</code>);
    else if (m[2] !== undefined) parts.push(<strong key={k++} className="font-semibold text-[#e6e6ea]">{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
