import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from './types.js';

/**
 * Skills (GOALS §7): `.nova/skills/<name>/SKILL.md` with a tiny YAML
 * frontmatter (name, description). Only name+description are loaded at
 * startup; the body is read on demand — via the `skill` agent tool or the
 * `/skill <name>` command — so the system prompt never bloats.
 */

export interface SkillRoot {
  dir: string;
  /** Earlier roots win name conflicts; pass project roots before user roots. */
  level: 'project' | 'user';
}

export interface SkillMetadata {
  name: string;
  description: string;
  /** Absolute path of the SKILL.md file; the body is read on demand. */
  file: string;
  level: 'project' | 'user';
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** Parse `name`/`description` frontmatter; the body is the rest of the file. */
export function parseSkillFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) return { body: normalized.trim() };
  let name: string | undefined;
  let description: string | undefined;
  for (const line of (match[1] ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'name' && value.length > 0) name = value;
    if (key === 'description' && value.length > 0) description = value;
  }
  return { name, description, body: normalized.slice(match[0].length).trim() };
}

/**
 * Collect skills from the given roots (in order; first root listing a name
 * owns it). Roots that do not exist or contain no SKILL.md are skipped, so
 * an optional user-level directory costs nothing.
 */
export async function loadSkills(roots: SkillRoot[]): Promise<SkillMetadata[]> {
  const byName = new Map<string, SkillMetadata>();
  for (const root of roots) {
    const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => undefined);
    if (entries === undefined) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root.dir, entry.name, 'SKILL.md');
      const raw = await readFile(file, 'utf8').catch(() => undefined);
      if (raw === undefined) continue;
      const parsed = parseSkillFrontmatter(raw);
      const name = parsed.name ?? entry.name;
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        description: parsed.description ?? '',
        file,
        level: root.level,
      });
    }
  }
  return [...byName.values()];
}

/** Full instructions of a skill: the SKILL.md content minus frontmatter. */
export async function readSkillBody(skill: SkillMetadata): Promise<string> {
  const raw = await readFile(skill.file, 'utf8');
  return parseSkillFrontmatter(raw).body;
}

/**
 * Registers the `skill` agent tool: the model can load a skill's full
 * instructions by name before following them (GOALS §7).
 */
export function skillsPlugin(skills: SkillMetadata[]): Plugin {
  return {
    name: 'skills',
    description: 'On-demand loading of project/user skills (SKILL.md instructions).',
    activate(ctx) {
      ctx.registerTool({
        name: 'skill',
        description:
          'Loads the full instructions of a skill by name. Available skills are listed in the <available_skills> block of the first user message; call this tool before following a skill. Args: name (required).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name, e.g. "deploy-check".' },
          },
          required: ['name'],
          additionalProperties: false,
        },
        async execute(args) {
          const name = typeof args['name'] === 'string' ? args['name'] : '';
          const skill = skills.find((s) => s.name === name);
          if (!skill) {
            const available = skills.map((s) => s.name).join(', ');
            return `Error: unknown skill "${name}"${available.length > 0 ? ` (available: ${available})` : ' (no skills installed)'}`;
          }
          return readSkillBody(skill);
        },
      }, { permission: 'read' });
    },
  };
}
