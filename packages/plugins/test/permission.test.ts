import { describe, expect, it, vi } from 'vitest';
import { PermissionService, type AskAnswer, type AskFn } from '../src/permission.js';
import type { PermissionKind } from '../src/types.js';
import type { ToolCall } from '@nova-agent/core';

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `call_${name}`,
  name,
  args,
  rawArgs: JSON.stringify(args),
});

const WRITE: PermissionKind = 'write';
const EXECUTE: PermissionKind = 'execute';
const NETWORK: PermissionKind = 'network';

/** Asker that records every dispatch and answers from a fixed script. */
function scriptedAsk(answers: AskAnswer[]): { ask: AskFn; asked: ToolCall[] } {
  const asked: ToolCall[] = [];
  let i = 0;
  const ask: AskFn = async (c) => {
    asked.push(c);
    return answers[i++] ?? 'deny';
  };
  return { ask, asked };
}

describe('PermissionService auto-allow matrix', () => {
  it.each([
    ['read-only', 'read', 'allow'],
    ['read-only', 'write', 'ask'],
    ['read-only', 'execute', 'ask'],
    ['read-only', 'network', 'ask'],
    ['read-only', 'read-external', 'ask'],
    ['auto-edit', 'read', 'allow'],
    ['auto-edit', 'write', 'allow'],
    ['auto-edit', 'execute', 'ask'],
    ['auto-edit', 'network', 'ask'],
    ['auto-edit', 'read-external', 'ask'],
    ['full', 'read', 'allow'],
    ['full', 'write', 'allow'],
    ['full', 'execute', 'allow'],
    ['full', 'network', 'allow'],
    ['full', 'read-external', 'allow'],
  ] as const)('%s + %s → asker dispatched: %s', async (mode, kind, gate) => {
    const { ask, asked } = scriptedAsk(['allow']);
    const svc = new PermissionService(mode, ask);
    if (gate === 'allow') {
      // Auto-allowed: the asker is never consulted.
      await expect(svc.decide('some_tool', kind, call('some_tool'))).resolves.toBe('allow');
      expect(asked).toHaveLength(0);
    } else {
      // 'ask' verdict: decide() consults the asker and adopts its answer.
      await expect(svc.decide('some_tool', kind, call('some_tool'))).resolves.toBe('allow');
      expect(asked).toHaveLength(1);
    }
  });

  it('auto-allowed calls never dispatch the asker nor write audit entries', async () => {
    const audit = vi.fn();
    const { ask, asked } = scriptedAsk(['allow']);
    const svc = new PermissionService('read-only', ask, audit);
    await svc.decide('read_file', 'read', call('read_file'));
    expect(asked).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('setMode switches the gate at runtime (/approvals semantics)', async () => {
    const { ask } = scriptedAsk(['allow']);
    const svc = new PermissionService('read-only', ask);
    await expect(svc.decide('write_file', WRITE, call('write_file'))).resolves.toBe('allow'); // asked, allowed
    svc.setMode('auto-edit');
    await expect(svc.decide('write_file', WRITE, call('write_file'))).resolves.toBe('allow'); // auto-allowed now
    expect(svc.approvalMode).toBe('auto-edit');
  });
});

describe('PermissionService fail-closed branches', () => {
  it("denies when the asker returns an invalid answer (not allow/deny/always)", async () => {
    const ask: AskFn = async () => 'maybe' as unknown as AskAnswer;
    const svc = new PermissionService('read-only', ask);
    await expect(svc.decide('bash', EXECUTE, call('bash'))).resolves.toBe('deny');
  });

  it('denies when the asker throws instead of opening the gate', async () => {
    const ask: AskFn = async () => {
      throw new Error('TUI died');
    };
    const svc = new PermissionService('read-only', ask);
    await expect(svc.decide('bash', EXECUTE, call('bash'))).resolves.toBe('deny');
  });

  it("'never' policy denies deterministically without dispatching any asker", async () => {
    const { ask, asked } = scriptedAsk(['allow']); // asker WOULD allow — must never run
    const svc = new PermissionService('read-only', ask);
    svc.setPolicy('never');
    expect(svc.approvalPolicy).toBe('never');
    await expect(svc.decide('bash', EXECUTE, call('bash'))).resolves.toBe('deny');
    expect(asked).toHaveLength(0);
  });

  it("a later-registered 'never' policy still short-circuits pending asks", async () => {
    const { ask, asked } = scriptedAsk(['allow']);
    const svc = new PermissionService('read-only', ask);
    // First ask goes through the asker (policy is still 'ask').
    await svc.decide('bash', EXECUTE, call('bash'));
    expect(asked).toHaveLength(1);
    svc.setPolicy('never');
    await expect(svc.decide('bash', NETWORK, call('bash'))).resolves.toBe('deny');
    expect(asked).toHaveLength(1); // unchanged — no second dispatch
  });
});

describe('PermissionService always-memory scopes', () => {
  it("execute 'always' remembers the program prefix: git status grants git log but not rm", async () => {
    const { ask, asked } = scriptedAsk(['always', 'deny']);
    const svc = new PermissionService('read-only', ask);
    await expect(svc.decide('bash', EXECUTE, call('bash', { command: 'git status -sb' }))).resolves.toBe('allow');
    await expect(svc.decide('bash', EXECUTE, call('bash', { command: 'git log --oneline' }))).resolves.toBe('allow');
    await expect(svc.check('bash', EXECUTE, call('bash', { command: 'git log' }))).resolves.toBe('allow');
    // Different program under the same tool: still gated (asked again → deny).
    await expect(svc.decide('bash', EXECUTE, call('bash', { command: 'rm -rf /tmp/x' }))).resolves.toBe('deny');
    expect(asked).toHaveLength(2); // git status + rm — git log came from memory
  });

  it('compound commands are remembered as the whole normalized chain, not their head program', async () => {
    const { ask } = scriptedAsk(['always']);
    const svc = new PermissionService('read-only', ask);
    await expect(
      svc.decide('bash', EXECUTE, call('bash', { command: 'cd x && rm -rf .' })),
    ).resolves.toBe('allow');
    // Same chain modulo whitespace: re-granted without asking.
    await expect(
      svc.decide('bash', EXECUTE, call('bash', { command: 'cd   x   &&  rm -rf .' })),
    ).resolves.toBe('allow');
    // `cd` alone must NOT have been granted by the chain's head program.
    const { ask: fresh, asked } = scriptedAsk(['deny']);
    const svc2 = new PermissionService('read-only', fresh);
    await expect(svc2.decide('bash', EXECUTE, call('bash', { command: 'cd y' }))).resolves.toBe('deny');
    expect(asked).toHaveLength(1); // it asked — the prefix grant did not leak
  });

  it("non-execute 'always' is remembered per tool name + kind only", async () => {
    const { ask } = scriptedAsk(['always', 'deny', 'deny']);
    const svc = new PermissionService('read-only', ask);
    await expect(svc.decide('write_file', WRITE, call('write_file', { path: 'a' }))).resolves.toBe('allow');
    await expect(svc.decide('write_file', WRITE, call('write_file', { path: 'b' }))).resolves.toBe('allow');
    // Same tool, different kind: still gated.
    await expect(svc.decide('write_file', NETWORK, call('write_file'))).resolves.toBe('deny');
    // Different tool, same kind: still gated.
    await expect(svc.decide('edit_file', WRITE, call('edit_file'))).resolves.toBe('deny');
  });

  it('check() reports remembered and auto-allowed calls without asking', async () => {
    const { ask, asked } = scriptedAsk(['always']);
    const svc = new PermissionService('read-only', ask);
    await svc.decide('bash', EXECUTE, call('bash', { command: 'git status' }));
    await expect(svc.check('bash', EXECUTE, call('bash', { command: 'git diff' }))).resolves.toBe('allow');
    await expect(svc.check('bash', EXECUTE, call('bash', { command: 'curl evil' }))).resolves.toBe('ask');
    expect(asked).toHaveLength(1);
  });
});

describe('PermissionService audit', () => {
  it('records every ask-path outcome, including fail-closed denials', async () => {
    const audit = vi.fn<(e: { toolName: string; kind: PermissionKind; outcome: AskAnswer }) => void>();
    const throwing: AskFn = async () => {
      throw new Error('boom');
    };
    const svc = new PermissionService('read-only', throwing, audit);
    await svc.decide('bash', EXECUTE, call('bash', { command: 'ls' }));
    expect(audit).toHaveBeenCalledWith({ toolName: 'bash', kind: EXECUTE, outcome: 'deny' });

    const { ask } = scriptedAsk(['always']);
    const svc2 = new PermissionService('read-only', ask, audit);
    await svc2.decide('write_file', WRITE, call('write_file'));
    expect(audit).toHaveBeenCalledWith({ toolName: 'write_file', kind: WRITE, outcome: 'always' });
  });
});
