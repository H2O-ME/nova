/**
 * App shell (M11 批2/批3): header strip → transcript → bottom stack (approval
 * modal → queue → composer). The transcript is the sole scroller; everything
 * else is fixed-height chrome — same partition discipline as the terminal.
 *
 * The shell owns only view-local state (which panel is open); every agent fact
 * comes from the reducer, which comes from the host's frames.
 */
import { useState } from 'react';
import { Approval } from './Approval.js';
import { Composer } from './Composer.js';
import { Header } from './Header.js';
import { Sessions } from './Sessions.js';
import { StatsBar } from './StatsBar.js';
import { ToolDetail } from './ToolDetail.js';
import { Transcript } from './Transcript.js';
import { useAgent } from './client.js';

export function App(): JSX.Element {
  const { state, send, connection } = useAgent();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  /** Which call's detail panel is open (view-local: the reducer has no opinion). */
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const approval = state.pendingApproval;
  const idle = state.phase === 'idle' || state.phase === 'disconnected';
  const running = !idle && state.phase !== 'waiting_approval';
  const toggleSessions = (): void => {
    const next = !sessionsOpen;
    setSessionsOpen(next);
    if (next) send({ type: 'list_sessions' });
  };
  const openTool = (callId: string): void => setOpenCallId((current) => (current === callId ? null : callId));
  const detail =
    openCallId === null ? undefined : state.blocks.find((b) => b.kind === 'tool' && b.callId === openCallId);
  return (
    <div className="flex h-dvh flex-col">
      <Header
        model={state.meta?.model ?? '—'}
        rootDir={state.meta?.rootDir ?? ''}
        approvalMode={state.approvalMode}
        codeMode={state.codeMode}
        usedTokens={state.usedTokens}
        contextWindow={state.contextWindow}
        queued={state.queued.length}
        sessionsOpen={sessionsOpen}
        send={send}
        onToggleSessions={toggleSessions}
        onCompact={() => send({ type: 'compact' })}
        compactBusy={state.phase === 'compacting'}
        canCompact={state.connected}
      />
      {sessionsOpen && state.sessions !== null && (
        <Sessions items={state.sessions} currentFile={state.meta?.sessionFile ?? ''} send={send} onClose={() => setSessionsOpen(false)} />
      )}
      <div className="flex min-h-0 flex-1">
        <Transcript
          blocks={state.blocks}
          idle={idle}
          hidden={Math.max(0, state.historyTotal - state.historyLoaded)}
          onLoadEarlier={() => send({ type: 'load_earlier', have: state.historyLoaded })}
          onOpenTool={openTool}
          selectedCallId={openCallId}
        />
        {detail !== undefined && detail.kind === 'tool' && (
          <ToolDetail block={detail} onClose={() => setOpenCallId(null)} />
        )}
      </div>
      <div className="px-6 pb-2">
        <div className="mx-auto w-full max-w-3xl">{approval !== null && <Approval request={approval} send={send} />}</div>
      </div>
      <StatsBar totals={state.totals} busy={running} />
      <Composer
        send={send}
        disabled={!state.connected || approval !== null}
        phase={approval !== null ? 'waiting_approval' : state.phase}
        queued={state.queued}
        running={running}
        meta={state.meta === null ? null : { model: state.meta.model, approvalMode: state.approvalMode, rootDir: state.meta.rootDir }}
        connected={connection === 'open'}
      />
    </div>
  );
}