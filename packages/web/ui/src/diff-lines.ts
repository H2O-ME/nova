/**
 * Line diff for the FileDiff presentation card — the transcript used to render
 * "all old lines, then all new lines", which is not a diff. This is a plain
 * LCS over line arrays with a size guard (huge pairs collapse to a
 * delete-then-add block), plus common prefix/suffix trimming and context
 * collapsing so a 2-line change in a 200-line file stays two screens short.
 */
export type DiffOp = { t: 'ctx' | 'del' | 'add'; text: string };
export type DiffRow = DiffOp | { t: 'skip'; n: number };

const LCS_CELL_BUDGET = 250_000;

export function diffLines(oldText: string | null, newText: string): DiffOp[] {
  if (oldText === null) return newText === '' ? [] : split(newText).map((text) => ({ t: 'add' as const, text }));
  const a = split(oldText);
  const b = split(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const ops: DiffOp[] = a.slice(0, head).map((text) => ({ t: 'ctx' as const, text }));
  ops.push(...lcs(midA, midB));
  for (const line of b.slice(b.length - tail)) ops.push({ t: 'ctx' as const, text: line });
  return ops;
}

function split(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

function lcs(a: string[], b: string[]): DiffOp[] {
  if (a.length === 0) return b.map((text) => ({ t: 'add' as const, text }));
  if (b.length === 0) return a.map((text) => ({ t: 'del' as const, text }));
  if (a.length * b.length > LCS_CELL_BUDGET) {
    // too big to align lines exactly — show a wholesale replacement
    return [
      ...a.map((text) => ({ t: 'del' as const, text })),
      ...b.map((text) => ({ t: 'add' as const, text })),
    ];
  }
  const w = b.length + 1;
  const dp = new Int32Array((a.length + 1) * w);
  const g = (r: number, c: number): number => dp[r * w + c] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i * w + j] = a[i] === b[j] ? g(i + 1, j + 1) + 1 : Math.max(g(i + 1, j), g(i, j + 1));
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ t: 'ctx', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if (g(i + 1, j) >= g(i, j + 1)) {
      out.push({ t: 'del', text: a[i] ?? '' });
      i += 1;
    } else {
      out.push({ t: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < a.length) out.push({ t: 'del', text: a[i++] ?? '' });
  while (j < b.length) out.push({ t: 'add', text: b[j++] ?? '' });
  return out;
}

/** Collapse context runs longer than `minRun` to `keep` lines each side. */
export function collapseContext(ops: DiffOp[], keep = 3, minRun = 7): DiffRow[] {
  const rows: DiffRow[] = [];
  let run: DiffOp[] = [];
  const flush = (): void => {
    if (run.length < minRun) {
      rows.push(...run);
    } else {
      rows.push(...run.slice(0, keep));
      rows.push({ t: 'skip', n: run.length - keep * 2 });
      rows.push(...run.slice(run.length - keep));
    }
    run = [];
  };
  for (const op of ops) {
    if (op.t === 'ctx') run.push(op);
    else {
      flush();
      rows.push(op);
    }
  }
  flush();
  return rows;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.t === 'add') added += 1;
    else if (op.t === 'del') removed += 1;
  }
  return { added, removed };
}
