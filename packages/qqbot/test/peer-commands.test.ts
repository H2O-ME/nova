/**
 * The QQ command surface: which door an inbound line goes through.
 *
 * Two live defects are pinned here.
 *
 *  1. A group message arrives as `<@!bot_openid> /help` — the platform puts the
 *     robot's own mention INTO `content` — so the line began with `<`, no parser
 *     recognized it, and the command was sent to the model as prose. That is why
 *     slash commands worked in DMs and not in groups.
 *  2. `/compact`, `/goal`, `/mode` and every third-party command were not in this
 *     package's private whitelist, so they too became prompts. The kernel's live
 *     catalog decides now.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentSession, ApprovalMode, KernelEvent, SessionService } from '@nova-agent/core';
import type { AccessTier } from '../src/access.js';
import { BindingsStore } from '../src/bindings.js';
import { PeerTurns, type RemoteCommandSeat } from '../src/peers.js';
import { parseRemoteCommand, remoteBypassesQueue } from '../src/remote-parse.js';
import { parseInbound, stripLeadingMention } from '../src/types.js';

const PEER = { kind: 'c2c' as const, openid: 'U1', peerId: 'c2c:U1' };

/** Fails loudly if the prompt path is entered, which is how routing is asserted. */
function noSessions(): SessionService {
  return {
    current: () => undefined,
    get: () => undefined,
    list: () => [],
    open: () => Promise.reject(new Error('reached the prompt path')),
    activate: () => undefined,
  };
}

function seat(names: readonly string[]): RemoteCommandSeat & { calls: { name: string; args: string }[] } {
  const calls: { name: string; args: string }[] = [];
  return {
    calls,
    catalog: () => names.map((name) => ({ name, description: `${name} desc` })),
    run: async (name, args) => {
      calls.push({ name, args });
      return { found: true, text: `ran ${name} ${args}`.trim() };
    },
  };
}

async function turnsWith(commands: RemoteCommandSeat): Promise<PeerTurns> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-qqbot-cmd-'));
  return new PeerTurns({
    sessions: noSessions(),
    sessionDir: dir,
    // A real store, in a temp home: the binding is what makes a chat's
    // conversation durable, so a test that stubbed it would not be exercising the
    // path it claims to.
    bindings: new BindingsStore(path.join(dir, 'bindings.json')),
    rootDir: () => 'D:/work',
    model: () => 'm1',
    commands,
    notify: () => undefined,
  });
}

describe('the robot mention prefix', () => {
  it('is stripped once, where the platform is decoded', () => {
    const inbound = parseInbound('GROUP_AT_MESSAGE_CREATE', {
      id: 'IN1',
      group_openid: 'G1',
      author: { member_openid: 'M1' },
      content: '<@!BOT> /compact',
    });
    // Downstream (command parsing, the model prompt) sees the operator's
    // sentence. Without the strip, `content[0]` is `<` and nothing parses it.
    expect(parseRemoteCommand(inbound!.message.content.trim()).text).toBe('/compact');
    // Only LEADING markers: a mention mid-sentence is the operator's own text.
    expect(stripLeadingMention('让 <@!1> 看看')).toBe('让 <@!1> 看看');
  });

  it('treats a non-object payload as no message at all', () => {
    // `null` is valid JSON, so `d: null` used to throw a TypeError out of a
    // socket listener — taking the process down rather than the frame.
    expect(parseInbound('GROUP_AT_MESSAGE_CREATE', null)).toBeUndefined();
    expect(parseInbound('C2C_MESSAGE_CREATE', 42)).toBeUndefined();
  });
});

describe('slashes the kernel owns', () => {
  it('runs a live catalog command with its verbatim argument', async () => {
    const commands = seat(['goal']);
    const turns = await turnsWith(commands);
    expect(await turns.run('/goal 修好登录', PEER)).toBe('ran goal 修好登录');
    expect(commands.calls).toEqual([{ name: 'goal', args: '修好登录' }]);
  });

  it('follows the catalog, not a name list', async () => {
    // Not in the catalog ⇒ a PROMPT: never swallowed, and never answered with a
    // fabricated "unknown command".
    const turns = await turnsWith(seat([]));
    await expect(turns.run('/compact', PEER)).rejects.toThrow('reached the prompt path');
  });

  it('checks a QQ verb before the catalog', () => {
    // Structural, so it needs no session: a name this package owns is dispatched
    // before the catalog is consulted, because its verbs carry kernel seats a
    // catalog command cannot express (approving an outstanding ask).
    expect(parseRemoteCommand('/status').command).toEqual({ kind: 'status' });
    expect(parseRemoteCommand('/compact').command).toBeUndefined();
  });
});

