/**
 * createAgentKernel — the shared assembly point (M11 批1b): fragment seeding,
 * real PermissionService over the ApprovalBroker event flow, headless never
 * policy, PTC mode rebuild. Scripted provider, tmp dirs, zero network.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isContextFragment,
  type ChatProvider,
  type KernelEvent,
  type StreamEvent,
} from '@nova-agent/core';
import { createAgentKernel, type Plugin } from '../src/index.js';

function provider(scripts: StreamEvent[][]): ChatProvider {
  let call = 0;
  return {
    async *stream() {
      const events = scripts[call] ?? [];
      call += 1;
      for (const ev of events) yield ev;
    },
  };
}

const askToolScript: StreamEvent[] = [
  {
    type: 'tool_call_delta',
    index: 0,
    id: 'call_a',
    name: 'probe',
    argsDelta: '{"q":"x"}',
  },
];
const answerScript: StreamEvent[] = [{ type: 'text_delta', text: 'final answer' }];

function probePlugin(log: string[]): Plugin {
  return {
    name: 'probe',
    activate(ctx) {
      ctx.registerTool(
        {
          name: 'probe',
          description: 'test probe',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
          execute: (args) => {
            log.push(String(args['q'] ?? ''));
            return 'probed';
          },
          presentCall: (args) => ({
            card: 'generic',
            kind: 'other',
            title: `probe:${String(args['q'] ?? '')}`,
          }),
        },
        { permission: 'execute' },
      );
    },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nova-kernel-asm-'));
}

const baseConfig = { approval: 'read-only' as const };

describe('createAgentKernel', () => {
  it('seeds the context fragment and workspace marker into a fresh session', async () => {
    const dir = await tmp();
    const kernel = await createAgentKernel({
      rootDir: dir,
      provider: provider([answerScript]),
      config: baseConfig,
      sessionDir: await tmp(),
    });
    const first = kernel.agent.messages[0];
    expect(first).toBeDefined();
    expect(first !== undefined && isContextFragment(first)).toBe(true);
    expect(String(first?.content)).toContain('<environment>');
    expect(String(first?.content)).toContain(`cwd=${dir}`);
    expect(kernel.agent.session.events.some((e) => e.type === 'workspace')).toBe(true);

    await kernel.agent.prompt('hello');
    for (let i = 0; i < 2000 && kernel.agent.running; i++) await new Promise((r) => setTimeout(r, 1));
    const logged = kernel.agent.session.allMessages();
    // seeded context fragment + the prompt, then the assistant reply
    expect(logged.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
  });

  it('routes the approval gate through the broker: request event → resolve → execution', async () => {
    const log: string[] = [];
    const dir = await tmp();
    const kernel = await createAgentKernel({
      rootDir: dir,
      provider: provider([askToolScript, answerScript]),
      config: baseConfig,
      sessionDir: await tmp(),
      extraPlugins: [probePlugin(log)],
    });
    const events: KernelEvent[] = [];
    kernel.agent.subscribe((e) => events.push(e));
    await kernel.agent.prompt('ask');
    while (!events.some((e) => e.type === 'approval_request')) await new Promise((r) => setTimeout(r, 1));
    const request = (events.find((e) => e.type === 'approval_request') as {
      request: { id: string; call: { name: string }; view?: { title?: string }; preview?: string[] };
    }).request;
    expect(request.call.name).toBe('probe');
    expect(request.view?.title).toBe('probe:x');
    expect(kernel.agent.resolveApproval(request.id, 'allow')).toBe(true);
    for (let i = 0; i < 2000 && kernel.agent.running; i++) await new Promise((r) => setTimeout(r, 1));
    expect(log).toEqual(['x']);
    // audit pair lands in the session log (ask-path only)
    expect(
      kernel.agent.session.events.filter((e) => e.type === 'approval').map((e) => (e as { outcome: string }).outcome),
    ).toEqual(['allow']);
  });

  it('the never policy denies headless asks without dispatching the broker', async () => {
    const log: string[] = [];
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider([askToolScript, answerScript]),
      config: baseConfig,
      sessionDir: await tmp(),
      extraPlugins: [probePlugin(log)],
    });
    kernel.permission.setPolicy('never');
    const events: KernelEvent[] = [];
    kernel.agent.subscribe((e) => events.push(e));
    await kernel.agent.prompt('ask');
    for (let i = 0; i < 2000 && kernel.agent.running; i++) await new Promise((r) => setTimeout(r, 1));
    expect(events.some((e) => e.type === 'approval_request')).toBe(false);
    expect(log).toEqual([]);
    const denial = events.find((e) => e.type === 'tool_call_result') as
      | { result: { content: string } }
      | undefined;
    expect(denial?.result.content).toContain('Permission denied');
  });

  it('setCodeMode rebuilds the host (run_code joins, grants survive)', async () => {
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider([answerScript]),
      config: { ...baseConfig, code: { mode: 'native' } },
      sessionDir: await tmp(),
    });
    expect(kernel.host.tools.some((t) => t.name === 'run_code')).toBe(false);
    await kernel.setCodeMode('ptc');
    expect(kernel.host.tools.some((t) => t.name === 'run_code')).toBe(true);
    expect(kernel.codeMode()).toBe('ptc');
    // rebuild rebinds the composed hooks the agent and subagent share
    expect(kernel.hooks.beforeLLMCall).toBeTypeOf('function');
  });
});
