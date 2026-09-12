import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  JobRegistry,
  newId,
  Session,
  type AgentHooks,
  type AgentMessage,
  type AssistantMessage,
  type ChatProvider,
  type ToolCall,
  type ToolResultMessage,
} from '@nova-agent/core';
import { agentRunBase, createApprovalService, persistMissingToolResults } from '../src/runner-shared.js';
import { createSessionRuntime } from '../src/session-runtime.js';
import { sessionDateBucket, type Config } from '../src/config.js';

const config: Config = {
  provider: { baseURL: 'https://unused.example.com/v1', apiKey: 'sk-test', model: 'test-model' },
};

/** Isolate os.homedir() (session root + user skills dir) in a fake home. */
async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-sr-home-'));
  const prevProfile = process.env['USERPROFILE'];
  const prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn(home);
  } finally {
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
  }
}

const executeCall = (command: string): ToolCall => ({
  id: 'c1',
  name: 'bash',
  args: { command },
  rawArgs: JSON.stringify({ command }),
});

describe('session runtime /new roundtrip', () => {
  it('seeds the fragment into the GIVEN session after a rebind; the old log gains no orphan', async () => {
    await withFakeHome(async (home) => {
      const root = await mkdtemp(path.join(tmpdir(), 'nova-sr-root-'));
      const rt = await createSessionRuntime({ rootDir: root, config });

      // Initial seed landed in the runtime's own session.
      expect(rt.messages).toHaveLength(1);
      expect(rt.messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('<environment>') });
      const initial = await Session.replay(rt.session.file);
      expect(initial.messages).toHaveLength(1);

      // /new-style rebind: a FRESH session, and seedContextFragment must
      // target it — not the stale rt.session/rt.messages bindings.
      const sessionsDir = path.join(home, '.nova', 'sessions', sessionDateBucket());
      const fresh = await Session.create(sessionsDir);
      const freshMessages: AgentMessage[] = [];
      await rt.seedContextFragment(fresh, freshMessages);

      expect(freshMessages).toHaveLength(1);
      expect(freshMessages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('<environment>') });
      const freshReplay = await Session.replay(fresh.file);
      expect(freshReplay.messages).toHaveLength(1);
      expect(freshReplay.messages[0]).toMatchObject({ content: expect.stringContaining('<environment>') });

      // The old log is untouched: still exactly the original seed, no orphan.
      expect((await Session.replay(rt.session.file)).messages).toHaveLength(1);
    });
  });
});

describe('approval audit session accessor', () => {
  it('writes ask-path audit events to the CURRENT session after a rebind', async () => {
    await withFakeHome(async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'nova-sr-root-'));
      const rt = await createSessionRuntime({ rootDir: root, config });
      // Runner-side binding, rebound /new-style after the service was built.
      let session: Session = rt.session;
      const permission = createApprovalService('read-only', async () => 'always', () => session);

      const sessionsDir = path.join(rt.session.file, '..');
      const fresh = await Session.create(sessionsDir);
      session = fresh;

      // read-only auto-denies nothing here: execute under read-only asks, so
      // the asker runs and the audit entry fires — into the CURRENT log.
      const verdict = await permission.decide('bash', 'execute', executeCall('echo hi'));
      expect(verdict).toBe('allow');

      // The audit write is fire-and-forget (void + catch) — poll for the flush.
      await vi.waitFor(() => {
        expect(readFileSync(fresh.file, 'utf8')).toContain('"type":"approval"');
      });
      const oldLog = await readFile(rt.session.file, 'utf8');
      expect(oldLog).not.toContain('"type":"approval"');
    });
  });
});

describe('agentRunBase session accessor', () => {
  it('derives cacheDir and emit target from the CURRENT session after a rebind', async () => {    await withFakeHome(async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'nova-sr-root-'));
      const rt = await createSessionRuntime({ rootDir: root, config });
      let session: Session = rt.session;
      const provider: ChatProvider = {
        // oxlint-disable-next-line require-yield
        async *stream() {
          throw new Error('not used');
        },
      };
      const base = agentRunBase({
        client: provider,
        session: () => session,
        rootDir: () => root,
        messages: () => [],
        tools: () => [],
        hooks: () => ({} as AgentHooks),
        jobs: new JobRegistry(),
      });

      const fresh = await Session.create(path.join(rt.session.file, '..'));
      session = fresh;

      const run = base();
      expect(run.cacheDir).toContain(fresh.id);
      expect(run.cacheDir).not.toContain(rt.session.id);
      await run.emit({ type: 'todo/write', todos: [], at: Date.now() });
      const freshLog = await readFile(fresh.file, 'utf8');
      expect(freshLog).toContain('"type":"todo/write"');
    });
  });
});

describe('persistMissingToolResults', () => {
  it('appends synthesized results for unanswered logged tool_calls and fills the surface', async () => {
    await withFakeHome(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'nova-sr-persist-'));
      const session = await Session.create(dir);
      const assistant: AssistantMessage = {
        id: newId('msg'),
        ts: Date.now(),
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'bash', args: { command: 'echo hi' }, rawArgs: '{"command":"echo hi"}' },
          { id: 'call_2', name: 'read_file', args: { path: 'a' }, rawArgs: '{"path":"a"}' },
        ],
      };
      await session.append(assistant);
      const answered: ToolResultMessage = {
        id: newId('msg'),
        ts: Date.now(),
        role: 'tool',
        toolCallId: 'call_1',
        name: 'bash',
        content: 'hi',
      };
      await session.append(answered);
      // Surface has the assistant but never received the tool_call_result.
      const surface: AgentMessage[] = [assistant];

      const appended = await persistMissingToolResults(session, surface);
      expect(appended).toBe(1);

      const replay = await Session.replay(session.file);
      const results = replay.messages.filter((m): m is ToolResultMessage => m.role === 'tool');
      expect(results.map((r) => r.toolCallId)).toEqual(['call_1', 'call_2']);
      expect(results[1]?.content).toContain('not executed');
      // The surface hole is filled too (core's abandonment synthesis may have
      // already covered it — either way exactly one result per call).
      expect(surface.filter((m) => m.role === 'tool' && m.toolCallId === 'call_2')).toHaveLength(1);

      // Idempotent: a second pass finds nothing missing.
      expect(await persistMissingToolResults(session, surface)).toBe(0);
      const replay2 = await Session.replay(session.file);
      expect(replay2.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
    });
  });
});
