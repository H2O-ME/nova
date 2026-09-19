/**
 * Blocks → scroll entries (M11 批4). This is the seam where the transcript's
 * *shape* is decided, and it is pure: given the same blocks and width it gives
 * the same lines, so a rendering disagreement can be reproduced in a test.
 *
 * What happens here, in order:
 *  1. **Grouping.** A run of adjacent collapsed read-only tool rows collapses
 *     into one header entry (the members' rows are not emitted at all).
 *  2. **Density.** Tool rows and live hint rows are `dense`, which is what
 *     makes a burst of them glue together with no blank rows in between.
 *  3. **Padding.** A user prompt carries its own `vpad` — the two blank rows
 *     that make a question read as a question.
 *  4. **Wrapping.** Lines are wrapped to the content width (CJK-aware) and the
 *     mark column is prefixed from here, so the scrollback only ever deals
 *     with finished display lines.
 */
import { wrapLine } from '@nova-agent/tui';
import { CONTENT_COL, MARK_COL, USER_VPAD } from './layout.js';
import type { Block } from './blocks.js';
import { partitionRuns, verbKindOf, verbLabel, type RunStep } from './verb-group.js';
import { paint, type Palette } from './theme.js';
import type { ScrollEntry } from './scrollback.js';

/** Render one block into the lines *inside* its content column. */
export type BlockPainter = (block: Block, palette: Palette, opts: RenderOpts) => string[];

export interface RenderOpts {
  /** The shell's clock — animations are a function of it. */
  tick: number;
  /** Nothing is running: an unfinished call is a leftover, not in flight. */
  idle: boolean;
  /** Column the content starts at (defaults to the transcript's content column). */
  contentCol?: number;
}

export interface EntryInput {
  blocks: readonly Block[];
  cols: number;
  palette: Palette;
  paintBlock: BlockPainter;
  opts: RenderOpts;
}

export function buildEntries(input: EntryInput): ScrollEntry[] {
  const { blocks, cols, palette, paintBlock, opts } = input;
  const steps = blocks.map(runStepOf);
  const spans = partitionRuns(steps);
  const entries: ScrollEntry[] = [];
  for (const span of spans) {
    if (span.kind === 'single') {
      entries.push(blockEntry(blocks[span.index]!, cols, palette, paintBlock, opts));
      continue;
    }
    // The header replaces the collapsed members: one row, animated while any
    // is running, with failures counted into it. Members the user expanded are
    // still rendered on their own — an explicit open beats the fold.
    const { run } = span;
    const running = run.buckets.some((bucket) => bucket.running);
    const failed = run.buckets.some((bucket) => bucket.failed > 0);
    const marker = paint(palette, failed ? palette.accentError : running ? palette.accentTool : palette.gray, '◈');
    const label = paint(palette, palette.grayBright, verbLabel(run.buckets));
    const affordance = paint(palette, palette.gray, ' ▸');
    entries.push({
      id: `group:${run.members.join(',')}`,
      lines: [pad(marker, label + affordance)],
      dense: true,
    });
    for (const index of run.members) {
      const block = blocks[index]!;
      if (block.kind === 'tool' && block.expanded) entries.push(blockEntry(block, cols, palette, paintBlock, opts));
    }
  }
  return entries;
}

function blockEntry(
  block: Block,
  cols: number,
  palette: Palette,
  paintBlock: BlockPainter,
  opts: RenderOpts,
): ScrollEntry {
  const contentCol = opts.contentCol ?? CONTENT_COL;
  const width = Math.max(8, cols - 1 - contentCol);
  const body = paintBlock(block, palette, opts);
  // Painters emit logical lines; wrapping to the column budget happens here,
  // once, for every kind of line — the only place that knows the width.
  const lines = body.flatMap((line) => wrapLine(line, width)).map((line) => `${' '.repeat(contentCol)}${line}`);
  return {
    id: block.id,
    lines,
    dense: block.kind === 'tool' || (block.kind === 'hint' && block.tone === 'live'),
    ...(block.kind === 'user' ? { vpad: USER_VPAD } : {}),
  };
}

/** The marker column, then the content column's air. */
function pad(marker: string, content: string): string {
  const air = ' '.repeat(Math.max(1, CONTENT_COL - MARK_COL - 1));
  return `${' '.repeat(MARK_COL)}${marker}${air}${content}`;
}

/** What the run scanner sees for each block. */
function runStepOf(block: Block): RunStep {
  if (block.kind !== 'tool') return { verb: undefined, expanded: false, running: false, failed: false };
  const kind = block.view.card === 'generic' ? verbKindOf(block.view.kind) : block.view.card === 'search' ? 'search' : undefined;
  return {
    verb: kind,
    expanded: block.expanded,
    running: block.result === undefined,
    failed: block.failed,
  };
}