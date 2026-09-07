import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PluginHost, loadSkills, parseSkillFrontmatter, readSkillBody, skillsPlugin } from '../src/index.js';

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
}

describe('parseSkillFrontmatter', () => {
  it('extracts name, description and body, tolerating quotes', () => {
    const parsed = parseSkillFrontmatter(
      ['---', 'name: deploy-check', 'description: "Runs: release readiness checks"', '---', '', 'Step one.', 'Step two.'].join('\n'),
    );
    expect(parsed.name).toBe('deploy-check');
    expect(parsed.description).toBe('Runs: release readiness checks');
    expect(parsed.body).toBe('Step one.\nStep two.');
  });

  it('falls back to the directory name and treats files without frontmatter as plain body', () => {
    expect(parseSkillFrontmatter('Just instructions.').body).toBe('Just instructions.');
  });
});

describe('loadSkills', () => {
  it('collects skills, with project roots winning name conflicts over user roots', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'nova-skills-p-'));
    const user = await mkdtemp(path.join(tmpdir(), 'nova-skills-u-'));
    await writeSkill(project, 'alpha', '---\nname: alpha\ndescription: project alpha\n---\nPROJECT BODY');
    await writeSkill(project, 'beta', '---\nname: beta\ndescription: project beta\n---\nB');
    await writeSkill(user, 'alpha', '---\nname: alpha\ndescription: user alpha\n---\nUSER BODY');
    await writeSkill(user, 'gamma', 'not-a-frontmatter body');

    const skills = await loadSkills([
      { dir: project, level: 'project' },
      { dir: user, level: 'user' },
    ]);
    expect(skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
    const alpha = skills.find((s) => s.name === 'alpha');
    expect(alpha?.description).toBe('project alpha');
    expect(alpha?.level).toBe('project');
    await expect(readSkillBody(alpha!)).resolves.toBe('PROJECT BODY');
    const gamma = skills.find((s) => s.name === 'gamma');
    expect(gamma?.description).toBe('');
  });

  it('ignores missing roots and directories without SKILL.md', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-skills-'));
    await mkdir(path.join(root, 'empty-dir'), { recursive: true });
    const skills = await loadSkills([
      { dir: path.join(root, 'does-not-exist'), level: 'project' },
      { dir: root, level: 'user' },
    ]);
    expect(skills).toEqual([]);
  });
});

describe('skillsPlugin', () => {
  it('registers a `skill` tool that loads bodies on demand', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-skills-'));
    await writeSkill(root, 'deploy-check', '---\nname: deploy-check\ndescription: checks\n---\n1. Run pnpm verify');
    const skills = await loadSkills([{ dir: root, level: 'project' }]);
    const host = new PluginHost(root);
    host.use(skillsPlugin(skills));
    await host.activate();

    expect(host.tools.map((t) => t.name)).toEqual(['skill']);
    expect(await host.permissionFor('skill')).toBe('read');
    const tool = host.tools[0]!;
    await expect(tool.execute({ name: 'deploy-check' }, { rootDir: root })).resolves.toBe('1. Run pnpm verify');
    await expect(tool.execute({ name: 'nope' }, { rootDir: root })).resolves.toContain('unknown skill "nope"');
    await expect(tool.execute({ name: 'nope' }, { rootDir: root })).resolves.toContain('deploy-check');
  });
});
