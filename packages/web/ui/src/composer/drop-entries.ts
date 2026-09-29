/**
 * Which members of one drop are directories.
 *
 * Ported from deepseek-harness `ui-attachment/src/client/drop-events.ts` (MIT):
 * the `File` a directory drop yields is indistinguishable from an empty file,
 * so the entry API is the only source of that fact; a browser without it
 * reports no directories rather than guessing.
 */

/** The entry API's shape, as much of it as this check reads. */
interface FileSystemEntryLike {
  isDirectory: boolean;
}

/** One data-transfer item, as much of it as this check reads. */
interface DropItemLike {
  kind: string;
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
}

/**
 * The dropped members that are directories.
 * @param items - the transfer's items, in the order `files` lists them.
 * @param files - the drop's `File` list (`dataTransfer.files`).
 * @returns the files that name a directory (empty when the engine has no entry API).
 */
export function droppedDirectories(
  items: readonly DropItemLike[],
  files: readonly File[],
): ReadonlySet<File> {
  const directories = new Set<File>();
  let fileIndex = 0;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = files[fileIndex];
    fileIndex += 1;
    if (typeof item.webkitGetAsEntry !== 'function') continue;
    if (item.webkitGetAsEntry()?.isDirectory !== true) continue;
    if (file !== undefined) directories.add(file);
  }
  return directories;
}
