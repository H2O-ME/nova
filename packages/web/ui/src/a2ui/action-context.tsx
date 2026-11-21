/**
 * The bridge from an A2UI button back to the agent.
 *
 * A2UI's renderer→agent message is an `action`; this product's only inbound
 * channel for "the human said something" is the prompt frame, so the action is
 * formatted as a user turn and sent there. That keeps one intake path (queueing,
 * echo handling and permissions stay the composer's rules) and matches A2UI's
 * own model: a form submission is a new user turn, not a live callback into a
 * finished run.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { ClientFrame } from '../types.js';
import type { A2uiAction } from './surface.js';

/** One resolved action plus the surface it came from. */
export interface A2uiSubmission extends A2uiAction {
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  /** ISO 8601, the protocol's own field (the client stamps it at click time). */
  readonly timestamp: string;
  /** The whole model, present only when the surface set `sendDataModel: true`. */
  readonly dataModel?: unknown;
}

export type A2uiSubmit = (submission: A2uiSubmission) => void;

const A2uiActionContext = createContext<A2uiSubmit | null>(null);

/** The maximum context text carried into one prompt (a form, not a document). */
const MAX_ACTION_CONTEXT_CHARS = 20_000;

/**
 * Format one submission as the user turn the agent reads.
 *
 * The field names are the PROTOCOL's (`action` / `a2uiRendererDataModel`), so a
 * model that learned A2UI from the skill or the spec does not have to decode a
 * prose paraphrase. The prompt channel is this product's transport; the payload
 * inside it stays A2UI's.
 */
function submissionText(action: A2uiSubmission): string {
  let actionJson: string;
  try {
    actionJson = JSON.stringify({
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      timestamp: action.timestamp,
      context: action.context,
    });
  } catch {
    actionJson = '{}';
  }
  const bounded = actionJson.length > MAX_ACTION_CONTEXT_CHARS
    ? `${actionJson.slice(0, MAX_ACTION_CONTEXT_CHARS)}…`
    : actionJson;
  const lines = [
    `（界面操作）用户在界面「${action.surfaceId.slice(0, 128)}」上点击了「${action.name.slice(0, 200)}」。`,
    `A2UI action：${bounded}`,
  ];
  if (action.dataModel !== undefined) {
    let model: string;
    try {
      model = JSON.stringify(action.dataModel);
    } catch {
      model = '{}';
    }
    lines.push(`a2uiRendererDataModel：${model.length > MAX_ACTION_CONTEXT_CHARS ? `${model.slice(0, MAX_ACTION_CONTEXT_CHARS)}…` : model}`);
  }
  return lines.join('\n');
}

export function A2uiActionProvider({ send, children }: { send: (frame: ClientFrame) => void; children: ReactNode }): JSX.Element {
  const submit = useCallback<A2uiSubmit>((action) => {
    send({ type: 'prompt', text: submissionText(action) });
  }, [send]);
  return <A2uiActionContext.Provider value={submit}>{children}</A2uiActionContext.Provider>;
}

/** The submit function, or null outside the provider (the button then reports why). */
export function useA2uiSubmit(): A2uiSubmit | null {
  return useContext(A2uiActionContext);
}
