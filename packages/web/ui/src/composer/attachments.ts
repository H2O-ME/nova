/**
 * The composer's attachment intake: what a file becomes when it is named.
 *
 * **A file is never copied; an IMAGE is never a path.** The two rules are the
 * same rule seen from two sides, and the difference is a fact about where the
 * bytes live:
 *
 *  - A local file already HAS a path, and the model reads it there with its own
 *    tools, so a reference is the whole wiring: the row holds a real absolute
 *    path and the send appends `@path` to the draft. Nothing is written.
 *  - A PASTED image has no path anywhere — the clipboard hands the browser bytes
 *    and nothing else (`File.path` is an Electron extension, and
 *    `showDirectoryPicker()` resolves a handle with no path) — so its bytes must
 *    reach the host or nothing later can recover them. That is why an image, and
 *    only an image, is uploaded (see `image-draft.ts`).
 *
 * An earlier version streamed EVERY dropped file to the host, which copied it
 * into `~/.nova/cache/uploads/` so the model could `read_file` it. That fed the
 * model nothing new (the original path reads just as well) while duplicating
 * bytes the user never asked to duplicate, and the directory only ever grew —
 * measured at 24MB for one video the model could not consume at all. That route
 * is gone; only raster images are stored now, and only because they have no
 * other representation.
 *
 * Drag/DROP still cannot produce a file reference and says so instead of
 * silently copying (browsers give no path); see {@link DROP_NEEDS_PATH}.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { droppedDirectories } from './drop-entries.js';
import { isImageMediaType, previewUrl, uploadImage, type ImageDraft } from './image-draft.js';
import { formatMention } from './reference-menu.js';

/** One referenced local file, in the order it was named. */
export interface UploadedFile {
  /** Client-side id, so a card can be keyed and removed. */
  id: string;
  /** The leaf name (what the user recognises). */
  name: string;
  /** Absolute host path — exactly what a `@` mention must name. */
  path: string;
  /** Size in bytes when the host reported one, else 0. */
  bytes: number;
  status: 'ready';
}

export interface Attachments {
  files: readonly UploadedFile[];
  /**
   * Pasted raster images staged for this prompt, in paste order.
   *
   * Separate from `files` because the two reach the model by different routes:
   * a file becomes an `@path` MENTION in the text, an image becomes image
   * CONTENT on the prompt frame. Merging them would mean one list whose rows
   * behave differently at send time.
   */
  images: readonly ImageDraft[];
  /** True while a drag carries files over the document (the overlay's gate). */
  dragging: boolean;
  /**
   * Name one local file by absolute path. The path comes from the host's file
   * picker, never from a browser `File`, so it is always real.
   * @param path - the absolute path the host reported.
   * @param name - the leaf name to display (defaults to the path's last segment).
   * @returns null (kept for the shared intake shape).
   */
  add: (path: string, name?: string) => string | null;
  /** Forget one row. Nothing is deleted from disk — there is nothing stored. */
  remove: (id: string) => void;
  /** Forget one staged image (its stored object is left alone, being shared). */
  removeImage: (id: string) => void;
  /** Retire the committed rows after a send (their mentions are in the prompt). */
  clear: () => void;
}

/** A browser has no way to add a folder (dsh `attachment.directoryDesktopOnly`). */
export const DIRECTORY_REFUSED = '浏览器里无法添加文件夹，请用「引用本地文件」挑文件夹中的单个文件';

/**
 * Why a dropped or pasted file cannot become a reference.
 *
 * Stated rather than silently copied: the copy was the behaviour the operator
 * objected to, and a silent one would be worse than none.
 */
export const DROP_NEEDS_PATH = '拖入的文件没有可引用的真实路径：请用「引用本地文件」挑一个，或把它放进工作区后用 @ 引用';

/** The `+` menu entry that opens the host's file picker. */
export const REFERENCE_LOCAL_FILE = '引用本地文件';

/** The last path segment, for platforms where `\` separates. */
function leafName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The mention tokens that make referenced files reachable by the model.
 *
 * This is the whole wiring between a reference and a prompt. A reference is TEXT
 * (`@path`) and nothing else — see the module header of `reference-menu.ts` — so
 * naming the path is all that is required: `read_file` resolves an absolute path,
 * and an absolute path outside the workspace goes through the normal approval
 * gate rather than a trusted-root exemption. There is no attachment frame and
 * there does not need to be one.
 *
 * A path the mention grammar cannot represent (a control character or a `"`) is
 * skipped rather than mangled into a different name.
 * @param files - the rail's rows, in arrival order.
 * @returns the suffix to append to the prompt, or '' when there is nothing to name.
 */
export function attachmentMentions(files: readonly UploadedFile[]): string {
  const tokens: string[] = [];
  for (const file of files) {
    if (file.status !== 'ready') continue;
    const mention = formatMention(file.path);
    if (mention !== null) tokens.push(mention);
  }
  return tokens.join('\n');
}

