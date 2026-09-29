/**
 * Every number that bounds the BYOK provider frames.
 *
 * Split from `wire-limits.ts` because the provider family is a different kind of
 * payload: those frames carry a CREDENTIAL and an address that reaches `fetch`,
 * while the rest of the wire carries prompts, paths and model ids. A limit on an
 * API key is a security judgement about how much a single frame can make the host
 * write into a secrets file; a limit on a prompt is a DoS floor. Two different
 * questions, so two files.
 */

/**
 * Providers one `save_providers` frame may describe. Smaller than the model
 * budget by an order of magnitude on purpose: an operator has a handful of
 * endpoints, not a catalog of them, and each entry carries a credential.
 */
export const MAX_PROVIDERS = 32;

/**
 * Max chars of one provider `baseURL`. A URL, not a document: far longer than
 * any real gateway address while refusing a pasted payload. Checked on the wire
 * AND re-derived by `URL` on the host, because a value that reaches a `fetch`
 * must be a URL the host itself accepted.
 */
export const MAX_BASE_URL_CHARS = 2048;

/**
 * Max chars of one API key as typed into the settings page.
 *
 * Generous for a pasted JWT-style gateway token (some are 1-2 KB) while still
 * refusing a document. A key may also be an `{env:NAME}` reference, which is
 * shorter; the bound covers both.
 */
export const MAX_API_KEY_CHARS = 4096;

/**
 * Max chars of a provider's display name. It is a label the operator types
 * (`官方` / `中转站`), not an identifier — the stable `id` is what binds.
 */
export const MAX_PROVIDER_NAME_CHARS = 128;
