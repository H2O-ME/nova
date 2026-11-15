/**
 * The two channels an OUTSIDE surface uses to hand the composer an input, kept
 * apart from the composer body so each one reads as a contract rather than as
 * an effect buried in the draft box (`InputBar` sits at the structure budget's
 * ceiling, and both of these are "someone else's input", not editing logic).
 *
 *  - `useDraftRequest` — the hero's suggestion chips stage TEXT: the
 *    reference's `replacePlainPrompt`, which replaces the draft, puts the caret
 *    after it, and never sends.
 *  - `usePickedFile` — the HOST's native picker names a FILE: it lands in the
 *    attachment rail and the owner is told the pick was taken.
 *
 * Both are keyed by a `seq` counter rather than by their payload: picking the
 * same chip twice, or re-picking the same file after removing it, must arrive
 * as two events, and an identical string/path would look like nothing new.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** One staged prompt: the text plus the counter that makes repeats distinct. */
export interface DraftRequest {
  text: string;
  seq: number;
}

/** One host-picked file on its way into the composer's rail. */
export interface PickedFile {
  path: string;
  name: string;
  seq: number;
}

/**
 * Apply the newest staged prompt to the draft.
 * @param request - the staged text, or null/undefined when nothing is staged.
 * @param setDraft - the composer's draft setter.
 * @param setCaret - the composer's caret setter (the caret lands after the text).
 * @param boxRef - the textarea, focused and scrolled to its end when present.
 */
export function useDraftRequest(
  request: DraftRequest | null | undefined,
  setDraft: (text: string) => void,
  setCaret: (caret: number) => void,
  boxRef: RefObject<HTMLTextAreaElement | null>,
): void {
  const seen = useRef(0);
  useEffect(() => {
    if (request === null || request === undefined) return;
    if (request.seq === seen.current) return;
    seen.current = request.seq;
    setDraft(request.text);
    setCaret(request.text.length);
    const box = boxRef.current;
    if (box !== null) {
      box.focus({ preventScroll: true });
      box.setSelectionRange(request.text.length, request.text.length);
    }
  }, [request, setDraft, setCaret, boxRef]);
}

/**
 * Stage a host-picked file in the attachment rail, then tell the owner the pick
 * was taken (so it is not re-added on the next render).
 * @param picked - the pick, or null/undefined when there is none.
 * @param add - the rail's add (path + display name).
 * @param onConsumed - the owner's acknowledgement.
 */
export function usePickedFile(
  picked: PickedFile | null | undefined,
  add: (path: string, name: string) => void,
  onConsumed?: (() => void) | undefined,
): void {
  useEffect(() => {
    if (picked === undefined || picked === null) return;
    add(picked.path, picked.name);
    onConsumed?.();
  }, [picked, add, onConsumed]);
}
