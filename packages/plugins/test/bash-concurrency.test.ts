import { describe, expect, it } from 'vitest';
import { readOnlyBashCommand } from '../src/builtin/bash-readonly.js';

/**
 * The concurrency classifier's ONE invariant: it may only ever widen
 * parallelism for provably side-effect-free commands. Every ambiguous shape —
 * metacharacters, unknown commands, write subcommands — must fall back to
 * serial, which is the behavior the loop had before the classifier existed.
 */
describe('readOnlyBashCommand', () => {
  it('classifies plain read-only commands as concurrency-safe', () => {
    expect(readOnlyBashCommand('git status')).toBe(true);
    expect(readOnlyBashCommand('git log --oneline -5')).toBe(true);
    expect(readOnlyBashCommand('ls -la src')).toBe(true);
    expect(readOnlyBashCommand('cat package.json')).toBe(true);
    expect(readOnlyBashCommand('NO_COLOR=1 git diff --stat')).toBe(true);
    expect(readOnlyBashCommand('find . -name "*.ts"')).toBe(true);
  });

  it('rejects shell metacharacters anywhere in the command', () => {
    expect(readOnlyBashCommand('git status && rm -rf x')).toBe(false);
    expect(readOnlyBashCommand('ls | xargs rm')).toBe(false);
    expect(readOnlyBashCommand('git log > out.txt')).toBe(false);
    expect(readOnlyBashCommand('echo $(rm -rf x)')).toBe(false);
    expect(readOnlyBashCommand('ls\nrm -rf x')).toBe(false);
    expect(readOnlyBashCommand('git diff --output=x')).toBe(false);
  });

  it('rejects write commands, unknown commands, and write subcommands', () => {
    expect(readOnlyBashCommand('rm -rf x')).toBe(false);
    expect(readOnlyBashCommand('git push origin master')).toBe(false);
    expect(readOnlyBashCommand('git add -A')).toBe(false);
    expect(readOnlyBashCommand('pnpm install')).toBe(false);
    expect(readOnlyBashCommand('find . -delete')).toBe(false);
    expect(readOnlyBashCommand(undefined)).toBe(false);
    expect(readOnlyBashCommand('')).toBe(false);
  });
});
