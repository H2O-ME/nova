/**
 * The file tabs' content store (right panel): pure operations over the read
 * files — open, settle, close.
 *
 * Pure because the reducer is the only place that sees both a request and its
 * answer: a read is asked for here (the doc enters as `loading`), the host's
 * `entry` frame settles it. The documents are READ-ONLY — the reference's
 * document preview is a viewer (the harness renders it with Shiki), and this
 * panel's editor never was one: a textarea that writes exactly what it shows
 * was the honest version of a rich editor we did not ship, and the honest
 * version of honesty was removing the write path. The strip (not this store)
 owns which tab is in front.
 */

/** One open document (a file tab's content). */
export interface EditorDoc {
  /** The absolute path the host resolved. */
  path: string;
  /** The file's text as read (the viewer's whole content). */
  text: string;
  /** On-disk size at read time, in bytes. */
  bytes: number;
  /** The file is larger than the wire budget: `text` is empty by design. */
  truncated: boolean;
  /** The file looks binary: `text` is empty by design. */
  binary: boolean;
  /** The last read's refusal reason, when the file could not be read at all. */
  error?: string;
  /** A read is in flight for this document. */
  loading: boolean;
}

export interface EditorState {
  /** Open documents, in open order (the file tabs' backing store). */
  docs: readonly EditorDoc[];
  /** The document read most recently (the strip owns what is on screen). */
  active: string | null;
}

export function emptyEditor(): EditorState {
  return { docs: [], active: null };
}

/** Open (or re-activate) a document; a new one enters as `loading`. */
export function openDoc(state: EditorState, path: string): EditorState {
  const existing = state.docs.find((doc) => doc.path === path);
  if (existing !== undefined) return { ...state, active: path };
  const doc: EditorDoc = { path, text: '', bytes: 0, truncated: false, binary: false, loading: true };
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
      ? { ...doc, text: reading.text, bytes: reading.bytes, truncated: reading.truncated, binary: reading.binary, loading: false }
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

/** Close one document; the neighbour becomes active when the closed one was. */
export function closeDoc(state: EditorState, path: string): EditorState {
  const index = state.docs.findIndex((doc) => doc.path === path);
  if (index === -1) return state;
  const docs = state.docs.filter((doc) => doc.path !== path);
  if (state.active !== path) return { ...state, docs };
  const neighbour = docs[Math.min(index, docs.length - 1)];
  return { docs, active: neighbour?.path ?? null };
}

/** The document at one path, when it is open. */
export function docAt(state: EditorState, path: string): EditorDoc | null {
  return state.docs.find((doc) => doc.path === path) ?? null;
}