/**
 * Hold the referenced files and the document-level drop listeners.
 *
 * The listeners exist only to REFUSE WELL: a drop without `preventDefault` makes
 * the browser navigate to the file and lose the session, so they must stay bound
 * even though no drop can be accepted.
 * @param disabled - while true (no connection, or a run holds the composer) a
 *   drop is ignored rather than reported.
 * @param onRefused - publish a refusal the reader must see. The drop and paste
 *   listeners are bound here and cannot return a value to a caller, so without
 *   this sink the most common desktop gesture would fail in silence.
 * @returns the reference list, the drag flag, and the controls.
 */
export function useAttachments(
  disabled: boolean,
  onRefused?: (reason: string) => void,
): Attachments {
  const [files, setFiles] = useState<readonly UploadedFile[]>([]);
  const [images, setImages] = useState<readonly ImageDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(0);
  // The latest `disabled` for the document listeners, which are bound once (a
  // re-bind per render would tear and re-add them on every keystroke).
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  // Read through a ref for the same reason: the listeners are bound once.
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;

  const add = useCallback((path: string, name?: string): string | null => {
    const trimmed = path.trim();
    if (trimmed === '') return null;
    seq.current += 1;
    const id = `${String(Date.now())}-${String(seq.current)}`;
    setFiles((current) => {
      // Naming the same file twice would put the same `@path` in the draft
      // twice: the mention is the payload, so a duplicate is a duplicate order,
      // not a second file.
      if (current.some((entry) => entry.path === trimmed)) return current;
      return [...current, {
        id,
        name: name === undefined || name === '' ? leafName(trimmed) : name,
        path: trimmed,
        bytes: 0,
        status: 'ready',
      }];
    });
    return null;
  }, []);

  const remove = useCallback((id: string): void => {
    setFiles((current) => current.filter((entry) => entry.id !== id));
  }, []);

  /**
   * Take the pasted files that are raster images; refuse the rest.
   *
   * Returns whether anything was taken, so the document handler knows whether
   * to fall through to the "no path" refusal.
   */
  const takePastedFiles = useCallback((pasted: readonly File[]): boolean => {
    const images = pasted.filter((file) => isImageMediaType(file.type));
    if (images.length === 0) return false;
    for (const file of images) {
      seq.current += 1;
      const id = `${String(Date.now())}-${String(seq.current)}`;
      // The preview URL is created here, with the row, and revoked wherever the
      // row is dropped — creation and release in one file, so neither can be
      // forgotten independently.
      const previewUrl = previewUrlFor(file);
      const staged: ImageDraft = {
        id,
        name: file.name === '' ? undefined : file.name,
        bytes: file.size,
        status: 'uploading',
        ...(previewUrl === undefined ? {} : { previewUrl }),
      };
      setImages((current) => [...current, staged]);
      // Uploaded immediately rather than at send time: the host is the authority
      // on whether these bytes are acceptable (it re-sniffs them), and learning
      // of a refusal at send would mean discovering it after the user had typed
      // the whole message.
      void uploadImage(file).then((result) => {
        setImages((current) => current.map((entry) => {
          if (entry.id !== id) return entry;
          return result.ok
            ? { ...entry, status: 'ready', ref: result.ref }
            : { ...entry, status: 'failed', error: result.error };
        }));
      });
    }
    return true;
  }, []);
  const takePastedRef = useRef<(files: readonly File[]) => boolean>(takePastedFiles);
  takePastedRef.current = takePastedFiles;

  const removeImage = useCallback((id: string): void => {
    setImages((current) => {
      // Release before dropping the row: an object URL pins its blob until it is
      // revoked, and holding the reference would keep it alive forever.
      const going = current.find((entry) => entry.id === id);
      if (going?.previewUrl !== undefined) URL.revokeObjectURL(going.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  // Committed rows leave the rail once their mentions are in the prompt. Without
  // this the card stays staged exactly as if it were still pending, so the next
  // send carries it again and it follows the reader across session switches (the
  // composer is not remounted per session).
  const clear = useCallback((): void => {
    setFiles([]);
    setImages((current) => {
      for (const entry of current) {
        if (entry.previewUrl !== undefined) URL.revokeObjectURL(entry.previewUrl);
      }
      return [];
    });
  }, []);

  useDocumentIntake({
    disabledRef,
    onDragging: setDragging,
    onRefused: refusedRef,
    onPastedFiles: takePastedRef,
  });

  return { files, images, dragging, add, remove, removeImage, clear };
}

/**
 * An object URL for one local file, or `undefined` where the API is absent.
 *
 * `URL.createObjectURL` is a DOM API the test lane does not provide, so this
 * returns `undefined` rather than throwing: a row without a preview is still a
 * correct row, and the alternative would be a crash in every non-browser test.
 * @param file - the local image file.
 * @returns the object URL, or undefined.
 */
function previewUrlFor(file: File): string | undefined {
  if (typeof URL.createObjectURL !== 'function') return undefined;
  return previewUrl(file);
}

/**
 * The document-level intake listeners.
 *
 * The drop target is the DOCUMENT, not the composer card: a file dropped a few
 * pixels low would otherwise open in the browser and navigate away from the
 * session. Bound ONCE (a re-bind per render would tear and re-add listeners on
 * every keystroke), so they read both live values through refs.
 * @param options.disabledRef - the live disabled flag.
 * @param options.onDragging - the overlay flag setter.
 * @param options.onRefused - the live refusal sink.
 */
function useDocumentIntake(options: {
  disabledRef: React.RefObject<boolean>;
  onDragging: (dragging: boolean) => void;
  onRefused: React.RefObject<((reason: string) => void) | undefined>;
  /**
   * Accept pasted raster images. Returns whether ANY file was taken: when none
   * is (a text-only paste, or a non-image file), the refusal path still runs so
   * the user learns why nothing appeared.
   */
  onPastedFiles: React.RefObject<((files: readonly File[]) => boolean) | undefined>;
}): void {
  const { disabledRef, onDragging, onRefused, onPastedFiles } = options;
  useEffect(() => {
    // A nested drag fires `dragenter`/`dragleave` for every element it crosses,
    // so a bare boolean flickers the overlay. The depth counter is what makes
    // "still inside the window" expressible.
    let depth = 0;
    /** The transfer, but only when it actually carries files (not selected text). */
    const fileTransfer = (event: DragEvent): DataTransfer | null => {
      const transfer = event.dataTransfer;
      if (transfer === null || !transfer.types.includes('Files')) return null;
      return transfer;
    };
    const reset = (): void => {
      depth = 0;
      onDragging(false);
    };
    const onEnter = (event: DragEvent): void => {
      if (fileTransfer(event) === null) return;
      event.preventDefault();
      depth += 1;
      if (!disabledRef.current) onDragging(true);
    };
    /**
     * Whether a transfer carries at least one file this product can take.
     *
     * Images are the only accepted drop, so the cursor promise is decided by
     * the items' declared types. A browser that hides the types (some do for
     * security) yields `false` and the cursor stays `none` — the safer wrong
     * answer, since a copy cursor over a drop that then refuses is worse than
     * the reverse.
     */
    const carriesImage = (transfer: DataTransfer): boolean =>
      [...transfer.items].some((item) => item.kind === 'file' && isImageMediaType(item.type));
    const onOver = (event: DragEvent): void => {
      const transfer = fileTransfer(event);
      if (transfer === null) return;
      event.preventDefault();
      // `copy` only when a drop would actually land something; otherwise `none`,
      // because a copy cursor would promise a landing that will not happen.
      transfer.dropEffect = carriesImage(transfer) ? 'copy' : 'none';
    };
    const onLeave = (event: DragEvent): void => {
      if (fileTransfer(event) === null) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) onDragging(false);
      // Leaving the window entirely arrives as a dragleave on the root element
      // with coordinates outside it — the counter alone would stay stuck above
      // zero if a nested element swallowed the matching enter.
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset();
    };
    const onDrop = (event: DragEvent): void => {
      const transfer = fileTransfer(event);
      if (transfer === null) return;
      // preventDefault FIRST: without it the browser navigates to the dropped
      // file and the session is gone.
      event.preventDefault();
      reset();
      if (disabledRef.current) return;
      const dropped = [...transfer.files];
      if (dropped.length === 0) return;
      // An IMAGE dropped from the desktop is in exactly the same position as a
      // pasted one: the browser hands over bytes and NO path, so the bytes must
      // be uploaded or nothing can recover them. Taking it here keeps paste and
      // drop from disagreeing about the same file. Any other dropped file keeps
      // the refusal, since a path is the only thing that could reach the model.
      if (onPastedFiles.current?.(dropped) === true) return;
      const directories = droppedDirectories([...transfer.items], dropped);
      onRefused.current?.(directories.size > 0 && directories.size === dropped.length ? DIRECTORY_REFUSED : DROP_NEEDS_PATH);
    };
    // Paste, on the document: a screenshot has no text to paste, so the textarea
    // would ignore it entirely. When the clipboard carries BOTH files and text
    // (copying a file in Explorer yields a name plus the file), the text is left
    // to the textarea's own handler — preventing the default here would eat it.
    //
    // An IMAGE is the one pasted file that becomes bytes on the host rather than
    // an `@path` mention, because the clipboard gives the browser bytes and NO
    // path: nothing later could recover them if they were not uploaded. Any other
    // pasted file keeps the refusal, since a browser cannot name where it lives.
    const onPaste = (event: ClipboardEvent): void => {
      const pasted = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (pasted.length === 0 || disabledRef.current) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const taken = onPastedFiles.current?.(pasted) ?? false;
      // With text alongside, leaving the default alone keeps the textarea's own
      // paste working; with none, the default is what would navigate away.
      if (text === '') event.preventDefault();
      if (!taken) onRefused.current?.(DROP_NEEDS_PATH);
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    // A drag abandoned outside the window never fires `drop` here.
    window.addEventListener('dragend', reset);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('dragend', reset);
    };
  }, [disabledRef, onDragging, onRefused, onPastedFiles]);
}
