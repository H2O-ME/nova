/**
 * Every number that bounds the wire: frame size, field lengths, page sizes.
 *
 * Separated from the frame SHAPES (`protocol.ts`) because that is a different
 * kind of fact. A shape says what a message is; a limit says how much of it this
 * surface will carry, and each one below was chosen against a specific failure —
 * a prompt that is a pasted stack trace but not a tool dump, a completion list
 * that must not put 40k rows on the socket, a `have` cursor that is a guard
 * rather than a real limit.
 *
 * They are also the only part of the contract the inbound validator reads by
 * VALUE (to enforce) while the shapes it reads by TYPE, so keeping them together
 * gives `client-frame.ts` one import instead of thirteen loose numbers.
 */

/** Max bytes of one inbound text frame (prompt bodies are user-typed, not tool dumps). */
export const MAX_CLIENT_FRAME_BYTES = 512 * 1024;
/** Max chars of a prompt — generous for pasted stack traces, far below frame size. */
export const MAX_PROMPT_CHARS = 200_000;
/** Max chars of a model id (an endpoint's own id; no id is anywhere near this). */
export const MAX_MODEL_CHARS = 200;
/** Max chars of a slash-command name (kernel commands are short ASCII words). */
export const MAX_COMMAND_NAME_CHARS = 64;
/** Max chars of a workspace directory path (a host path, not a document). */
export const MAX_WORKSPACE_CHARS = 4096;
/** Max chars of a command's argument line (a skill name, a path — not a document). */
export const MAX_COMMAND_ARGS_CHARS = 2000;
/**
 * Blocks the replay baseline keeps out of one `ready` frame, and the size of
 * each older batch. A session's history is unbounded; the attach payload is not.
 */
export const HISTORY_TAIL = 40;
/**
 * Rows one trace page carries. The trace's unit is an event, not a rendered
 * block, so a long session has several times more rows than blocks — the page is
 * smaller for the same reason the payload must stay bounded.
 */
export const TRACE_TAIL = 30;
/** Upper bound for the client's `have` cursor (a guard, not a real limit). */
export const MAX_HISTORY_BLOCKS = 1_000_000;
/** Max chars of an `@` query (a path fragment, not a document). */
export const MAX_FILE_QUERY_CHARS = 512;
/**
 * Entries one `files` answer carries. The `@` menu is a completion list, so a
 * workspace with 40k files must not put 40k rows on the wire: the walk stops at
 * this many and the frame says it was truncated.
 */
export const MAX_FILE_MATCHES = 200;
/**
 * Max chars of a credential-shaped text field (qqbot appId/secret). Generous
 * for a pasted key, far below the frame budget — a pasted document must not
 * become a DoS vector.
 */
export const MAX_TEXT_FIELD_CHARS = 2000;
/**
 * Rows the operator's model list may carry. The list is hand-maintained (a
 * gateway's menu, not a crawl), so this is far above any real catalog while
 * still bounding what one `save_models` frame can make the host write: without
 * it, the only limit would be the 512 KiB frame size, and a config file is not
 * a place to discover a payload was too large.
 */
export const MAX_CONFIGURED_MODELS = 500;
/**
 * Chars of one modality keyword (`text` / `image` / …). Modalities are a closed
 * little vocabulary, not prose — a long string here is a malformed frame, not a
 * capability.
 */
export const MAX_MODALITY_CHARS = 64;
/** Modality keywords per direction (input/output) on one configured model. */
export const MAX_MODEL_MODALITIES = 16;

/**
 * Display-name budget for one uploaded image.
 *
 * Bounded because it is echoed into a prompt placeholder when the model in
 * force cannot see images — an unbounded name would let a client push
 * arbitrary length into every later request of that session.
 */
export const MAX_IMAGE_NAME_CHARS = 200;

/** Images per prompt, bounded so one turn cannot queue an unbounded payload. */
export const MAX_PROMPT_IMAGES = 8;

/**
 * Max chars of one command submitted from the right panel's terminal.
 *
 * The terminal is a shell, not a document channel, but a real command line can
 * be long: a heredoc, a chained `&&` build, a `git log --format` with a big
 * template. This is the same order as a workspace path (4 KiB) and far below the
 * frame budget, so a pasted file cannot be smuggled in as a "command".
 */
export const MAX_TERMINAL_COMMAND_CHARS = 4096;
