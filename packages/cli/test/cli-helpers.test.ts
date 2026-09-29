/**
 * CLI-only helpers: system prompt byte-stability (via the plugins package),
 * and the Windows toast PowerShell script.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from '@nova-agent/plugins';
import { buildWindowsToastScript } from '../src/notify.js';

describe('system prompt', () => {
  it('forbids tool use on greetings and unsolicited work', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Do NOT call any tools/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/only when the user asks for it/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/do not invent follow-up work/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Mirror the user's language/);
  });

  it('frames subagents as context isolation, never design delegation', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/CONTEXT-ISOLATION tool/);
    // codex 编排经验：侦察默认只读、brief 不重叠、设计/实现留在主代理。
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/1–2 scout subagents/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/NEVER delegate design or complex implementation/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/re-search the same question/);
  });

  it('stays byte-stable: no environment or user instructions baked in', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).not.toContain('platform=');
    expect(prompt).not.toContain('## User instructions');
    // the fragment contract is documented in the prompt itself
    expect(prompt).toContain('<environment>');
    expect(prompt).toContain('<available_skills>');
  });
});

describe('windows toast script', () => {
  it('escapes quotes and flattens newlines for the PowerShell string literals', () => {
    const script = buildWindowsToastScript('Nova', "it's done\nline2");
    expect(script).toContain("$t='Nova'");
    expect(script).toContain("$b='it''s done line2'");
    expect(script).toContain('ToastNotificationManager');
    expect(script).toContain('ShowBalloonTip'); // balloon fallback present
  });
});
