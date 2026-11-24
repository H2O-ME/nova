/**
 * Loading a PLUGIN PACK: a directory that carries its own manifest and
 * contributes skills, commands and lifecycle hooks instead of (or as well as)
 * a JS module.
 *
 * This is the ZCode plugin shape, adopted verbatim so a pack written for ZCode
 * runs here without a fork:
 *
 * ```
 * <pack>/
 *   .zcode-plugin/plugin.json      ← manifest (also .claude-plugin/, .nova-plugin/)
 *   skills/<name>/SKILL.md         ← or `manifest.skills` pointing elsewhere
 *   commands/<name>.md             ← slash commands, `manifest.commands` can map names
 *   hooks/hooks.json               ← lifecycle hooks, `manifest.hooks` can point elsewhere
 * ```
 *
 * A pack is not a plugin ROW of its own: its contributions are hoisted into the
 * rows the host already understands — one hook-bridge source, one skill root,
 * one command registration each. That keeps the container's model (a row is a
 * `Plugin` with a fiber) unchanged, which is the whole point: a pack must not
 * introduce a second kind of loadable thing that every consumer then has to
 * know about.
 *
 * ## Trust posture
 *
 * A pack declares the commands its hooks run. Paths are resolved INSIDE the
 * pack root only (`resolveInside`), so a pack cannot name `../../etc/passwd` as
 * a skill file, and a pack is only loaded from a configured directory
 * (`plugins.dirs`) or an installed pack root — never discovered implicitly from
 * the workspace, which would let a cloned repo run code on open.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  validateHookEvents,
  type CommandDefinition,
  type HookEventsConfig,
  type Validated,
} from '@nova-agent/core';
import { parseSkillFrontmatter } from './skill-frontmatter.js';

/** Where pack manifests are looked for, in precedence order. */
export const PACK_MANIFEST_DIRS = ['.nova-plugin', '.zcode-plugin', '.claude-plugin'] as const;

export const PACK_MANIFEST_FILE = 'plugin.json';

/** The manifest fields a pack may carry (unknown keys are ignored: forward compatibility). */
export interface PackManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Record<string, string>>;
  readonly author?: { readonly name?: string } | string;
  readonly license?: string;
  /** Where skills live, relative to the pack root. Absent means `skills/`. */
  readonly skills?: string;
  /** Where commands live, relative to the pack root. Absent means `commands/`. */
  readonly commands?: string | Readonly<Record<string, { readonly description?: string; readonly source?: string; readonly content?: string }>>;
  /** Where hooks live: a relative path, or inline events. Absent means `hooks/hooks.json`. */
  readonly hooks?: string | readonly string[] | { readonly events?: unknown };
  /** Declared user settings, exposed to hooks as `${NAME}` variables. */
  readonly userConfig?: Readonly<Record<string, { readonly default?: string | number | boolean; readonly sensitive?: boolean }>>;
}

/** One skill a pack contributes. */
export interface PackSkill {
  readonly name: string;
  readonly description: string;
  readonly file: string;
}

/** One command a pack contributes. */
export interface PackCommand {
  readonly name: string;
  readonly description: string;
  readonly file: string;
}

/** A fully loaded pack. */
export interface LoadedPack {
  readonly root: string;
  readonly manifest: PackManifest;
  readonly skills: readonly PackSkill[];
  readonly commands: readonly PackCommand[];
  readonly hooks: HookEventsConfig;
  /** `userConfig` values expanded to strings, for `${NAME}` substitution. */
  readonly vars: Readonly<Record<string, string>>;
  /** Non-fatal problems (a malformed hook file, a missing directory). */
  readonly diagnostics: readonly string[];
}