describe('which commands may skip the serial queue', () => {
  it('bypasses only reads and the unblocking answers', () => {
    // The bypass exists for ONE deadlock: an approval can only be released by an
    // answer, so an answer that queued behind the parked turn would wait for
    // itself. A tier change mid-run would change the tier the running turn is
    // judged under, so it waits.
    const bypass = (text: string): boolean => {
      const parsed = parseRemoteCommand(text);
      return parsed.command !== undefined && remoteBypassesQueue(parsed.command);
    };
    expect([bypass('/approve'), bypass('/status'), bypass('/help')]).toEqual([true, true, true]);
    expect([bypass('/perm full'), bypass('/new'), bypass('/compact')]).toEqual([false, false, false]);
  });
});

/** A minimal session stand-in: the tier is the only fact these tests read. */
function fakeAgent(id: string, mode: ApprovalMode): AgentSession {
  const agent = {
    session: { id, file: `${id}.jsonl` },
    approvalMode: mode as ApprovalMode | undefined,
    disposed: false,
    running: false,
    pendingApprovals: () => [],
    pendingQuestions: () => [],
    resolveApproval: () => true,
    resolveQuestion: () => true,
    abort: () => undefined,
  };
  (agent as unknown as { setApprovalMode: (m: ApprovalMode) => void }).setApprovalMode = (m) => {
    agent.approvalMode = m;
  };
  return agent as unknown as AgentSession;
}

function tierTurns(opts: {
  list: () => AgentSession[];
  open: () => AgentSession;
  maxTier: AccessTier;
}): Promise<PeerTurns> {
  return mkdtemp(path.join(tmpdir(), 'nova-qqbot-tier-')).then((dir) =>
    new PeerTurns({
      sessions: {
        current: () => undefined,
        get: () => undefined,
        list: opts.list,
        open: async () => opts.open(),
        activate: () => undefined,
      },
      sessionDir: dir,
      bindings: new BindingsStore(path.join(dir, 'bindings.json')),
      rootDir: () => 'D:/work',
      model: () => 'm1',
      maxTier: () => opts.maxTier,
      notify: () => undefined,
    }),
  );
}

describe('the remote tier ceiling', () => {
  it('caps the tier of a conversation the peer OWNS, at creation', async () => {
    // The process default is `full`; the channel ceiling is `read-only`. Without
    // the cap the peer's own conversation runs at `full` while `/perm` reports the
    // ceiling — the ceiling governed the verb, not the execution.
    const created: AgentSession[] = [];
    const turns = await tierTurns({
      list: () => [],
      open: () => { const agent = fakeAgent(`s${created.length + 1}`, 'full'); created.push(agent); return agent; },
      maxTier: 'read-only',
    });
    await turns.run('/status', PEER);
    expect(created[0]?.approvalMode).toBe('read-only');
  });

  it('never lowers a RELAYED desktop session to the remote ceiling', async () => {
    const desktop = fakeAgent('desktop-1', 'full');
    const turns = await tierTurns({
      list: () => [desktop],
      open: () => fakeAgent('own-1', 'full'),
      maxTier: 'read-only',
    });
    const reply = await turns.run(`/use ${desktop.session.id.slice(0, 6)}`, PEER);
    expect(reply).toContain('接到');
    // The phone pointed at the desktop; it did not hand it a new tier. Lowering it
    // here would let the remote ceiling contaminate the operator's own session.
    expect(desktop.approvalMode).toBe('full');
  });
});

/** A session whose prompt emits one assistant message then goes idle. */
function scriptedAgent(id: string, replyText: string): AgentSession {
  const listeners = new Set<(event: KernelEvent) => void>();
  const agent = {
    ...fakeAgent(id, 'read-only'),
    subscribe: (listener: (event: KernelEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    prompt: async () => {
      for (const listener of listeners) {
        listener({ type: 'message', message: { id: 'm1', ts: 0, role: 'assistant', content: replyText } } as KernelEvent);
        listener({ type: 'phase', phase: 'idle' } as KernelEvent);
      }
    },
  };
  return agent as unknown as AgentSession;
}

describe('the answer is delivered on the reply budget', () => {
  it('returns the turn\'s answer instead of relaying it as narration', async () => {
    // The caller delivers the return value through the channel's reply seat, which
    // spends the reply class (the reserve narration leaves). Relaying it here as
    // narration put the answer on the DROPPABLE budget.
    const turns = await tierTurns({ list: () => [], open: () => scriptedAgent('s1', '结论正文'), maxTier: 'read-only' });
    expect(await turns.run('你好', PEER)).toBe('结论正文');
  });
});
