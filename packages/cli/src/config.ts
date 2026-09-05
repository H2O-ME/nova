import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const NOVA_DIR = '.nova';

const configSchema = z.object({
  provider: z.object({
    baseURL: z.string().min(1),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    /** Sampling temperature passed through to the provider. */
    temperature: z.number().min(0).max(2).optional(),
    /** Passed through as `max_tokens` when set. */
    maxTokens: z.number().int().positive().max(1_000_000).optional(),
  }),
  systemPrompt: z.string().optional(),
  maxTurns: z.number().int().positive().max(500).optional(),
  approval: z.enum(['read-only', 'auto-edit', 'full']).optional(),
  /**
   * 系统通知开关（审批请求 / 长任务完成 / 出错时弹 Windows toast 等系统
   * 通知）。默认开启；设为 false 或环境变量 NOVA_NO_NOTIFY=1 关闭。
   */
  notify: z.boolean().optional(),
  /**
   * Auto-compact threshold in prompt tokens (measured on the latest turn).
   * When exceeded, the session is summarized and restarted automatically
   * (codex-style model_auto_compact_token_limit). Unset disables it.
   */
  autoCompactTokenLimit: z.number().int().positive().max(2_000_000).optional(),
  tools: z
    .object({
      bash: z
        .object({
          enabled: z.boolean().optional(),
          timeoutMs: z.number().int().positive().optional(),
          shellPath: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;

export function configPath(rootDir: string): string {
  return path.join(rootDir, NOVA_DIR, 'config.json');
}

/** 用户级兜底配置：工作区没有 .nova/config.json 时使用（配一次，所有项目通用）。 */
export function userConfigPath(homedir: string = os.homedir()): string {
  return path.join(homedir, NOVA_DIR, 'config.json');
}

/**
 * Walks up from startDir looking for .nova/config.json; the directory that
 * contains it is the workspace root (all agent data lives in <root>/.nova/).
 * Returns startDir unchanged when nothing is found, so loadConfig can emit a
 * precise error pointing at the expected location.
 *
 * The user-level config at ~/.nova/config.json is a loadConfig fallback only,
 * NEVER a workspace boundary: the upward walk stops at the home directory
 * (on Windows %TEMP% lives under the profile — without this, running nova in
 * a temp dir would silently adopt home as the workspace root and coalesce
 * all sessions there).
 */
export async function findRootDir(startDir: string, homedir: string = os.homedir()): Promise<string> {
  const start = path.resolve(startDir);
  const home = path.resolve(homedir);
  let dir = start;
  for (let depth = 0; depth < 32; depth++) {
    // Stop the walk at the home directory — the user-level config zone above
    // it is not workspace material, so nothing up there may match.
    if (dir === home) return start;
    try {
      await access(configPath(dir));
      return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
  return start;
}

/** Expands `{env:NAME}` references; unset variables expand to an empty string. */
export function expandRefs(value: string): string {
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return process.env[name] ?? '';
  });
}

function expandDeep(value: unknown): unknown {
  if (typeof value === 'string') return expandRefs(value);
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = expandDeep(val);
    return out;
  }
  return value;
}

/**
 * Loads .nova/config.json from the working directory root. All agent data —
 * config, sessions, cache, logs — lives under <rootDir>/.nova/; nothing is
 * written to the user's home directory or the system drive.
 */
export async function loadConfig(rootDir: string, homedir: string = os.homedir()): Promise<Config> {
  const file = configPath(rootDir);
  let raw: string;
  let source = file;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) throw err;
    // Workspace config missing → user-level fallback, so configuring the
    // provider once in ~/.nova/config.json makes nova runnable in ANY
    // directory (per-project data still lives in that project's .nova/).
    source = userConfigPath(homedir);
    try {
      raw = await readFile(source, 'utf8');
    } catch (userErr) {
      if (userErr instanceof Error && 'code' in userErr && (userErr as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `missing config: ${file}\ncreate .nova/config.json in the workspace, or ~/.nova/config.json once for all projects, e.g.\n{\n  "provider": {\n    "baseURL": "https://api.example.com/v1",\n    "apiKey": "{env:MY_API_KEY}",\n    "model": "model-name"\n  }\n}`,
        );
      }
      throw userErr;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const expanded = expandDeep(parsed);
  const result = configSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid config ${source}:\n${issues}`);
  }
  return result.data;
}
