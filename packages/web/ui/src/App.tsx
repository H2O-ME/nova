/**
 * App shell (2b): transcript on top, bottom stack (approval modal → queue →
 * composer → status). The transcript is the sole scroller; everything else
 * is fixed-height chrome — same partition discipline as the terminal.
 */
import { Approval } from './Approval.js';
import { Composer } from './Composer.js';
import { Transcript } from './Transcript.js';
import { useAgent } from './client.js';

export function App(): JSX.Element {
  const { state, send, connection } = useAgent();
  const approval = state.pendingApproval;
  const running = state.phase !== 'idle' && state.phase !== 'disconnected' && state.phase !== 'waiting_approval';
  return (
    <div className="flex h-dvh flex-col">
      <Transcript blocks={state.blocks} />
      <div className="px-6 pb-2">
        <div className="mx-auto w-full max-w-3xl">
          {approval !== null && <Approval request={approval} send={send} />}
        </div>
      </div>
      <Composer
        send={send}
        disabled={!state.connected || approval !== null}
        phase={approval !== null ? 'waiting_approval' : state.phase}
        queued={state.queued}
        running={running}
        meta={state.meta === null ? null : { model: state.meta.model, approvalMode: state.meta.approvalMode, rootDir: state.meta.rootDir }}
        connected={connection === 'open'}
      />
    </div>
  );
}
