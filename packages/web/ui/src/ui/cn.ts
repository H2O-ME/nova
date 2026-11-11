/**
 * `cn` — the class-name joiner every Tailwind component is written against.
 *
 * The implementation is the `cn` package (conditional joins + Tailwind
 * conflict resolution). `src/lib/utils.ts` is the single import point for
 * shadcn primitives; this module re-exports from it so the Aceternity layer
 * and the shadcn layer cannot drift into two different merge behaviours.
 */
export { cn } from '../lib/utils.js';
