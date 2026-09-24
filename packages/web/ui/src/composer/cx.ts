/**
 * `clsx`'s one job, local: the composer's conditional class names, without a
 * dependency (this bundle ships React and nothing else).
 * @param parts - class names, skipped when falsy.
 * @returns the joined class attribute value.
 */
export function cx(...parts: ReadonlyArray<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}