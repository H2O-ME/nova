import { describe, expect, it } from 'vitest';
import { createModelListCache, filterCommands, resolveModelArg, COMMAND_SPECS } from '../src/commands.js';

describe('filterCommands', () => {
  it('matches by prefix when input is a bare slash command', () => {
    expect(filterCommands('/m').map((s) => s.name)).toEqual(['/model', '/mcp']);
    expect(filterCommands('/model').map((s) => s.name)).toEqual(['/model']);
    expect(filterCommands('/').map((s) => s.name)).toEqual(COMMAND_SPECS.map((s) => s.name));
  });

  it('closes once the user types arguments', () => {
    expect(filterCommands('/model gpt')).toEqual([]);
    expect(filterCommands('hello')).toEqual([]);
    expect(filterCommands('')).toEqual([]);
  });
});

describe('resolveModelArg', () => {
  const list = async (): Promise<string[]> => ['gpt-4o-mini', 'deepseek-chat', 'kimi-k2'];

  it('passes non-numeric args through as the model name', async () => {
    await expect(resolveModelArg('deepseek-reasoner', list)).resolves.toBe('deepseek-reasoner');
  });

  it('resolves a 1-based list index', async () => {
    await expect(resolveModelArg('2', list)).resolves.toBe('deepseek-chat');
    await expect(resolveModelArg('3', list)).resolves.toBe('kimi-k2');
  });

  it('rejects an out-of-range index with the list size in the message', async () => {
    await expect(resolveModelArg('4', list)).rejects.toThrow('共 3 个');
    await expect(resolveModelArg('0', list)).rejects.toThrow();
  });
});

describe('createModelListCache', () => {
  it('caches the fetched list within the ttl', async () => {
    let calls = 0;
    const fetchList = async (): Promise<string[]> => {
      calls += 1;
      return ['a'];
    };
    const cached = createModelListCache(fetchList, 60_000);
    await cached();
    await cached();
    expect(calls).toBe(1);
  });

  it('refetches after the ttl expires', async () => {
    let calls = 0;
    const fetchList = async (): Promise<string[]> => {
      calls += 1;
      return ['a'];
    };
    const cached = createModelListCache(fetchList, 0);
    await cached();
    await cached();
    expect(calls).toBe(2);
  });
});
