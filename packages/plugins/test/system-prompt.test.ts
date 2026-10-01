/**
 * The system prompt's tool rules (`system-prompt.ts`).
 *
 * Asserted because the prompt IS the interface the model reads: a rule the
 * prompt states is one the model can follow, and one it omits is a rule the
 * model has to guess (observed: `@repo/docs/x.md` was read as `docs/x.md`).
 * Contract-level assertions only — wording may change, the rule may not.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt.js';

describe('system prompt', () => {
  it('states that an @ mention is a workspace-relative path used verbatim', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('@path');
    expect(prompt).toContain('WORKSPACE-RELATIVE');
    expect(prompt).toMatch(/never add or drop a leading segment/u);
  });

  it('points the file-read rule at read_file rather than shell commands', () => {
    expect(buildSystemPrompt()).toMatch(/Use read_file — not shell commands/u);
  });
});
