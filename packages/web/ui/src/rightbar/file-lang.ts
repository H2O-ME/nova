/**
 * Path → syntax-scanner id, shared by the file preview.
 *
 * One scanner per language family already exists in the chat markdown
 * highlighter; this file only maps a file extension onto it. Pure, no DOM.
 */

/** Extension → the scanner id `highlightLines` reads, for paths (not fences). */
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'cs',
  kotlin: 'kotlin', kt: 'kotlin', swift: 'swift', php: 'php', scala: 'scala', dart: 'dart',
  css: 'css', scss: 'scss', less: 'less',
  go: 'go', rs: 'rs', py: 'py',
  sh: 'sh', bash: 'bash', zsh: 'zsh',
  json: 'json', jsonc: 'jsonc', json5: 'json',
  yml: 'yml', yaml: 'yaml', toml: 'toml', ini: 'ini', conf: 'conf', properties: 'properties', env: 'env',
};

/**
 * The scanner id for one file path, or undefined when no scanner reads it —
 * the same "unknown means plain" rule the fence renderer applies.
 * @param path - the file path (any separator style).
 */
export function langOfPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // `<= 0`: no dot at all, or a dotfile (.gitignore has no extension to read).
  if (dot <= 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(EXT_LANG, ext) ? EXT_LANG[ext] : undefined;
}
