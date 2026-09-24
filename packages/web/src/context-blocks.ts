/**
 * The seeded session-start fragment as wire blocks: ONE BLOCK PER SECTION, each
 * naming what a producer contributed (the environment, the operator's
 * directives, the AGENTS.md chain, the skills index). That is the shape the
 * reference draws, and the only shape that names a producer per row — a single
 * context row would hide which of them said what.
 *
 * Split from `transcript.ts` (the conversation walk): this projection changes
 * when the fragment's layout changes, which is `core/context-fragment.ts`'s
 * business, not the transcript's.
 */
import { contextSectionForm, contextSections, type AgentMessage } from '@nova-agent/core';
import type { WireBlock } from './protocol.js';

/** One context block per section of a seeded fragment. */
export function contextBlocks(msg: AgentMessage): WireBlock[] {
  return contextSections(msg).map((section) => ({
    kind: 'context',
    tag: section.tag,
    ...contextSectionForm(section),
    text: section.text,
  }));
}
