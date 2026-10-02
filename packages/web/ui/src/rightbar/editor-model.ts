/**
 * The editor's documents (right panel): pure list operations over the open
 * files — open, activate, edit, save, close.
 *
 * Pure because the reducer is the only place that sees both a request and its
 * answer: a read is asked for here (the doc enters as `loading`), the host's
 * `entry` frame settles it, and a save flips `dirty` back — three moments that
 * must not be three sources of truth.
 */

/** One open document. */
export interface EditorDoc {
  /** The absolute path the host resolved (what a save names). */
  path: string;
  /** The text in the editor: exactly what a save will write. */
  text: string;
  /** On-disk size at load/save time, in bytes. */
  bytes: number;
  /** The file is larger than the wire budget: `text` is empty by design. */
  truncated: boolean;
  /** The file looks binary: `text` is empty by design. */
  binary: boolean;
  /** The last read's refusal reason, when the file could not be read at all. */
  error?: string;
  /** A read is in flight for this document. */
  loading: boolean;
  /** The text differs from what was last loaded or saved. */
  dirty: boolean;
  /** The last save failed with this reason (cleared by the next save). */
  saveError?: string;
}

export interface EditorState {
  /** Open documents, in open order. */
  docs: readonly EditorDoc[];
  /** The document on screen, or null when none is open. */
  active: string | null;
}

export function emptyEditor(): EditorState {
  return { docs: [], active: null };
}

/** Open (or re-activate) a document; a new one enters as `loading`. */
export function openDoc(state: EditorState, path: string): EditorState {
  const existing = state.docs.find((doc) => doc.path === path);
  if (existing !== undefined) return { ...state, active: path };
  const doc: EditorDoc = { path, text: '', bytes: 0, truncated: false, binary: false, loading: true, dirty: false };
  return { docs: [...state.docs, doc], active: path };
}

/** Settle a read: the text, or the reading that says why there is none. */
export function docLoaded(
  state: EditorState,
  reading: { path: string; text: string; bytes: number; truncated: boolean; binary: boolean },
): EditorState {
  return {
    ...state,
    docs: state.docs.map((doc) => (doc.path === reading.path
      ? { ...doc, text: reading.text, bytes: reading.bytes, truncated: reading.truncated, binary: reading.binary, loading: false, dirty: false }
      : doc)),
  };
}

/** Settle a refused read: the document stays open showing the reason. */
export function docError(state: EditorState, path: string, message: string): EditorState {
  return {
    ...state,
    docs: state.docs.map((doc) => (doc.path === path ? { ...doc, loading: false, error: message } : doc)),
  };
}

/** A keystroke: the text becomes dirty. */
export function docEdited(state: EditorState, path: string, text: string): EditorState {
  return {
    ...state,
    docs: state.docs.map((doc) => (doc.path === path ? { ...doc, text, dirty: true } : doc)),
  };
}

/** A save that landed: the text is now what is on disk. */
export function docSaved(state: EditorState, path: string, bytes: number): EditorState {
  return {
    ...state,
    docs: state.docs.map((doc) => (doc.path === path
      ? { ...doc, bytes, dirty: false, saveError: undefined, error: undefined }
      : doc)),
  };
}

/** Close one document; the neighbour becomes active when the closed one was. */
export function closeDoc(state: EditorState, path: string): EditorState {
  const index = state.docs.findIndex((doc) => doc.path === path);
  if (index === -1) return state;
  const docs = state.docs.filter((doc) => doc.path !== path);
  if (state.active !== path) return { ...state, docs };
  const neighbour = docs[Math.min(index, docs.length - 1)];
  return { docs, active: neighbour?.path ?? null };
}

/** Bring one open document to the front. */
export function activateDoc(state: EditorState, path: string): EditorState {
  return state.docs.some((doc) => doc.path === path) ? { ...state, active: path } : state;
}

/** The document on screen, when there is one. */
export function activeDoc(state: EditorState): EditorDoc | null {
  return state.docs.find((doc) => doc.path === state.active) ?? null;
}

/** Whether the document on screen has unsaved changes (the close guard). */
export function hasDirty(state: EditorState): boolean {
  return state.docs.some((doc) => doc.dirty);
}
