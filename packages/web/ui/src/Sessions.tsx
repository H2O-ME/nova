/**
 * Session switcher (M11 批3): the host's `sessions` frame is the only source,
 * `resume`/`new_session` are the only verbs. Resuming re-baselines the whole
 * transcript (the host answers with a fresh `ready`), so the panel does not
 * need to know anything about logs — and a session belonging to another
 * workspace is shown with that workspace, since the host re-points tools there.
 */
import type { ClientFrame, SessionListItem } from './types.js';

export function Sessions({
  items,
  currentFile,
  send,
  onClose,
}: {
  items: readonly SessionListItem[];
  currentFile: string;
  send: (f: ClientFrame) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="border-b border-[#2c2c36] bg-[#1a1a22] px-6 py-3">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        <div className="flex items-center gap-2 text-[12px] text-[#6c6c76]">
          <span className="text-[#e6e6ea]">会话</span>
          <span>最近 {items.length} 条 · 恢复会把工作区切回该会话创建时的目录</span>
          <button
            onClick={() => {
              send({ type: 'new_session' });
              onClose();
            }}
            className="ml-auto rounded border border-[#505058] px-2 py-0.5 hover:border-[#1abc9c] hover:text-[#1abc9c]"
          >
            新建会话
          </button>
          <button onClick={onClose} className="rounded border border-[#505058] px-2 py-0.5 hover:border-[#d4d4d8]">
            关闭
          </button>
        </div>
        <div className="max-h-64 divide-y divide-[#2c2c36] overflow-y-auto rounded-md border border-[#2c2c36]">
          {items.length === 0 && <div className="px-3 py-2 text-[12px] text-[#6c6c76]">没有历史会话</div>}
          {items.map((item) => {
            const current = item.file === currentFile;
            return (
              <button
                key={item.file}
                disabled={current}
                onClick={() => {
                  send({ type: 'resume', file: item.file });
                  onClose();
                }}
                className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-[12px] ${current ? 'bg-[#1abc9c]/10' : 'hover:bg-[#1c1c24]'}`}
              >
                <span className="select-none text-[#5c5c66]">{current ? '▸' : '·'}</span>
                <span className="min-w-0 flex-1 truncate text-[#d4d4d8]">{item.title}</span>
                <span className="shrink-0 text-[#5c5c66]">{stamp(item.mtime)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}