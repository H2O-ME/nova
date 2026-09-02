import { access, readFile } from 'node:fs/promises';
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
  maxTurns: z.number().int().positive().max(50).optional(),
  approval: z.enum(['read-only', 'auto-edit', 'full']).optional(),
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

/**
 * Walks up from startDir looking for .nova/config.json; the directory that
 * contains it is the workspace root (all agent data lives in <root>/.nova/).
 * Returns startDir unchanged when nothing is found, so loadConfig can emit a
 * precise error pointing at the expected location.
 */
export async function findRootDir(startDir: string): Promise<string> {
  const start = path.resolve(startDir);
  let dir = start;
  for (let depth = 0; depth < 32; depth++) {
    try {
      await access(configPath(dir));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return start;
      dir = parent;
    }
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
export async function loadConfig(rootDir: string): Promise<Config> {
  const file = configPath(rootDir);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `missing config: ${file} (searched upward from the working directory)\ncreate .nova/config.json, e.g.\n{\n  "provider": {\n    "baseURL": "https://api.example.com/v1",\n    "apiKey": "{env:MY_API_KEY}",\n    "model": "model-name"\n  }\n}`,
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const expanded = expandDeep(parsed);
  const result = configSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid config ${file}:\n${issues}`);
  }
  return result.data;
}
