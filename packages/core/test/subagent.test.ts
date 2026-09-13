import { describe, expect, it } from 'vitest';
import { createSubagentTool } from '../src/tools/subagent.js';
import type { AgentMessage, ChatProvider, StreamEvent, ToolDefinition } from '../src/index.js';

const ANSWER: StreamEvent[] = [
  { type: 'text_delta', text: 'the report' },
  { type: 'finish', finishReason: 'stop' },
];

function noopTool(name: string): ToolDefinition {
  return {
    name,
    description: 'x',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => 'x',
  };
}

describe('subagent tool', () => {
  it('runs a nested loop on a fresh surface and returns the final report as the tool result', async () => {
    const requests: AgentMessage[][] = [];
    let call = 0;
    const provider: ChatProvider = {
      async *stream(req) {
        requests.push([...req.messages]); // snapshot: runAgent grows the array in place
        const events = call === 0
          ? [
              { type: 'tool_call_delta', index: 0, id: 'c1', name: 'read_file', argsDelta: '{"path":"a"}' },
              { type: 'finish', finishReason: 'tool_calls' },
            ]
          : ANSWER;
        call += 1;
        for (const ev of events) yield ev;
      },
    };
    const readFile = noopTool('read_file');
    const tool = createSubagentTool({ provider, tools: () => [readFile], rootDir: () => '.' });
    const out = await tool.execute({ prompt: 'analyze a.txt', label: 'scan' }, { rootDir: '.' });

    expect(out).toContain('[subagent: scan]');
    expect(out).toContain('the report');
    // Two nested provider calls: the first turned tool_calls and the nested
    // read_file executed inside the subagent's own loop.
    expect(requests).toHaveLength(2);
    // Context isolation: the subagent's request surface contains ONLY its own
    // prompt + nested traffic — no parent history.
    expect(requests[0]).toHaveLength(1);
    expect(requests[0]![0]!.content).toContain('analyze a.txt');
  });

  it('filters subagent itself out of the nested toolset (no recursion)', async () => {
    let seenTools: string[] | undefined;
    const provider: ChatProvider = {
      async *stream(req) {
        seenTools = req.tools?.map((t) => t.name);
        for (const ev of ANSWER) yield ev;
      },
    };
    // The parent's live tool list includes the subagent tool itself.
    const parent = createSubagentTool({ provider, tools: () => [], rootDir: () => '.' });
    const tool = createSubagentTool({ provider, tools: () => [parent, noopTool('other')], rootDir: () => '.' });
    await tool.execute({ prompt: 'x' }, { rootDir: '.' });
    expect(seenTools).toEqual(['other']);
  });

  it('rejects an empty prompt without touching the provider', async () => {
    let called = 0;
    const provider: ChatProvider = {
      async *stream() {
        called += 1;
        for (const ev of ANSWER) yield ev;
      },
    };
    const tool = createSubagentTool({ provider, tools: () => [], rootDir: () => '.' });
    expect(await tool.execute({ prompt: '  ' }, { rootDir: '.' })).toContain('non-empty');
    expect(called).toBe(0);
  });
});
