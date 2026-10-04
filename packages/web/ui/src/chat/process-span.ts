/**
 * The flow blocks → summary span projection: `process-summary.ts` reads a
 * host-agnostic shape, the flow owns the reducer's union, so the small mapping
 * between them lives here. A tool block is in flight while its result has not
 * landed — the reducer has no `running` flag on tool blocks.
 *
 * The host-resolved `view` rides along because it carries the call's own
 * `kind`; that is what the summary categorises by, so the summary never has to
 * know a tool's name.
 */
import type { Block } from '../state.js';
import type { ProcessSpanBlock } from './process-summary.js';

export function processSpanOf(blocks: readonly Block[]): ProcessSpanBlock[] {
  return blocks.map((block) => {
    if (block.kind === 'tool') {
      return {
        kind: 'tool',
        name: block.name,
        args: block.args,
        view: block.view,
        running: block.result === undefined,
      };
    }
    if (block.kind === 'reasoning') return { kind: 'reasoning', text: block.text };
    return { kind: block.kind };
  });
}
