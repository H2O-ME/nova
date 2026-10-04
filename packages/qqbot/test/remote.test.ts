/**
 * 遥控的执行面：把认得的指令接到内核接缝上（`qqbot-remote.ts`），以及**审批的
 * fail-closed**（`awaitRemoteAnswer`）。
 *
 * 内核接缝全部注入，所以每条指令都能对着假实现直接驱动。这里钉两件事故性的东西：
 *  - 换权限档**读回**确认（没落到就必须说没落到，不能报成功）；
 *  - 远程审批超时**必拒**——一个挂着的审批会把整轮运行永久停住，QQ 对端随时可能不回。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalMode, AskResult } from '@nova-agent/core';
import { awaitRemoteAnswer, runRemoteCommand, type RemoteContext } from '../src/remote.js';

/** 一个记下所有动作的假内核 + 假会话。`mode: undefined` 模拟没有权限服务的会话。 */
function makeCtx(opts: { mode?: ApprovalMode; noPermissionService?: boolean; pending?: { id: string; call: { name: string } }[] } = {}) {
  const calls: string[] = [];
  // A session WITHOUT a permission service: `setApprovalMode` no-ops and the
  // read-back stays undefined — the case the "did it land" check exists for.
  const detached = opts.noPermissionService === true;
  let mode: ApprovalMode | undefined = detached ? undefined : (opts.mode ?? 'read-only');
  const resolved: { id: string; answer: AskResult }[] = [];
  const ctx: RemoteContext = {
    kernel: {
      rootDir: () => 'D:/work',
      setWorkspace: (dir) => {
        if (dir === 'bad') return Promise.reject(new Error('not a directory'));
        calls.push(`ws:${dir}`);
        return Promise.resolve([]);
      },
      models: {
        current: () => 'model-a',
        list: () => Promise.resolve([{ models: [{ id: 'model-a' }, { id: 'model-b' }] }]),
        select: (model) => {
          calls.push(`model:${model}`);
          return Promise.resolve({ id: model });
        },
      },
    },
    session: {
      setApprovalMode: (next) => {
        if (detached) return;
        calls.push(`perm:${next}`);
        mode = next;
      },
      approvalMode: () => mode,
      pendingApprovals: () => opts.pending ?? [],
      resolveApproval: (id, answer) => {
        resolved.push({ id, answer });
        return true;
      },
    },
    newSession: () => {
      calls.push('new');
      return Promise.resolve({} as never);
    },
  };
  return { ctx, calls, resolved };
}

describe('remote command execution', () => {
  it('switches the permission tier and reads it back', async () => {
    const { ctx, calls } = makeCtx();
    const out = await runRemoteCommand({ kind: 'perm', mode: 'full' }, ctx);
    expect(calls).toContain('perm:full');
    expect(out.reply).toContain('全放行');
  });

  it('admits a permission switch that did not land', async () => {
    // `setApprovalMode` no-ops when the session has no permission service. A reply
    // that echoed the request would claim a switch the kernel never made.
    const { ctx } = makeCtx({ noPermissionService: true });
    const out = await runRemoteCommand({ kind: 'perm', mode: 'full' }, ctx);
    expect(out.reply).toContain('未能切换');
  });

  it('refuses to pretend a model switch happened with no model seat', async () => {
    const ctx = makeCtx().ctx;
    const bare: RemoteContext = { ...ctx, kernel: { ...ctx.kernel, models: undefined } };
    expect((await runRemoteCommand({ kind: 'model', model: 'x' }, bare)).reply).toContain('没有模型座位');
    expect((await runRemoteCommand({ kind: 'models' }, bare)).reply).toContain('没有模型座位');
  });

  it('lists the model ids and switches through the kernel seat', async () => {
    const { ctx, calls } = makeCtx();
    const list = await runRemoteCommand({ kind: 'models' }, ctx);
    expect(list.reply).toContain('model-a');
    expect(list.reply).toContain('model-b');
    const switched = await runRemoteCommand({ kind: 'model', model: 'model-b' }, ctx);
    expect(calls).toContain('model:model-b');
    expect(switched.reply).toContain('model-b');
  });

  it('reports a workspace refusal instead of swallowing it', async () => {
    const { ctx } = makeCtx();
    const refused = await runRemoteCommand({ kind: 'workspace', dir: 'bad' }, ctx);
    expect(refused.reply).toContain('not a directory');
    const moved = await runRemoteCommand({ kind: 'workspace', dir: 'D:/other' }, ctx);
    expect(moved.reply).toContain('D:/work');
  });

  it('answers an approval with a denial that carries a reason', async () => {
    // A bare `deny` would reach the model as an unexplained refusal; the reason is
    // what turns it into an instruction, which is the same contract the browser's
    // deny box honours.
    const { ctx, resolved } = makeCtx({ pending: [{ id: 'apr1', call: { name: 'bash' } }] });
    const out = await runRemoteCommand({ kind: 'approve', allow: false }, ctx);
    expect(out.reply).toContain('bash');
    expect(resolved).toEqual([{ id: 'apr1', answer: { answer: 'deny', reason: expect.any(String) } }]);
  });

  it('says there is nothing to approve when the queue is empty', async () => {
    const { ctx } = makeCtx();
    expect((await runRemoteCommand({ kind: 'approve', allow: true }, ctx)).reply).toContain('没有待审批');
  });

  it('hands back the new session for /new so the caller can rebind', async () => {
    const { ctx, calls } = makeCtx();
    const out = await runRemoteCommand({ kind: 'new' }, ctx);
    expect(calls).toContain('new');
    expect(out.nextAgent).toBeDefined();
  });
});

describe('remote approval waiting', () => {
  it('fails CLOSED when the peer never answers', async () => {
    // The bound is the whole reason this function exists: an ask that waits
    // forever parks the run, and a QQ peer can always fail to reply.
    vi.useFakeTimers();
    try {
      const pending = awaitRemoteAnswer(() => new Promise(() => undefined), 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the answer when the peer replies in time', async () => {
    expect(await awaitRemoteAnswer(() => Promise.resolve('/approve'), 5_000)).toBe('/approve');
  });
});
