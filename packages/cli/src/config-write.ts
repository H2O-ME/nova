/**
 * Surgical persistence for the config fields a running surface may change: the
 * model seat (`provider.model`), one plugin ROW (`plugins.entries`), one skill
 * (`skills.disable`).
 *
 * WHAT to change lives here; HOW a change is made safely (raw-document
 * read-modify-write, atomic replace, abort-on-unparseable) lives in
 * `config-doc.ts`. Every writer below goes through that one patcher, so the
 * "never leak a secret reference" property has a single test target.
 *
 * ## One row, one writer
 *
 * A plugin row is addressed by its ID and patched field-by-field, so this file
 * needs to know nothing about any plugin: the panel says "row X is off" or "row
 * X's config is this object", and the shape inside `config` belongs to the
 * plugin whose schema validates it. That is what lets a third-party plugin keep
 * settings without a host change — the previous design had a named writer per
 * first-party plugin (`saveQqBotConfig`), which is exactly the "adding a plugin
 * means editing the host" defect.
 *
 * One invariant is local to this file: strings the operator typed into a text
 * field are stored VERBATIM — even an `{env:NAME}`-shaped value — because the
 * LOAD path expands references. Writing such a string wants `clientSecret` to
 * mean "read this variable", not to embed a literal.
 */
import { docFile, ensureList, patchConfig, plainMember, readDoc, sortedUnique } from './config-doc.js';

/** One plugin row as the durable document stores it. */
interface StoredEntry {
  id: string;
  enabled?: boolean;
  config?: unknown;
}

/**
 * Rewrite `provider.model` atomically, preserving every other field and
 * reference. Throws when the document cannot be read or parsed — a config the
 * process cannot understand is one it must not silently overwrite.
 *
 * @param model - The model id to remember (the endpoint's own id, not a label).
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function saveModelChoice(model: string, homedir?: string): Promise<void> {
  const file = docFile(homedir);
  // The throw happens INSIDE the patch: `patchConfig` writes only after the
  // callback returns, so a config with no provider is rejected and left byte-for
  // -byte alone rather than being rewritten (and reformatted) by a failed save.
  await patchConfig((doc) => {
    const provider = plainMember(doc, 'provider');
    if (provider === undefined) throw new Error(`${file}: config has no provider object to record the model in`);
    provider.model = model;
  }, homedir);
}

/**
 * Upsert one plugin ROW: its `enabled` switch and/or its own `config` object.
 *
 * A field left absent is left AS STORED, so the two writers (the switch and a
 * plugin's own settings page) never blank each other's work. A row whose only
 * content would be the default is dropped entirely rather than persisted as
 * noise: "no entry" and "an entry with nothing to say" mean the same thing, and
 * the first keeps a hand-written file readable.
 *
 * `config` is merged ONE KEY AT A TIME. A settings form submits the fields it
 * owns; everything else in the row survives — which is what keeps a
 * `{env:NAME}` reference the operator wrote from being replaced by the expanded
 * secret the plugin was applied with (the form left that field alone, so the raw
 * text stays). A key whose value is `null` is REMOVED: that is how a form clears
 * an optional field, since omitting it means "leave it".
 *
 * @param id - the row's id (a built-in's name or a module specifier).
 * @param patch - the fields to write; an absent field is left as stored.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function setPluginEntry(
  id: string,
  patch: { enabled?: boolean; config?: unknown },
  homedir?: string,
): Promise<void> {
  await patchConfig((doc) => {
    const owner = plainMember(doc, 'plugins') ?? (() => {
      const created: Record<string, unknown> = {};
      doc['plugins'] = created;
      return created;
    })();
    const entries = ensureEntries(owner);
    let row = entries.find((candidate) => candidate.id === id);
    if (row === undefined) {
      row = { id };
      entries.push(row);
    }
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.config !== undefined) row.config = mergeConfig(row.config, patch.config);
    // An entry that only restates the default is not worth keeping: the row's
    // absence already means "as the plugin ships". Deleting it here is what
    // keeps a panel toggle from growing the file forever.
    if (row.enabled === undefined && row.config === undefined) {
      const index = entries.indexOf(row);
      entries.splice(index, 1);
    }
    if (entries.length === 0) delete owner['entries'];
    else owner['entries'] = entries;
  }, homedir);
}

/**
 * One row's config, merged key by key.
 *
 * A patch that is not a plain object REPLACES (the plugin is setting a scalar or
 * a list, and there is nothing to merge it into). `null` removes one key;
 * `undefined` means "leave it" and is what an omitted form field reads as.
 * @param stored - what the document holds now.
 * @param patch - what the writer submitted.
 * @returns the merged value, or undefined when nothing is left.
 */
