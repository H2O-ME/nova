import { describe, expect, it } from 'vitest';
import {
  hookMatches,
  parseHookOutput,
  serializeHookPayload,
  validateHookEvents,
  validateHooksConfig,
} from '@nova-agent/core';

/**
 * The configured-hook CONTRACT: matcher grammar, stdout parsing, the stdin
 * payload's dual spelling, and the two validators. These are the shapes a pack
 * written for ZCode depends on, so they are contracts, not implementation
 * details.
 */
describe('hook matcher', () => {
  it('treats absent, empty and `*` as match-all', () => {
    for (const matcher of [undefined, '', '*', '  ']) {
      expect(hookMatches(matcher, 'Bash')).toBe(true);
    }
  });

  it('reads a plain name list as exact names, not a regex', () => {
    expect(hookMatches('Edit|Write|MultiEdit', 'Write')).toBe(true);
    expect(hookMatches('Edit|Write|MultiEdit', 'Bash')).toBe(false);
    // A regex engine would match "Writ" and "Editx"; the fast path must not.
    expect(hookMatches('Edit|Write', 'Writ')).toBe(false);
    expect(hookMatches('Edit', 'Editx')).toBe(false);
  });

  it('falls back to regex for non-plain patterns and disables an invalid one', () => {
    expect(hookMatches('^Bash.*$', 'BashTool')).toBe(true);
    expect(hookMatches('^(Read|Glob)$', 'Glob')).toBe(true);
    // An invalid regex disables the group instead of throwing: one broken
    // matcher must not take the whole event down.
    expect(hookMatches('([', 'Bash')).toBe(false);
  });
});

describe('hook stdout parsing', () => {
  it('reads a block decision with its reason', () => {
    const parsed = parseHookOutput(JSON.stringify({ decision: 'block', reason: 'unsafe SQL' }));
    expect(parsed).toEqual({ decision: 'block', reason: 'unsafe SQL' });
  });

  it('reads the hookSpecificOutput input rewrite', () => {
    const parsed = parseHookOutput(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', updatedInput: { path: 'x' } },
      }),
    );
    expect(parsed?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(parsed?.hookSpecificOutput?.updatedInput).toEqual({ path: 'x' });
  });

  it('treats empty, non-JSON and non-object output as nothing actionable', () => {
    expect(parseHookOutput('')).toBeUndefined();
    expect(parseHookOutput('   ')).toBeUndefined();
    expect(parseHookOutput('not json')).toBeUndefined();
    expect(parseHookOutput('[1,2]')).toBeUndefined();
    expect(parseHookOutput('{"unrelated":1}')).toBeUndefined();
  });
});

describe('hook stdin payload', () => {
  it('carries both snake_case and camelCase spellings of every field', () => {
    const raw = serializeHookPayload({
      cwd: '/w',
      hookEventName: 'PreToolUse',
      sessionId: 's1',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['hookEventName']).toBe('PreToolUse');
    expect(parsed['hook_event_name']).toBe('PreToolUse');
    expect(parsed['sessionId']).toBe('s1');
    expect(parsed['session_id']).toBe('s1');
    expect(parsed['toolName']).toBe('Bash');
    expect(parsed['tool_name']).toBe('Bash');
    expect(parsed['toolInput']).toEqual({ command: 'ls' });
    expect(parsed['cwd']).toBe('/w');
  });
});

describe('hook config validation', () => {
  it('accepts a ZCode-shaped events table', () => {
    const checked = validateHookEvents({
      PreToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'process', command: 'node', args: ['x.js'], timeoutMs: 1000 }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'sh ./s.sh', timeout: 5 }] }],
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.PreToolUse?.[0]?.matcher).toBe('Edit|Write');
      expect(checked.value.Stop?.[0]?.hooks[0]?.type).toBe('command');
    }
  });

  it('refuses a hook with no command and names the path', () => {
    const checked = validateHookEvents({ Stop: [{ hooks: [{ type: 'process', command: '' }] }] });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error).toContain('hooks.Stop[0].hooks[0].command');
  });

  it('keeps hooks off unless enabled is explicitly true', () => {
    expect(validateHooksConfig({ events: { Stop: [] } })).toEqual({ ok: true, value: {} });
    expect(validateHooksConfig({ enabled: false }).ok && validateHooksConfig({ enabled: false })).toEqual({
      ok: true,
      value: {},
    });
    const on = validateHooksConfig({ enabled: true, timeoutMs: 100 });
    expect(on.ok && on.value).toEqual({ enabled: true, timeoutMs: 100 });
  });

  it('refuses an unknown top-level key (a typo the operator should see)', () => {
    const checked = validateHooksConfig({ enabled: true, timeouts: 5 });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error).toContain('timeouts');
  });
});
