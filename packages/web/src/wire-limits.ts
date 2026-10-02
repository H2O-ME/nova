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
 * Chars of one keystroke burst from the right panel's terminal.
 *
 * The terminal is a real PTY, so this frame carries typed characters and paste
 * bursts, not whole documents: xterm delivers a paste of ordinary text in one
 * `onData` callback, and 16 KiB is far above any paste a keyboard can produce
 * while staying far below the frame budget. Control characters are LEGAL here
 * (Enter is `\r`, arrows are `ESC [` sequences) — the bound is size only.
 */
export const MAX_TERM_INPUT_CHARS = 16_384;

/** Widest terminal grid the host will size a PTY to (a guard, not a real limit). */
export const MAX_TERM_COLS = 500;

/** Tallest terminal grid the host will size a PTY to. */
export const MAX_TERM_ROWS = 500;

/**
 * Longest shell path a `term_open` may ask for. The host matches it against the
 * shells it actually discovered — the bound is a frame-size guard, not trust.
 */
export const MAX_SHELL_PATH_CHARS = 4_096;

/**
 * Bytes one editor read may put on the wire — and therefore the largest file
 * the editor can save back.
 *
 * A WIRE budget, not a disk one: the read answer is one WS message (capped at
 * 1 MiB) and a save is one client frame (capped at 512 KiB), so a file the
 * socket cannot carry must be refused with a reason rather than half-delivered.
 * 192 KiB leaves room for JSON escaping and the frame's other fields.
 */
export const MAX_EDITOR_BYTES = 192 * 1024;

/** Chars of one commit message. */
export const MAX_COMMIT_MESSAGE_CHARS = 2000;

/** Paths one stage/unstage frame may name (a bulk stage is still bounded). */
export const MAX_GIT_PATHS = 200;

/** Commits one `git_log` read may return. */
export const MAX_GIT_LOG = 100;

/**
 * Chars of one clone URL. A remote URL is short (an HTTPS endpoint or an SCP
 * shape); 2048 is the browser URL convention and far above anything real, so a
 * pasted document cannot ride in as a "URL".
 */
export const MAX_GIT_CLONE_URL_CHARS = 2048;