function mergeConfig(stored: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const base =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * One row's config AS WRITTEN in the document.
 *
 * The load path expands `{env:NAME}` references, so a plugin applied with its
 * resolved config cannot tell a literal secret from a reference to one. A page
 * that echoes the reference NAME rather than the secret, and a save that must not
 * destroy it, both need this raw form.
 * @param id - the row's id.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the stored config, or undefined when the row (or its config) is absent.
 */
export async function readPluginEntryConfig(id: string, homedir?: string): Promise<unknown> {
  const doc = await readDoc(docFile(homedir)).catch(() => undefined);
  const entries = plainMember(doc, 'plugins')?.['entries'];
  if (!Array.isArray(entries)) return undefined;
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (candidate['id'] === id) return candidate['config'];
  }
  return undefined;
}

/**
 * Remove one plugin row outright (its switch AND its settings).
 *
 * Used by `nova plugin remove`: the module it named is going away, so a row
 * pointing at it would make the next boot report a package that is not there.
 * @param id - the row's id.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function removePluginEntry(id: string, homedir?: string): Promise<void> {
  await patchConfig((doc) => {
    const owner = plainMember(doc, 'plugins');
    if (owner === undefined) return;
    const entries = ensureEntries(owner).filter((candidate) => candidate.id !== id);
    if (entries.length === 0) delete owner['entries'];
    else owner['entries'] = entries;
  }, homedir);
}

/**
 * Set the enabled state of one skill (`skills.disable`, by name, both levels).
 * A missing `skills` object is created.
 * @param name - the skill's name.
 * @param enabled - whether it should be injected and callable.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the disable list now in force.
 */
export async function setSkillEnabled(name: string, enabled: boolean, homedir?: string): Promise<readonly string[]> {
  let result: readonly string[] = [];
  await patchConfig((doc) => {
    const owner = plainMember(doc, 'skills') ?? (() => {
      const created: Record<string, unknown> = {};
      doc['skills'] = created;
      return created;
    })();
    const disable = ensureList(owner, 'disable');
    const next = enabled ? sortedUnique(disable.filter((entry) => entry !== name)) : sortedUnique([...disable, name]);
    owner['disable'] = next;
    result = next;
  }, homedir);
  return result;
}

/**
 * The `plugins.entries` array, normalized in place.
 *
 * A hand-edited non-array is replaced rather than trusted, and rows that are not
 * objects or carry no string id are dropped: this is the only place a row is
 * born, so it must not carry a malformed one forward.
 * @param owner - the `plugins` object.
 * @returns the live array to mutate.
 */
function ensureEntries(owner: Record<string, unknown>): StoredEntry[] {
  const current = owner['entries'];
  const rows: StoredEntry[] = [];
  if (Array.isArray(current)) {
    for (const raw of current) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) continue;
      const row: StoredEntry = { id: candidate['id'] };
      if (typeof candidate['enabled'] === 'boolean') row.enabled = candidate['enabled'];
      if (candidate['config'] !== undefined) row.config = candidate['config'];
      rows.push(row);
    }
  }
  owner['entries'] = rows;
  return rows;
}
