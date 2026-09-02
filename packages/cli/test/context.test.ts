import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SkillMetadata } from '@nova-agent/plugins';
import { buildContextFragment, expandSkillInvocation, type SessionEnvInfo } from '../src/context.js';

const env: SessionEnvInfo = {
  platform: 'win32',
  cwd: 'D:\\web\\agent',
  shell: 'bash.exe',
  today: '2026-08-31',
};

async function makeSkill(name: string, body: string): Promise<SkillMetadata> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-skill-'));
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const file = path.join(skillDir, 'SKILL.md');
  await writeFile(file, `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`, 'utf8');
  return { name, description: `${name} description`, file, level: 'project' };
}

function fakeSkill(name: string): SkillMetadata {
  return { name, description: `${name} description`, file: `D:\\skills\\${name}\\SKILL.md`, level: 'project' };
}

describe('buildContextFragment', () => {
  it('renders environment, user instructions and skills index as one stable block', () => {
    const text = buildContextFragment(env, 'Always answer in haiku.', [fakeSkill('alpha'), fakeSkill('beta')]);
    expect(text).toContain('<environment>');
    expect(text).toContain('platform=win32');
    expect(text).toContain('cwd=D:\\web\\agent');
    expect(text).toContain('today=2026-08-31');
    expect(text).toContain('<user_instructions>\nAlways answer in haiku.');
    expect(text).toContain('- alpha: alpha description');
    expect(text).toContain('- beta: beta description');
    expect(text).toContain('`skill` tool');
    // sections appear in a deterministic order: env, instructions, skills
    expect(text.indexOf('<environment>')).toBeLessThan(text.indexOf('<user_instructions>'));
    expect(text.indexOf('<user_instructions>')).toBeLessThan(text.indexOf('<available_skills>'));
  });

  it('omits sections that have no content', () => {
    const text = buildContextFragment(env, '   ', []);
    expect(text).not.toContain('<user_instructions>');
    expect(text).not.toContain('<available_skills>');
    expect(text).not.toContain('<project_docs>');
    expect(text).toContain('<environment>');
  });

  it('renders project docs as a project_docs section between instructions and skills', () => {
    const text = buildContextFragment(env, undefined, [fakeSkill('alpha')], ['# Workspace rules', 'use pnpm']);
    expect(text).toContain('<project_docs>');
    expect(text).toContain('# Workspace rules\n\n--- project-doc ---\n\nuse pnpm');
    expect(text.indexOf('<project_docs>')).toBeLessThan(text.indexOf('<available_skills>'));
  });
});

describe('expandSkillInvocation', () => {
  it('is undefined for non-skill input', async () => {
    await expect(expandSkillInvocation('hello', [fakeSkill('alpha')])).resolves.toBeUndefined();
    await expect(expandSkillInvocation('/skillfoo', [fakeSkill('alpha')])).resolves.toBeUndefined();
  });

  it('expands /skill <name> to a user message carrying the body', async () => {
    const alpha = await makeSkill('alpha', '1. Run pnpm verify');
    const invocation = await expandSkillInvocation('/skill alpha extra words', [alpha]);
    expect(invocation).toMatchObject({ ok: true });
    if (invocation?.ok) {
      expect(invocation.content).toContain('[调用技能 alpha]');
      expect(invocation.content).toContain('1. Run pnpm verify');
      expect(invocation.content).toContain('请按照以上技能指令');
    }
  });

  it('reports a read error for a skill whose file disappeared', async () => {
    const ghost: SkillMetadata = {
      name: 'ghost',
      description: '',
      file: 'Z:\\does\\not\\exist\\SKILL.md',
      level: 'project',
    };
    const invocation = await expandSkillInvocation('/skill ghost', [ghost]);
    expect(invocation).toMatchObject({ ok: false });
  });

  it('reports usage errors for missing and unknown skills', async () => {
    const alpha = await makeSkill('alpha', 'body');
    const missing = await expandSkillInvocation('/skill', [alpha]);
    expect(missing).toMatchObject({ ok: false });
    const unknown = await expandSkillInvocation('/skill nope', [alpha]);
    expect(unknown).toMatchObject({ ok: false });
    if (!unknown?.ok) expect(unknown.error).toContain('可用：alpha');
    const none = await expandSkillInvocation('/skill alpha', []);
    if (!none?.ok) expect(none.error).toContain('未安装任何技能');
  });
});
