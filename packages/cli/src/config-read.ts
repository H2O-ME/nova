/**
 * Read-side answers about the plugin tree, taken from the RAW document rather
 * than from a loaded `Config`.
 *
 * Split from `config-write.ts` (which is about WHAT TO CHANGE) because these are
 * questions about what is on disk NOW, asked a different way and at a different
 * time: the load path runs `expandDeep`, so a loaded `Config` has already
 * replaced `{env:NAME}` with the secret and can no longer answer "which variable
 * does this row name?".
 *
 * Both the listing and the install/uninstall commands read through
 * `config-doc.ts`, the same raw-document plumbing every writer uses, so "never
 * write the expanded object back" and "never trust a parsed value over the file"
 * stay one rule.
 *
 * Nothing here knows any plugin: a row is `{ id, enabled?, config? }`, and what
 * lives inside `config` is the owning plugin's business. The QQ-specific readers
 * this file used to export (`readQqBotSecretRef`, `qqBotConfigProblem`) are gone
 * because a plugin reports its own misconfiguration through its own operations —
 * which is the whole point of the row being its own.
 */
import { docFile, plainMember, readDoc } from './config-doc.js';

/** One plugin row as stored on disk. */
export interface StoredPluginEntry {
  readonly id: string;
  readonly enabled?: boolean;
  readonly config?: unknown;
}

/**
 * The `plugins.entries` rows as stored, in file order.
 *
 * Read from the RAW document because the loaded `Config` is a boot-time snapshot
 * and this list is exactly what a running process's edit changes.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the rows; [] when the file, the `plugins` object or the list is absent.
 */
export async function readPluginEntries(homedir?: string): Promise<StoredPluginEntry[]> {
  const doc = await readDoc(docFile(homedir)).catch(() => undefined);
  const entries = plainMember(doc, 'plugins')?.['entries'];
  if (!Array.isArray(entries)) return [];
  const rows: StoredPluginEntry[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) continue;
    rows.push({
      id: candidate['id'],
      ...(typeof candidate['enabled'] === 'boolean' ? { enabled: candidate['enabled'] } : {}),
      ...(candidate['config'] !== undefined ? { config: candidate['config'] } : {}),
    });
  }
  return rows;
}

/**
 * The module specifiers this file REMEMBERS, in file order — what `nova plugin
 * list` prints and what `remove` checks before it touches anything.
 *
 * A row that names a built-in plugin is not a module the installer manages, so
 * it is filtered out here rather than by every caller.
 * @param builtins - the ids this build provides in-process.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the specifiers.
 */
export async function readPluginSpecs(builtins: readonly string[], homedir?: string): Promise<string[]> {
  const rows = await readPluginEntries(homedir);
  return rows.map((row) => row.id).filter((id) => !builtins.includes(id));
}
