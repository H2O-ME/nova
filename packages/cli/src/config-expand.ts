/**
 * `{env:NAME}` reference expansion for the loaded config document.
 *
 * Split from `config.ts` (which owns the schema and the loader) because the rule
 * here is about OWNERSHIP, not parsing: whether an unresolved reference is a
 * fatal load error or a diagnostic depends on which section it sits in, and that
 * is a different question from "is this config well-formed".
 *
 * The distinction the whole module exists for:
 *
 *  - **Core sections** are the ones the product itself reads. An unresolved
 *    reference there is not a diagnostic — it is a process about to behave as if
 *    the value were missing, so it fails loudly at load and names the variable.
 *  - **Plugin-owned sections** belong to a plugin that only SOME invocations
 *    start. `qqbot` is the third-party channel plugin: its credentials are needed
 *    by `nova qqbot` and by nothing else. Failing the load there meant an unset
 *    `{env:QQ_SECRET}` blocked the browser UI, the REPL and `exec` — surfaces
 *    that never read that value — which is a plugin taking the whole product
 *    down with it. Here the reference is LEFT AS WRITTEN and recorded, so the
 *    owning surface fails at the point it actually needs the value and every
 *    other surface can show the problem as a diagnostic.
 *
 * The list is an ALLOWLIST of plugin-owned sections rather than a deny-list of
 * load-bearing ones: a section added later is core by default, so it keeps the
 * loud failure unless someone deliberately hands it to a plugin.
 *
 * Leaving the literal is deliberate over substituting an empty string: the
 * empty-string fallback was the documented footgun (an empty credential reached
 * the network and came back as a bare 401 with no clue why). A literal that a
 * consumer might try to use is self-describing, and the owning surface refuses
 * it before any request goes out.
 */

/** A `{env:NAME}` reference that did not resolve, and the section that owns it. */
export interface ConfigDiagnostic {
  /** The top-level config section the reference sits in. */
  readonly section: string;
  /** The variable name the reference asks for. */
  readonly variable: string;
}

/**
 * Sections owned by a PLUGIN rather than by the product: an unresolved
 * reference inside one is that plugin's problem, not a load failure.
 *
 * `qqbot` is the third-party channel plugin (§4: "第三方插件编写示范"). It is the
 * only such section today, and adding another means that plugin has accepted
 * responsibility for reporting its own misconfiguration.
 */
const PLUGIN_OWNED_SECTIONS: ReadonlySet<string> = new Set(['qqbot']);

const REF_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expands `{env:NAME}` references. Throws when a referenced variable is unset.
 * @param value - the string to expand.
 * @returns the string with every reference replaced by its value.
 */
export function expandRefs(value: string): string {
  return value.replace(REF_RE, (_match, name: string) => {
    const v = process.env[name];
    if (v === undefined || v.length === 0) {
      throw new Error(
        `config references environment variable {env:${name}} but it is not set (or empty); set it in your shell or use a literal value`,
      );
    }
    return v;
  });
}

/**
 * Expand every string in a value, THROWING on an unresolved reference.
 * @param value - the parsed subtree.
 * @returns the subtree with every reference expanded.
 */
function expandStrict(value: unknown): unknown {
  if (typeof value === 'string') return expandRefs(value);
  if (Array.isArray(value)) return value.map(expandStrict);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = expandStrict(val);
    return out;
  }
  return value;
}

/**
 * Expand every string in a value, KEEPING unresolved references as written and
 * collecting one diagnostic per (section, variable) pair.
 * @param value - the parsed subtree.
 * @param section - the top-level section name, for the diagnostics.
 * @param found - collects the unresolved references.
 * @returns the subtree with resolvable references expanded.
 */
function expandLenient(value: unknown, section: string, found: ConfigDiagnostic[]): unknown {
  if (typeof value === 'string') {
    return value.replace(REF_RE, (match: string, name: string) => {
      const v = process.env[name];
      if (v === undefined || v.length === 0) {
        // Once per variable: a section repeating one reference is one problem,
        // and repeating the sentence would read as several.
        if (!found.some((entry) => entry.section === section && entry.variable === name)) {
          found.push({ section, variable: name });
        }
        return match;
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((item) => expandLenient(item, section, found));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = expandLenient(val, section, found);
    return out;
  }
  return value;
}

/**
 * Expand a whole parsed config document, section by section.
 * @param parsed - the parsed JSON document.
 * @returns the expanded document, plus one diagnostic per unresolved plugin-owned reference.
 */
export function expandConfigDocument(parsed: unknown): {
  value: unknown;
  diagnostics: ConfigDiagnostic[];
} {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: parsed, diagnostics: [] };
  }
  const diagnostics: ConfigDiagnostic[] = [];
  const out: Record<string, unknown> = {};
  for (const [section, subtree] of Object.entries(parsed)) {
    out[section] = PLUGIN_OWNED_SECTIONS.has(section)
      ? expandLenient(subtree, section, diagnostics)
      : expandStrict(subtree);
  }
  return { value: out, diagnostics };
}

/**
 * Whether a value still holds an unresolved reference — the check a plugin-owned
 * surface runs before it uses its own credentials, so the failure names the
 * variable AND the file to edit.
 * @param value - the string a consumer is about to use.
 * @returns the unresolved variable name, or undefined when the value is usable.
 */
export function unresolvedRef(value: string): string | undefined {
  REF_RE.lastIndex = 0;
  const match = REF_RE.exec(value);
  return match?.[1];
}

/**
 * The sentence one diagnostic reads as, for a surface that shows it to a person.
 * @param diagnostic - the unresolved reference.
 * @returns the sentence.
 */
export function diagnosticText(diagnostic: ConfigDiagnostic): string {
  return `${diagnostic.section} 引用了环境变量 {env:${diagnostic.variable}}，但它未设置；该插件的功能暂不可用，其余功能不受影响`;
}
