/**
 * Surgical persistence for the config fields a running surface may change:
 * the model seat (`provider.model`) and the settings panel's management seats
 * (`plugins.disable`, `skills.disable`, `qqbot`).
 *
 * WHAT to change lives here; HOW a change is made safely (raw-document
 * read-modify-write, atomic replace, abort-on-unparseable) lives in
 * `config-doc.ts`. Every writer below goes through that one patcher, so the
 * "never leak a secret reference" property has a single test target.
 *
 * One invariant is local to this file: strings the operator typed into a text
 * field are stored VERBATIM — even an `{env:NAME}`-shaped value — because the
 * LOAD path expands references. Writing such a string wants
 * `qqbot.clientSecret` to mean "read this variable", not to embed a literal.
 */
import { docFile, ensureList, patchConfig, plainMember, sortedUnique } from './config-doc.js';

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
 * Set the enabled state of one plugin (`plugins.disable`). Enabling removes the
 * name; disabling adds it. The list is kept sorted and de-duplicated so the file
 * stays readable after repeated panel toggles. A missing `plugins` object is
 * created; an existing `extra` array is never touched.
 * @param name - the plugin's roster name.
 * @param enabled - whether it should load.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the disable list now in force.
 */
export async function setPluginEnabled(name: string, enabled: boolean, homedir?: string): Promise<readonly string[]> {
  return flipSwitch('plugins', name, enabled, homedir);
}

/**
 * Set the enabled state of one skill (`skills.disable`, by name, both levels).
 * Same list discipline as `setPluginEnabled`; a missing `skills` object is
 * created.
 * @param name - the skill's name.
 * @param enabled - whether it should be injected and callable.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the disable list now in force.
 */
export async function setSkillEnabled(name: string, enabled: boolean, homedir?: string): Promise<readonly string[]> {
  return flipSwitch('skills', name, enabled, homedir);
}

/**
 * Replace the whole `plugins.enable` list — the OPT-IN half of the plugin
 * roster.
 *
 * Why a separate list rather than reusing `disable`: the two express opposite
 * defaults. `disable` means "this ships on; leave it out" (the `standard` tier).
 * `enable` means "this ships OFF; turn it on" (the `advanced` tier, e.g.
 * `subagent`). Writing an advanced name into `disable` would be a one-way door,
 * because `disable` WINS over `enable` when the roster decides — so a plugin
 * switched off that way could never be switched back on by any later click.
 *
 * An EMPTY list DELETES the key rather than storing `[]`: "no advanced plugin
 * opted in" is the absence of the list, the same discipline the provider list
 * follows, and it keeps a first-run file free of noise the operator never wrote.
 *
 * @param names - the names that should be ON against their tier default.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the enable list now in force (empty when the key was removed).
 */
export async function setPluginsEnabled(names: readonly string[], homedir?: string): Promise<readonly string[]> {
  const next = sortedUnique(names);
  await patchConfig((doc) => {
    const owner = plainMember(doc, 'plugins') ?? (() => {
      const created: Record<string, unknown> = {};
      doc['plugins'] = created;
      return created;
    })();
    if (next.length === 0) delete owner['enable'];
    else owner['enable'] = next;
  }, homedir);
  return next;
}

/** The shared body of the two switches: one list, one discipline. */
async function flipSwitch(
  section: 'plugins' | 'skills',
  name: string,
  enabled: boolean,
  homedir?: string,
): Promise<readonly string[]> {
  let result: readonly string[] = [];
  await patchConfig((doc) => {
    const owner = plainMember(doc, section) ?? (() => {
      const created: Record<string, unknown> = {};
      doc[section] = created;
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
 * Replace the `qqbot` connection block. `clientSecret` is stored verbatim —
 * including an `{env:NAME}`-shaped value, which the load path expands to the real
 * secret (the panel's field says exactly this). An absent block is created;
 * passing `undefined` for a field leaves the stored value alone so a "test only"
 * round-trip does not blank credentials the operator kept.
 * @param opts - the fields to write; an absent field is left as stored.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function saveQqBotConfig(
  opts: { appId?: string; clientSecret?: string },
  homedir?: string,
): Promise<void> {
  await patchConfig((doc) => {
    const qqbot = plainMember(doc, 'qqbot') ?? (() => {
      const created: Record<string, unknown> = {};
      doc['qqbot'] = created;
      return created;
    })();
    if (opts.appId !== undefined) qqbot['appId'] = opts.appId;
    if (opts.clientSecret !== undefined) qqbot['clientSecret'] = opts.clientSecret;
  }, homedir);
}
