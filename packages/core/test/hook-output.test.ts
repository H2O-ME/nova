import { describe, expect, it } from 'vitest';
import { exitCodeBlockOutput, mergeHookRunResult, processHookOutput } from '@nova-agent/core';

/**
 * The ZCode hook-output contract: how one hook's stdout becomes an opinion, and
 * how several hooks' opinions combine. These semantics are what make a pack
 * written for ZCode behave the same here, so they are protected directly.
 */
describe('processHookOutput', () => {
  it('treats continue:false as a block on prompt/tool events but not on Stop', () => {
    const blocked = processHookOutput('PreToolUse', { continue: false, reason: 'no' });
    expect(blocked.blockRequested).toBe(true);
    expect(blocked.preventContinuation).toBe(true);
    expect(blocked.permissionBehavior).toBe('deny');
    expect(blocked.stopReason).toBe('no');

    // Stop is already ending: continue:false means nothing there.
    expect(processHookOutput('Stop', { continue: false }).blockRequested).toBeUndefined();
  });

  it('reads Stop continue:true as "run another turn"', () => {
    const out = processHookOutput('Stop', { continue: true, reason: 'still working' });
    expect(out.stopShouldContinue).toBe(true);
    expect(out.stopReason).toBe('still working');
  });

  it('maps decision:approve/block onto the permission behavior for tool events', () => {
    expect(processHookOutput('PreToolUse', { decision: 'approve' }).permissionBehavior).toBe('allow');
    expect(processHookOutput('PermissionRequest', { decision: 'block', reason: 'x' }).permissionBehavior).toBe('deny');
  });

  it('reads the three-valued permissionDecision and the input rewrite', () => {
    const out = processHookOutput('PreToolUse', {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'look closely',
        updatedInput: { command: 'ls' },
      },
    });
    expect(out.permissionBehavior).toBe('ask');
    expect(out.hookPermissionDecisionReason).toBe('look closely');
    expect(out.updatedInput).toEqual({ command: 'ls' });
  });

  it('reads PermissionRequest decision as an OBJECT', () => {
    const out = processHookOutput('PermissionRequest', {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', message: 'pre-approved', updatedInput: { path: 'a' } },
      },
    });
    expect(out.permissionRequestResult?.behavior).toBe('allow');
    expect(out.permissionRequestResult?.message).toBe('pre-approved');
    expect(out.permissionRequestResult?.updatedInput).toEqual({ path: 'a' });
  });

  it('fails a hook whose hookSpecificOutput names another event', () => {
    expect(() =>
      processHookOutput('PreToolUse', {
        hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'x' },
      }),
    ).toThrow(/Stop/);
  });
});

describe('mergeHookRunResult', () => {
  it('lets deny beat ask beat allow across hooks', () => {
    const acc = processHookOutput('PreToolUse', {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
    mergeHookRunResult(
      acc,
      processHookOutput('PreToolUse', { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }),
    );
    expect(acc.permissionBehavior).toBe('ask');
    mergeHookRunResult(
      acc,
      processHookOutput('PreToolUse', { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } }),
    );
    expect(acc.permissionBehavior).toBe('deny');
  });

  it('accumulates every hook additionalContext in order', () => {
    const acc = processHookOutput('PostToolUse', { additionalContext: 'first' });
    mergeHookRunResult(acc, processHookOutput('PostToolUse', { additionalContext: 'second' }));
    expect(acc.additionalContexts).toEqual(['first', 'second']);
  });
});

describe('exitCodeBlockOutput', () => {
  it('speaks each event own vocabulary', () => {
    const tool = exitCodeBlockOutput('PreToolUse', 'unsafe');
    expect(tool.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'unsafe' });

    const permission = exitCodeBlockOutput('PermissionRequest', 'no');
    expect(permission.hookSpecificOutput).toMatchObject({ decision: { behavior: 'deny', message: 'no' } });

    expect(exitCodeBlockOutput('Stop', 'wait')).toEqual({ decision: 'block', reason: 'wait' });

    expect(exitCodeBlockOutput('UserPromptSubmit', 'nope')).toEqual({ continue: false, reason: 'nope' });
  });
});
