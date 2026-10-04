/**
 * Raw-document plumbing for the config file a running surface may rewrite.
 *
 * Split from `config-write.ts` (what to CHANGE) because this is HOW a change is
 * made safely, and every writer there depends on the same three guarantees:
 *
 *  - **read-modify-write over the RAW text, never the loaded `Config`.** Loading
 *    runs every string through `expandDeep`, so a `{env:MY_KEY}` reference comes
 *    back as the secret itself; writing the parsed object out again would replace
 *    a reference with plaintext. Patching the document keeps every other byte,
 *    references included, exactly as written.
 *  - **atomic replace** (same-dir tmp + rename): a crash leaves the previous
 *    config in place rather than a truncated one.
 *  - **abort on anything unparseable.** A config the process cannot understand is
 *    one it must not silently overwrite, so every reader throws instead.
 *
 * The document is pretty-printed on write. That normalizes a hand-edited layout,
 * which is acceptable because the reader is a parser, not a diff viewer.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userConfigPath } from '@nova-agent/core';

/** Rewrite one config file atomically (same-dir tmp + rename). */
async function writeDoc(file: string, doc: unknown): Promise<void> {
  // The DIRECTORY is created first: a first run has neither the file nor
  // `~/.nova/`, and the tmp+rename below would fail with ENOENT on a directory
  // that does not exist — so the operator's first save could never land.
  await mkdir(path.dirname(file), { recursive: true });
  // Same directory, so the rename is atomic on one filesystem: a crash leaves
  // the previous config in place rather than a truncated one.
  const tmp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * The named plain-object member of a plain object, or undefined for anything
 * else. Every nested write goes through this: a config holding `"provider": []`
 * must read as "no provider object" rather than have an array used as a map.
 * @param root - the parsed document.
 * @param key - the member to read.
 * @returns the member when it is a plain object, else undefined.
 */
export function plainMember(root: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return undefined;
  const value = (root as Record<string, unknown>)[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The config file for a home directory (the real one by default). */
export function docFile(homedir?: string): string {
  return homedir === undefined ? userConfigPath() : userConfigPath(homedir);
}

/**
 * Read + parse the config document. Throws on unreadable or invalid text.
 * @param file - absolute path of the config file.
 * @returns the parsed document (any JSON shape; callers narrow it).
 */
export async function readDoc(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`missing config: ${file}`);
    }
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${file}: refusing to rewrite`);
  }
}

/**
 * Apply `patch` to the raw document and write it back. The patcher receives the
 * parsed root and mutates it in place; non-object roots are rejected before it
 * runs.
 *
 * **A missing file is an EMPTY document, not an error.** A first run has no
 * `config.json` at all — that is the product's starting state, not a fault — and
 * the settings page is precisely where the operator creates one. Refusing here
 * made the first provider unsaveable: the page showed its form, the save threw
 * `missing config`, and there was no other way to author the file. A file that
 * EXISTS but holds invalid JSON still throws (`readDoc`): that one is a real
 * problem and silently replacing it would destroy the operator's text.
 * @param patch - in-place mutation of the parsed root.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the file path written.
 */
export async function patchConfig(
  patch: (doc: Record<string, unknown>) => void,
  homedir?: string,
): Promise<string> {
  const file = docFile(homedir);
  const doc: unknown = await readDoc(file).catch((err: unknown) => {
    const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT' || (err instanceof Error && err.message.startsWith('missing config'))) return {};
    throw err;
  });
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`${file}: config root must be a JSON object`);
  }
  patch(doc as Record<string, unknown>);
  await writeDoc(file, doc);
  return file;
}

/** Sorted, de-duplicated string list (a disable list's canonical form). */
export function sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

/**
 * The named string-list member, created (and normalized) in place. A non-array
 * value is replaced by an empty list rather than trusted: this is the only
 * place a `skills.disable` entry is born, so it must not carry a hand-edited
 * non-list forward.
 * @param obj - the object owning the list.
 * @param key - the list's key.
 * @returns the live array to mutate.
 */
export function ensureList(obj: Record<string, unknown>, key: string): string[] {
  const current = obj[key];
  const list = Array.isArray(current) ? current.filter((v): v is string => typeof v === 'string') : [];
  obj[key] = list;
  return list;
}
