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

describe('createAgentKernel · model control', () => {
  /** The shipped client's shape: an id it owns, an endpoint catalog, a retarget. */
  function switchable(ids: string[], initial = ids[0] ?? ''): ChatProvider {
    let current = initial;
    return {
      get model(): string {
        return current;
      },
      setModel(next: string): void {
        current = next;
      },
      async listModels(): Promise<string[]> {
        return [...ids];
      },
      async *stream() {
        yield { type: 'text_delta', text: `[${current}]` };
      },
    };
  }

  const catalog = {
    label: 'api.test.example',
    describe: (model: string): Promise<{ name?: string } | undefined> =>
      Promise.resolve(model === 'm2' ? { name: 'Model Two' } : undefined),
  };

  it('is absent for a client that cannot be retargeted (the seat stays unrendered)', async () => {
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider([answerScript]),
      config: baseConfig,
      sessionDir: await tmp(),
      modelCatalog: catalog,
    });
    expect(kernel.models).toBeUndefined();
  });

  it('lists the endpoint ids with the surface metadata, and switches in place', async () => {
    const providerInstance = switchable(['m1', 'm2']);
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: providerInstance,
      config: baseConfig,
      sessionDir: await tmp(),
      modelCatalog: catalog,
    });
    const models = kernel.models;
    if (models === undefined) throw new Error('no model control');
    expect(models.current()).toBe('m1');
    expect(await models.list()).toEqual([
      {
        id: 'endpoint',
        name: 'api.test.example',
        models: [{ id: 'm1', name: 'm1' }, { id: 'm2', name: 'Model Two' }],
      },
    ]);

    const events: KernelEvent[] = [];
    kernel.agent.subscribe((e) => events.push(e));
    const chosen = await models.select('m2');
    expect(chosen).toMatchObject({ id: 'm2', name: 'Model Two' });
    // In place on the ONE client: the id moved…
    expect(providerInstance.model).toBe('m2');
    expect(models.current()).toBe('m2');
    // …and the session announced it, so a second surface renders the same model.
    expect(events.find((e) => e.type === 'model')).toMatchObject({ type: 'model', model: 'm2' });
  });

  it('always offers the model in force, even when the endpoint omits it', async () => {
    // A deployment that retired the id this client was started on: the menu
    // still has to answer "what am I talking to", so the row is prepended.
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: switchable(['m8', 'm9'], 'm1'),
      config: baseConfig,
      sessionDir: await tmp(),
      modelCatalog: catalog,
    });
    const models = kernel.models;
    if (models === undefined) throw new Error('no model control');
    const groups = await models.list();
    expect(groups[0]?.models.map((m) => m.id)).toEqual(['m1', 'm8', 'm9']);
  });
});

describe('createAgentKernel · commands', () => {
  /** A third-party command: the registry is a plugin seam, not a built-in list. */
  const echoPlugin: Plugin = {
    name: 'echo-command',
    activate(ctx) {
      ctx.registerCommand({
        name: 'echo',
        description: '测试命令',
        run: (args, out) => {
          out.log(`echo ${args}`);
        },
      });
    },
  };

  async function withCommands(scripts: StreamEvent[][], extraPlugins: Plugin[] = [echoPlugin]) {
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider(scripts),
      config: baseConfig,
      sessionDir: await tmp(),
      extraPlugins,
    });
    const events: KernelEvent[] = [];
    kernel.agent.subscribe((e) => events.push(e));
    return { kernel, events };
  }

  it('publishes the kernel catalog and every plugin command in one list', async () => {
    const { kernel } = await withCommands([answerScript]);
    const names = kernel.commands.map((command) => command.name);
    expect(names).toContain('compact');
    expect(names).toContain('echo');
    expect(kernel.commands.every((command) => command.description.length > 0)).toBe(true);
  });

  it('runs a command as a run/done event pair carrying what it logged', async () => {
    const { kernel, events } = await withCommands([answerScript]);
    await kernel.runCommand('echo', 'hi');
    expect(events.filter((e) => e.type === 'command')).toEqual([
      { type: 'command', name: 'echo', phase: 'run' },
      { type: 'command', name: 'echo', phase: 'done', text: 'echo hi' },
    ]);
  });

  it('answers an unknown name in its own row rather than throwing at the caller', async () => {
    const { kernel, events } = await withCommands([answerScript]);
    await kernel.runCommand('nope', '');
    expect(events.filter((e) => e.type === 'command')).toEqual([
      { type: 'command', name: 'nope', phase: 'done', text: '未知命令：/nope' },
    ]);
  });

  it('a command that throws reports the reason in the same row (the run survives)', async () => {
    const failing: Plugin = {
      name: 'failing-command',
      activate(ctx) {
        ctx.registerCommand({
          name: 'boom',
          description: '总是失败',
          run: () => {
            throw new Error('别按我');
          },
        });
      },
    };
    const { kernel, events } = await withCommands([answerScript], [failing]);
    await kernel.runCommand('boom', '');
    expect(events.filter((e) => e.type === 'command').at(-1)).toMatchObject({
      phase: 'done',
      text: expect.stringContaining('别按我'),
    });
  });

  it('/compact drives the kernel compaction, in-band with its lifecycle', async () => {
    const summaryScript: StreamEvent[] = [{ type: 'text_delta', text: '## 摘要\n压缩后的摘要' }];
    const { kernel, events } = await withCommands([answerScript, summaryScript], []);
    await kernel.agent.prompt('hello');
    for (let i = 0; i < 2000 && kernel.agent.running; i += 1) await new Promise((r) => setTimeout(r, 1));
    await kernel.runCommand('compact', '');
    const triggers = events
      .filter((e) => e.type === 'compaction')
      .map((e) => e.progress);
    expect(triggers).toContainEqual({ state: 'start', trigger: 'manual' });
    expect(triggers.at(-1)).toMatchObject({ state: 'done', trigger: 'manual' });
    // The command's own rows bracket it (the report the transcript renders).
    expect(events.filter((e) => e.type === 'command').map((e) => e.phase)).toEqual(['run', 'done']);
  });
});
