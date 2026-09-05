import { describe, expect, it } from 'vitest';
import { createModelListCache, filterCommands, COMMAND_SPECS } from '../src/commands.js';

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
