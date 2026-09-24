/**
 * Control-character policy for text that crosses INTO the kernel: prompt text,
 * approval reasons, session file paths. One definition, because the per-surface
 * copies disagreed — the browser allowed newlines in a typed denial reason, the
 * Rust bridge did not, the REPL checked nothing, and a path was checked with a
 * third variant.
 *
 * The rule: a C0 control character is never legitimate in kernel-bound text
 * except where the field is genuinely multi-line (a prompt body, a denial
 * reason the user typed over several lines). There `\n`/`\r`/`\t` are fine;
 * everything else (`\u0000`-`\u0008`, `\u000b`, `\u000c`, `\u000e`-`\u001f`) is
 * an attempt to smuggle terminal control or a NUL into a log line or a frame.
 */
export interface TextPolicy {
  /** Allow `\n` / `\r` / `\t` (prompt bodies and reasons are typed over lines). */
  multiline?: boolean;
}

/** True when `text` contains a control character this policy forbids. */
export function hasControlChars(text: string, policy: TextPolicy = {}): boolean {
  const multiline = policy.multiline === true;
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0x20;
    if (code >= 0x20) return false;
    return !(multiline && (ch === '\n' || ch === '\r' || ch === '\t'));
  });
}