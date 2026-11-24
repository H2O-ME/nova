/**
 * Read-only classification for bash commands (`isConcurrencySafe`): decides
 * whether one call may dispatch concurrently with its siblings, feeding the
 * loop's segment splitter (core `agent/tools.ts`).
 *
 * The judgment is deliberately FAIL-CLOSED: only commands whose whole shape
 * is provably side-effect free qualify, and everything ambiguous —
 * pipelines among reads included — stays serial, which is exactly the
 * behavior the loop had before this classifier existed. The change can only
 * widen parallelism, never safety.
 */

/**
 * Commands with no observable side effects, safe to run concurrently with
 * their own kind. Anything NOT here (including every package manager and
 * build runner, whose subcommands execute arbitrary scripts) stays serial.
 */
const READ_ONLY_COMMANDS = new Set([
  'basename', 'cat', 'date', 'df', 'diff', 'dirname', 'du', 'echo', 'false',
  'file', 'grep', 'head', 'hostname', 'id', 'ls', 'md5sum', 'printenv',
  'printf', 'pwd', 'realpath', 'rg', 'sha1sum', 'sha256sum', 'sort', 'stat',
  'tail', 'true', 'tty', 'type', 'uniq', 'wc', 'where', 'which', 'whoami',
]);

/** git subcommands that only read the repository or the object store. */
const GIT_READ_SUBCOMMANDS = new Set([
  'blame', 'cat-file', 'count-objects', 'describe', 'diff', 'ls-files',
  'ls-remote', 'log', 'rev-parse', 'shortlog', 'show', 'status',
  'symbolic-ref', 'var',
]);

/** find predicates that write or execute; their presence demotes the call. */
const FIND_WRITE_PREDICATES = new Set([
  '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fls', '-fprint', '-fprintf', '-fprint0',
]);

/**
 * Shell metacharacters that could chain, pipe, redirect, substitute, or
 * otherwise smuggle a second command past the first-word check. Quoting is
 * allowed on top of this (a quoted string is data, not structure), so the
 * test is conservative: a metacharacter ANYWHERE, even inside quotes, keeps
 * the call serial.
 */
const SHELL_METACHARS = /[;&|()<>$`\n]/;

/**
 * Whether a bash command is read-only and therefore safe to dispatch
 * concurrently with sibling calls. Rules:
 *  - no shell metacharacter anywhere (no chaining, piping, redirecting,
 *    substitution, or a second line),
 *  - the first word (after VAR=value prefixes) is a known read-only command,
 *    or `git` with a known read-only subcommand (no `--output=` anywhere).
 */
export function readOnlyBashCommand(command: string | undefined): boolean {
  if (command === undefined || command.length === 0) return false;
  if (SHELL_METACHARS.test(command)) return false;
  const words = command.trim().split(/\s+/);
  // Skip environment-assignment prefixes (FOO=bar cmd …): they bind env vars
  // for the command that follows, which is what the first-word check sees.
  let first = 0;
  while (first < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first]!)) {
    first += 1;
  }
  const head = words[first];
  if (head === undefined) return false;
  if (READ_ONLY_COMMANDS.has(head)) return true;
  if (head === 'find') {
    return !words.some((w) => FIND_WRITE_PREDICATES.has(w));
  }
  if (head === 'git') {
    if (command.includes('--output')) return false;
    const sub = words[first + 1];
    return sub !== undefined && GIT_READ_SUBCOMMANDS.has(sub);
  }
  return false;
}
