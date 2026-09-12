import { describe, expect, it } from 'vitest';
import type { AgentHooks, AgentMessage, ChatRequest, ToolDefinition, Usage } from '@nova-agent/core';
import { shouldCompactBefore, wrapAutoCompact, type PreflightInput, type WrapAutoCompactOptions } from '../src/auto-compact.js';

/** Build a minimal ChatRequest image used only for full-image pricing. */
function requestImage(text: string, tools: ToolDefinition[] = []): ChatRequest {
  const msg: AgentMessage = { id: 'm1', ts: 0, role: 'user', content: text };
  return { messages: [msg], systemPrompt: 'system', tools };
}

const ANCHOR: Usage = { promptTokens: 1000, completionTokens: 0, cachedTokens: 0 };

/** Build a PreflightInput with sensible defaults so tests override only what matters. */
function preflight(over: Partial<PreflightInput>): PreflightInput {
  return {
    limit: 10_000,
    usageAnchor: ANCHOR,
    anchorMsgCount: 0,
    messages: [{ id: 'm2', ts: 0, role: 'user', content: 'since anchor' }],
    request: requestImage('body'),
    ...over,
  };
}

describe('shouldCompactBefore', () => {
  it('uses the anchor + delta when an anchor is present', () => {
    // Anchor 1000 + delta from one short user message ≪ 10000 → no compact.
    expect(shouldCompactBefore(preflight({}))).toBe(false);
  });

  it('triggers when the anchor + delta exceeds the limit', () => {
    const big: AgentMessage = { id: 'big', ts: 0, role: 'user', content: 'x'.repeat(80_000) };
    expect(shouldCompactBefore(preflight({ messages: [big] }))).toBe(true);
  });

  it('falls back to full-image pricing when there is no anchor (resume of a big session)', () => {
    // No anchor + a large body over the limit → full-image path must catch it.
    const req = requestImage('y'.repeat(80_000));
    expect(
      shouldCompactBefore(
        preflight({ usageAnchor: undefined, anchorMsgCount: 0, messages: [], request: req }),
      ),
    ).toBe(true);
  });

  it('does not compact on resume when the full image fits', () => {
    const req = requestImage('small');
    expect(
      shouldCompactBefore(
        preflight({ usageAnchor: undefined, anchorMsgCount: 0, messages: [], request: req }),
      ),
    ).toBe(false);
  });
});

describe('wrapAutoCompact', () => {
  function harness(opts: Partial<WrapAutoCompactOptions> & { limit: number }): {
    hooks: AgentHooks;
    compacted: { count: number };
    warns: string[];
    errors: unknown[];
  } {
    const compacted = { count: 0 };
    const warns: string[] = [];
    const errors: unknown[] = [];
    const baseHooks: AgentHooks = {};
    wrapAutoCompact(baseHooks, {
      enabled: true,
      limit: opts.limit,
      compact: async () => {
        compacted.count += 1;
      },
      onError: (err) => errors.push(err),
      onWarn: (text) => warns.push(text),
      ...opts,
    });
    return { hooks: baseHooks, compacted, warns, errors };
  }

  it('compacts in place when the full image exceeds the limit', async () => {
    const req: ChatRequest = { messages: [{ id: 'm', ts: 0, role: 'user', content: 'z'.repeat(80_000) }] };
    const { hooks, compacted } = harness({ limit: 1000 });
    await hooks.beforeLLMCall?.(req);
    expect(compacted.count).toBe(1);
  });

  it('does nothing when the image fits', async () => {
    const req: ChatRequest = { messages: [{ id: 'm', ts: 0, role: 'user', content: 'ok' }] };
    const { hooks, compacted } = harness({ limit: 10_000 });
    await hooks.beforeLLMCall?.(req);
    expect(compacted.count).toBe(0);
  });

  it('fuses after a compaction that still leaves the image over the limit', async () => {
    // Image over the limit and stays over (compact is a no-op here).
    const req: ChatRequest = { messages: [{ id: 'm', ts: 0, role: 'user', content: 'z'.repeat(80_000) }] };
    const { hooks, compacted, warns } = harness({ limit: 1000 });
    await hooks.beforeLLMCall?.(req);
    await hooks.beforeLLMCall?.(req);
    expect(compacted.count).toBe(1); // only the first request compacts; subsequent fuse out
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0]).toContain('停用');
  });

  it('disarms when a plugin hook replaces the messages array (alias contract)', async () => {
    const req: ChatRequest = { messages: [{ id: 'm', ts: 0, role: 'user', content: 'z'.repeat(80_000) }] };
    const compacted = { count: 0 };
    const warns: string[] = [];
    // Install a hook BEFORE wrapAutoCompact that clones the messages array.
    // wrapAutoCompact captures it as `inner`; the alias check `next.messages
    // !== req.messages` then detects the replacement.
    const baseHooks: AgentHooks = {
      beforeLLMCall: async (r) => ({ ...r, messages: [...r.messages] }),
    };
    wrapAutoCompact(baseHooks, {
      enabled: true,
      limit: 1000,
      compact: async () => {
        compacted.count += 1;
      },
      onError: () => {},
      onWarn: (text) => warns.push(text),
    });
    await baseHooks.beforeLLMCall?.(req);
    expect(compacted.count).toBe(0);
    expect(warns.some((w) => w.includes('停用'))).toBe(true);
  });

  it('is inert when disabled', async () => {
    const hooks: AgentHooks = {};
    wrapAutoCompact(hooks, {
      enabled: false,
      limit: 1,
      compact: async () => {},
      onError: () => {},
      onWarn: () => {},
    });
    // When disabled, wrapAutoCompact installs NO beforeLLMCall of its own.
    expect(hooks.beforeLLMCall).toBeUndefined();
  });

  it('records the error but lets the request through when compact throws', async () => {
    const req: ChatRequest = { messages: [{ id: 'm', ts: 0, role: 'user', content: 'z'.repeat(80_000) }] };
    const errors: unknown[] = [];
    const hooks: AgentHooks = {};
    wrapAutoCompact(hooks, {
      enabled: true,
      limit: 1000,
      compact: async () => {
        throw new Error('summary provider down');
      },
      onError: (err) => errors.push(err),
      onWarn: () => {},
    });
    const out = await hooks.beforeLLMCall?.(req);
    expect(out).toBe(req);
    expect(errors).toHaveLength(1);
  });
});
