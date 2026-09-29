/**
 * A real PNG fixture, in source.
 *
 * Bytes rather than a checked-in binary so the fixture cannot drift from the
 * format it asserts, and a real signature so `sniffImageMediaType` is exercised
 * against what an actual image looks like.
 */

/** An 8-byte PNG signature plus a short payload. */
export function pngBytes(payload = 'nova'): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([...signature, ...new TextEncoder().encode(payload)]);
}
