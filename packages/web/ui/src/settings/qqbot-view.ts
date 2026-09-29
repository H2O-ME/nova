/**
 * The QQ page's connection reading, as pure functions.
 *
 * The host sends FACTS ("the channel was started", "the dial is in flight",
 * "the plugin is switched off", "the gateway calls this bot X"); this module
 * decides what a reader is told, and in what order. It is separate from the
 * section so the vocabulary can be pinned without rendering, and so no wording
 * decision hides inside JSX.
 *
 * The four answers a reader must never confuse: 「插件已关闭」 (the operator's own
 * switch), 「连接失败」+原因 (the credentials or the network), 「连接中」 (the dial
 * is still in flight), and 「已连接」 (the gateway is really serving). 「已配置」
 * alone was the old answer, and a reader who saw it assumed the last one — the
 * reported defect.
 */
import { formatClock } from '../format.js';
import { SETTINGS_COPY } from './copy.js';

/**
 * The state vocabulary, in the order `connectionState` reads it.
 *
 * `off` = nothing is configured; `idle` = configured, but this process is not
 * attached; `disabled` = the operator has the plugin switched off.
 */
export type QqbotState = 'off' | 'idle' | 'disabled' | 'connecting' | 'live' | 'failed';

/**
 * The snapshot this page reads: what the host stored, plus the live reading it
 * publishes for this process.
 *
 * The live half is declared HERE rather than imported from the server's frame
 * type, for the same reason `running` was: the page must draw "credentials are
 * stored" differently from "the channel is serving", and the wire type is the
 * server package's file. It is a structural subset of the host's own reading, so
 * the real frame flows through unchanged.
 */
export interface QqbotViewSnapshot {
  appId?: string;
  hasClientSecret?: boolean;
  clientSecretRef?: string;
  error?: string;
  /** Whether the channel is live in this process. */
  running?: boolean;
  live?: {
    /** Started, but not connected yet (the dial is in flight). */
    connecting: boolean;
    /** Plugin enabled in the roster; absent = this host cannot tell. */
    pluginEnabled?: boolean;
    /** Why it is not connected, in the host's own words. */
    failure?: string;
    /** The gateway's username for this bot; null = asked and could not get it. */
    botName?: string | null;
    /** This run's tallies (see `countsReading` for the basis). */
    stats?: { received: number; replied: number; lastReceivedAt?: number };
  };
}

/**
 * Which of the four answers this snapshot earns.
 *
 * Order matters, and it is not the order of the fields: a switched-off plugin is
 * the operator's own decision and outranks everything (its tool is not even
 * registered while it is off), then a FAILURE — that is the answer a reader has
 * to act on — then the dial, then the live channel, and only then the two states
 * where nothing is happening.
 * @param snapshot - the host's stored snapshot plus its live reading.
 * @returns the state.
 */
export function connectionState(snapshot: QqbotViewSnapshot): QqbotState {
  const live = snapshot.live;
  if (live?.pluginEnabled === false) return 'disabled';
  if (snapshot.running === true) return 'live';
  if (live?.connecting === true) return 'connecting';
  if (live?.failure !== undefined) return 'failed';
  if (snapshot.appId === undefined || snapshot.appId.length === 0) return 'off';
  return 'idle';
}

/**
 * The sentence to show beside the state mark.
 * @param snapshot - the host's connection snapshot.
 * @returns the reading.
 */
export function runningReading(snapshot: QqbotViewSnapshot): string {
  switch (connectionState(snapshot)) {
    case 'live': return SETTINGS_COPY['qqbot.statusLive'];
    case 'connecting': return SETTINGS_COPY['qqbot.stateConnecting'];
    case 'failed': return SETTINGS_COPY['qqbot.stateFailed'];
    case 'disabled': return SETTINGS_COPY['qqbot.stateDisabled'];
    case 'idle': return SETTINGS_COPY['qqbot.statusIdle'];
    case 'off': return SETTINGS_COPY['qqbot.statusOff'];
  }
}

/**
 * The host's reason for a state that has one — a failure, verbatim.
 *
 * Verbatim on purpose: the host's sentence names the field, the variable or the
 * HTTP status, which is what the reader has to act on, and every paraphrase so
 * far has dropped exactly that. `error` is the fallback because a save reports
 * its verdict there.
 * @param snapshot - the host's connection snapshot.
 * @returns the reason, or null when there is nothing to add.
 */
export function connectionDetail(snapshot: QqbotViewSnapshot): string | null {
  if (connectionState(snapshot) !== 'failed') return null;
  return snapshot.live?.failure ?? snapshot.error ?? null;
}

/**
 * The bot's name as this page may state it, or null when the page must not draw
 * the row at all.
 *
 * "Not asked yet" and "asked and could not get it" are different sentences: the
 * first is a channel that is not running, the second is a gateway that answered
 * without a username. Neither is a name, and inventing one is the one thing this
 * reading exists to prevent.
 * @param snapshot - the host's connection snapshot.
 * @returns the name, the reason it is missing, or null when there is no row.
 */
export function botNameReading(snapshot: QqbotViewSnapshot): string | null {
  const live = snapshot.live;
  if (live === undefined) return null;
  if (live.botName === null) return SETTINGS_COPY['qqbot.botNameUnknown'];
  if (live.botName !== undefined && live.botName.length > 0) return live.botName;
  return SETTINGS_COPY['qqbot.botNameUnasked'];
}

/**
 * The message tallies, with their basis written into the same sentence.
 *
 * The counters live in this process's memory, so they are NOT a cumulative
 * total: a restart starts over. Saying "共 N 条" would be a claim about the past
 * that no number here supports, so the sentence says 「本次运行」 and how stale
 * the newest message is.
 * @param snapshot - the host's connection snapshot.
 * @param now - current epoch ms (injected, so this stays pure).
 * @returns the sentence, or null when this host does not count.
 */
export function countsReading(snapshot: QqbotViewSnapshot, now: number): string | null {
  const stats = snapshot.live?.stats;
  if (stats === undefined) return null;
  const last = stats.lastReceivedAt === undefined
    ? SETTINGS_COPY['qqbot.noMessages']
    : SETTINGS_COPY['qqbot.lastMessage'].replace('{time}', formatClock(stats.lastReceivedAt, now));
  return SETTINGS_COPY['qqbot.counts']
    .replace('{received}', String(stats.received))
    .replace('{replied}', String(stats.replied))
    .replace('{last}', last);
}