/** How a pack directory is found and read. */
export interface PackLoadOptions {
  /** Overrides `userConfig` values (the operator's saved settings for this pack). */
  readonly userConfig?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Resolve the manifest of one candidate directory, or undefined when it is not
 * a pack. A directory WITHOUT any manifest is not a pack — silently treating
 * "any directory with a skills folder" as a pack would make a stray folder in
 * the workspace a code-execution vector.
 */
export async function readPackManifest(dir: string): Promise<Validated<PackManifest> | undefined> {
  for (const candidate of PACK_MANIFEST_DIRS) {
    const file = path.join(dir, candidate, PACK_MANIFEST_FILE);
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      return { ok: false, error: `${file}: 不是合法 JSON（${err instanceof Error ? err.message : String(err)}）` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${file}: manifest 必须是对象` };
    }
    const record = parsed as Record<string, unknown>;
    const name = typeof record['name'] === 'string' && record['name'].length > 0 ? record['name'] : undefined;
    if (name === undefined) return { ok: false, error: `${file}: 缺少 name` };
    return { ok: true, value: normalizeManifest(record as Partial<PackManifest> & { name: string }) };
  }
  return undefined;
}

/** Pick the documented fields; unknown keys stay out of the typed view. */
function normalizeManifest(raw: Partial<PackManifest> & { name: string }): PackManifest {
  return {
    name: raw.name,
    ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(raw.descriptionI18n !== undefined ? { descriptionI18n: raw.descriptionI18n } : {}),
    ...(raw.author !== undefined ? { author: raw.author } : {}),
    ...(typeof raw.license === 'string' ? { license: raw.license } : {}),
    ...(raw.skills !== undefined ? { skills: raw.skills } : {}),
    ...(raw.commands !== undefined ? { commands: raw.commands } : {}),
    ...(raw.hooks !== undefined ? { hooks: raw.hooks } : {}),
    ...(raw.userConfig !== undefined ? { userConfig: raw.userConfig } : {}),
  };
}

/**
 * Resolve a manifest-declared path to an absolute one INSIDE the pack.
 * `undefined` when it escapes the root: a declaration is data from a third
 * party, and "read whatever file it names" is not a trust boundary worth
 * inventing.
 */
export function resolveInside(root: string, relative: string): string | undefined {
  const resolved = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root);
  const withSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  if (resolved !== normalizedRoot && !resolved.startsWith(withSep)) return undefined;
  return resolved;
}

/** Load one pack: manifest, skills, commands, hooks and the effective variables. */
export async function loadPack(dir: string, options: PackLoadOptions = {}): Promise<Validated<LoadedPack>> {
  const manifest = await readPackManifest(dir);
  if (manifest === undefined) return { ok: false, error: `${dir}: 不是插件包（缺少 ${PACK_MANIFEST_DIRS.map((d) => `${d}/${PACK_MANIFEST_FILE}`).join(' / ')}）` };
  if (!manifest.ok) return manifest;
  const normalizedRoot = await realpath(dir).catch(() => path.resolve(dir));
  const diagnostics: string[] = [];
  const skills = await loadPackSkills(normalizedRoot, manifest.value, diagnostics);
  const commands = await loadPackCommands(normalizedRoot, manifest.value, diagnostics);
  const hooks = await loadPackHooks(normalizedRoot, manifest.value, diagnostics);
  return {
    ok: true,
    value: {
      root: normalizedRoot,
      manifest: manifest.value,
      skills,
      commands,
      hooks,
      vars: packVars(manifest.value, options.userConfig),
      diagnostics,
    },
  };
}

/** `userConfig` defaults overridden by the operator's saved values, all stringified. */
function packVars(
  manifest: PackManifest,
  overrides: Readonly<Record<string, string | number | boolean>> = {},
): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {};
  for (const [key, spec] of Object.entries(manifest.userConfig ?? {})) {
    const value = overrides[key] ?? spec.default;
    if (value !== undefined) vars[key] = String(value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    vars[key] = String(value);
  }
  return vars;
}

/**
 * Skills: `manifest.skills` names ONE directory (the ZCode declaration is an
 * explicit entry list, and a declared directory replaces the default scan —
 * otherwise a pack could not opt out of a stray `skills/` folder).
 */
async function loadPackSkills(root: string, manifest: PackManifest, diagnostics: string[]): Promise<PackSkill[]> {
  const declared = typeof manifest.skills === 'string' ? resolveInside(root, manifest.skills) : path.join(root, 'skills');
  if (declared === undefined) {
    diagnostics.push(`skills 路径越出插件包根，已忽略：${String(manifest.skills)}`);
    return [];
  }
  const entries = await readdir(declared, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return [];
  const out: PackSkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const locator =
      entry.isDirectory()
        ? { file: path.join(declared, entry.name, 'SKILL.md'), fallback: entry.name }
        : entry.isFile() && entry.name.endsWith('.md')
          ? { file: path.join(declared, entry.name), fallback: entry.name.slice(0, -3) }
          : undefined;
    if (locator === undefined || !existsSync(locator.file)) continue;
    const raw = await readFile(locator.file, 'utf8').catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = parseSkillFrontmatter(raw);
    const name = parsed.name ?? locator.fallback;
    if (name.length === 0) continue;
    out.push({ name, description: parsed.description ?? '', file: locator.file });
  }
  return out;
}

/**
 * Commands: a directory of `<name>.md` files, or the manifest's name→content
 * mapping (ZCode materializes those into generated files; here the content is
 * held in memory and never written, so a pack stays read-only).
 */
async function loadPackCommands(root: string, manifest: PackManifest, diagnostics: string[]): Promise<PackCommand[]> {
  const out: PackCommand[] = [];
  if (typeof manifest.commands === 'object' && manifest.commands !== null) {
    for (const [name, spec] of Object.entries(manifest.commands)) {
      const file = spec.source !== undefined ? resolveInside(root, spec.source) : undefined;
      if (spec.source !== undefined && file === undefined) {
        diagnostics.push(`command "${name}" 的 source 越出插件包根，已忽略`);
        continue;
      }
      out.push({
        name,
        description: spec.description ?? '',
        file: file ?? `pack:${manifest.name}/${name}`,
      });
    }
    return out;
  }
  const declared = typeof manifest.commands === 'string' ? resolveInside(root, manifest.commands) : path.join(root, 'commands');
  if (declared === undefined) {
    diagnostics.push(`commands 路径越出插件包根，已忽略`);
    return out;
  }
  const entries = await readdir(declared, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return out;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    out.push({
      name: entry.name.slice(0, -3),
      description: '',
      file: path.join(declared, entry.name),
    });
  }
  return out;
}

/**
 * Hooks: `manifest.hooks` may be one path, a list of paths, or an inline
 * events object; absent means `hooks/hooks.json`. Every path is expanded
 * relative to the pack root and validated by the SAME table reader the
 * operator's config uses.
 */
async function loadPackHooks(root: string, manifest: PackManifest, diagnostics: string[]): Promise<HookEventsConfig> {
  const declared = manifest.hooks;
  if (declared !== undefined && typeof declared === 'object' && !Array.isArray(declared)) {
    const checked = validateHookEvents((declared as { events?: unknown }).events);
    if (!checked.ok) {
      diagnostics.push(`inline hooks 无效：${checked.error}`);
      return {};
    }
    return checked.value;
  }
  const paths =
    declared === undefined
      ? [path.join(root, 'hooks', 'hooks.json')]
      : typeof declared === 'string'
        ? [resolveInside(root, declared)].filter((p): p is string => p !== undefined)
        : declared
            .map((entry) => resolveInside(root, entry))
            .filter((p): p is string => p !== undefined);
  const merged: Record<string, unknown[]> = {};
  for (const file of paths) {
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      diagnostics.push(`${file}: 不是合法 JSON（${err instanceof Error ? err.message : String(err)}）`);
      continue;
    }
    const events = typeof parsed === 'object' && parsed !== null && 'hooks' in parsed
      ? (parsed as { hooks: unknown }).hooks
      : parsed;
    const checked = validateHookEvents(events);
    if (!checked.ok) {
      diagnostics.push(`${file}: ${checked.error}`);
      continue;
    }
    for (const [event, groups] of Object.entries(checked.value)) {
      merged[event] = [...(merged[event] ?? []), ...(groups ?? [])];
    }
  }
  return merged as HookEventsConfig;
}

/**
 * Read a pack command's markdown body, expanding the placeholders a ZCode
 * command supports: `$ARGUMENTS` (the whole argument string), `$1`..`$9`
 * (positional), and `${*_PLUGIN_ROOT}` / `${*_SKILL_DIR}` references. A command
 * with no placeholders gets its arguments appended as a trailing block, which
 * is what makes `/foo bar` useful even for a prompt that never mentioned
 * arguments.
 */
export function expandPackCommand(
  template: string,
  args: string,
  vars: Readonly<Record<string, string>>,
): string {
  const words = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
  let usedPlaceholder = false;
  let text = template.replace(/\$ARGUMENTS\b/g, () => {
    usedPlaceholder = true;
    return args;
  });
  text = text.replace(/\$([1-9])\b/g, (_whole, digit: string) => {
    usedPlaceholder = true;
    return words[Number(digit) - 1] ?? '';
  });
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] as string) : whole,
  );
  if (!usedPlaceholder && args.trim().length > 0) {
    text = `${text}\n\nUser arguments: ${args.trim()}`;
  }
  return text;
}

/** A pack command as a `CommandDefinition` the registry can hold. */
export function packCommandDefinition(
  pack: LoadedPack,
  command: PackCommand,
  readBody: (file: string) => Promise<string>,
): CommandDefinition {
  return {
    name: command.name,
    description: command.description.length > 0 ? command.description : `来自插件包 ${pack.manifest.name} 的命令`,
    async run(args, ctx) {
      if (command.file.startsWith('pack:')) {
        const spec = pack.manifest.commands;
        const inline =
          typeof spec === 'object' && spec !== null ? spec[command.name] : undefined;
        const content = typeof inline?.content === 'string' ? inline.content : '';
        if (content.length === 0) {
          ctx.log(`插件包 ${pack.manifest.name} 的命令 "${command.name}" 没有内容`);
          return;
        }
        ctx.log(expandPackCommand(content, args, { ...pack.vars }));
        return;
      }
      const raw = await readBody(command.file).catch(() => undefined);
      if (raw === undefined) {
        ctx.log(`无法读取插件包命令文件：${command.file}`);
        return;
      }
      const parsed = parseSkillFrontmatter(raw);
      const body = parsed.body;
      ctx.log(expandPackCommand(body, args, { ...pack.vars }));
    },
  };
}

/** Directories under one root that look like packs (`<root>/<name>/`). */
export async function discoverPackDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return [];
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const info = await stat(dir).catch(() => undefined);
    if (info === undefined) continue;
    if ((await readPackManifest(dir)) === undefined) continue;
    out.push(dir);
  }
  return out;
}
