import { describe, expect, it } from 'vitest';
import { createModelListCache, filterCommands, COMMAND_SPECS } from '../src/commands.js';

describe('filterCommands', () => {
  it('matches by prefix when input is a bare slash command', () => {
    // Order is an implementation choice; the user-visible contract is only
    // "both /model and /mode match the /m and /mode prefixes".
    const mMatches = filterCommands('/m').map((s) => s.name);
    expect(mMatches).toContain('/model');
    expect(mMatches).toContain('/mode');

    const modeMatches = filterCommands('/mode').map((s) => s.name);
    expect(modeMatches).toContain('/model');
    expect(modeMatches).toContain('/mode');

    // Bare slash lists every command.
    expect(filterCommands('/').map((s) => s.name).sort()).toEqual(
      COMMAND_SPECS.map((s) => s.name).sort(),
    );
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
