/**
 * Read-side answers about the plugin-owned config blocks, taken from the RAW
 * document rather than from a loaded `Config`.
 *
 * Split from `config-write.ts` (which is about WHAT TO CHANGE) because these are
 * questions about what is on disk NOW, asked a different way and at a different
 * time: the load path runs `expandDeep`, so a loaded `Config` has already
 * replaced `{env:NAME}` with the secret and can no longer answer either of them.
 *
 *  - `readQqBotSecretRef` — which variable the stored secret names. The settings
 *    page shows the NAME, never the value, so this must survive expansion.
 *  - `qqBotConfigProblem` — whether the stored credentials are usable at all. A
 *    save changes the file under a running process, so the verdict has to be
 *    re-derived from disk instead of trusting the boot-time snapshot.
 *
 * Both read through `config-doc.ts`, the same raw-document plumbing every writer
 * uses, so "never write the expanded object back" and "never trust a parsed
 * value over the file" stay one rule.
 */
import { docFile, plainMember, readDoc } from './config-doc.js';
import { unresolvedRef } from './config-expand.js';

/** A value that is exactly one `{env:NAME}` reference, or undefined for anything else. */
const ENV_REF_RE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * The `plugins.extra` rows as stored, in file order — what `nova plugin` reads
 * to answer "is this configured", and what `remove` checks before it touches
 * anything.
 *
 * Read from the RAW document for the same reason as the qqbot readers: the
 * loaded `Config` is a boot-time snapshot, and this list is exactly what a
 * running process's edit changes.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the specs; [] when the file, the `plugins` object or the list is absent.
 */
export async function readExtraPlugins(homedir?: string): Promise<string[]> {
  const doc = await readDoc(docFile(homedir)).catch(() => undefined);
  const extra = plainMember(doc, 'plugins')?.['extra'];
  return Array.isArray(extra) ? extra.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * The environment variable a stored `qqbot.clientSecret` reads from, when it is
 * exactly one `{env:NAME}` reference; undefined when it is a literal — or when
 * there is no config file to read.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the variable name, or undefined.
 */
export async function readQqBotSecretRef(homedir?: string): Promise<string | undefined> {
  const doc = await readDoc(docFile(homedir));
  const qqbot = plainMember(doc, 'qqbot');
  const secret = qqbot?.['clientSecret'];
  if (typeof secret !== 'string') return undefined;
  return ENV_REF_RE.exec(secret)?.[1];
}

/** The qqbot fields a person types, in the order a form lists them. */
const QQ_BOT_FIELDS = ['appId', 'clientSecret'] as const;

/**
 * Why the STORED qqbot credentials cannot be used right now, or undefined when
 * they can. A stored `{env:NAME}` reference whose variable is unset is the case
 * this exists for: the load path leaves such a reference as written (see
 * `config-expand.ts`), so a consumer that tried to use it would send the literal
 * text as a credential and get an opaque auth failure back.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the sentence to show, or undefined when the credentials are usable.
 */
export async function qqBotConfigProblem(homedir?: string): Promise<string | undefined> {
  let doc: unknown;
  try {
    doc = await readDoc(docFile(homedir));
  } catch {
    // No readable file means nothing is configured, which the page already says
    // by showing its empty state — not a problem to report.
    return undefined;
  }
  const qqbot = plainMember(doc, 'qqbot');
  if (qqbot === undefined) return undefined;
  for (const field of QQ_BOT_FIELDS) {
    const value = qqbot[field];
    if (typeof value !== 'string') continue;
    const name = unresolvedRef(value);
    if (name !== undefined) {
      return `qqbot.${field} 引用了环境变量 {env:${name}}，但它未设置；请在 shell 里设置它，或把 qqbot.${field} 改成字面值`;
    }
  }
  return undefined;
}
