/**
 * The QQ 机器人 page: the channel's live connection information, its settings,
 * and its purpose.
 *
 * The shell hands this kernel the channel as a candidate plugin even while the
 * credentials are unusable (`cli/qqbot-bridge.ts`), so the page can always say
 * the feature exists. Four different facts then have to stay apart, and the page
 * used to collapse all of them into one word ("已配置") — which is the confusion
 * this page's reading exists to remove:
 *
 *  - is the PLUGIN switched on (the operator's own decision, and while it is off
 *    the tool is not even registered — so that branch draws no fields at all);
 *  - is the channel CONNECTED (live / dialing / failed, with the host's reason);
 *  - WHO the bot is (the gateway's own username, or an honest "取不到");
 *  - how much it has CARRIED — this run's inbound/reply tallies, never a
 *    cumulative total (see `countsReading`).
 *
 * The page has three verbs — 保存 (persist `appId` / `clientSecret` verbatim),
 * 测试连接 (probe the typed credentials end to end; the candidate secret travels
 * in the test frame only and is never stored), and 开启插件 (the one-click entry
 * for the switched-off branch) — plus the guide that says what the channel is for
 * (`QqbotGuide.tsx`).
 *
 * The secret field is write-only: empty means "keep what is stored" (the browser
 * never holds the stored value, so it cannot send it back). An `{env:NAME}`-shaped
 * value is stored as a reference, not as a literal — the field's hint says this.
 */
import { useEffect, useState } from 'react';
import { StateDot, type StateDotState } from '../tool/StateDot.js';
import { SETTINGS_COPY } from './copy.js';
import { ManageError } from './ManageError.js';
import { QqbotGuide } from './QqbotGuide.js';
import { botNameReading, connectionDetail, connectionState, countsReading, runningReading, type QqbotState, type QqbotViewSnapshot } from './qqbot-view.js';
import { SettingsSection } from './Section.js';
import { useManageRefusal } from './use-manage-refusal.js';
import type { ClientFrame } from '../types.js';
import type { QqBotTest } from '../state.js';
import css from './QqbotSection.module.css';

/**
 * The snapshot type this page reads. Defined in `qqbot-view.ts` beside the
 * reading that consumes it; re-exported so callers keep one import for the page.
 */
export type { QqbotViewSnapshot } from './qqbot-view.js';

/**
 * How long after 开启插件 the page asks again. The plugin switch re-rosters the
 * kernel, and the frames on one socket are NOT queued (`ws.ts` hands each to the
 * router as it arrives), so the first answer can beat the roster and still say
 * 「已关闭」. The second ask carries the real result; a stale first answer costs
 * nothing but a moment of the old sentence.
 */
const REASK_AFTER_ENABLE_MS = 400;

/** The state mark each answer wears (the shell's own StateDot vocabulary). */
const DOT: Record<QqbotState, StateDotState> = {
  live: 'done',
  connecting: 'ongoing',
  failed: 'error',
  disabled: 'idle',
  idle: 'idle',
  off: 'idle',
};

export interface QqbotSectionProps {
  /** The last connection snapshot; null until the first answer lands. */
  snapshot: QqbotViewSnapshot | null;
  /** The probe's last answer; cleared on re-ask and on field edits. */
  test: QqBotTest | null;
  /** The socket is down: every verb refuses. */
  disabled: boolean;
  /**
   * The last management refusal, or null. A refused save/probe answers with an
   * `error` frame rather than a snapshot, so the in-flight control must watch
   * this too — otherwise it stays disabled for the rest of the panel's life.
   */
  manageError: { readonly seq: number; readonly message: string } | null;
  send: (frame: ClientFrame) => void;
  /** Retire the probe's answer locally (a field edit invalidates it). */
  onClearTest: () => void;
}

/**
 * Render the QQ 机器人 page.
 * @param props - see QqbotSectionProps.
 * @returns the section element tree.
 */
export function QqbotSection({
  snapshot,
  test,
  disabled,
  manageError,
  send,
  onClearTest,
}: QqbotSectionProps): JSX.Element {
  useEffect(() => {
    send({ type: 'qqbot' });
  }, [send]);

  const [appId, setAppId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'enable' | null>(null);
  const refusal = useManageRefusal(manageError);

  // The snapshot seeds the draft ONCE per answer (an operator edit after that
  // is theirs — a re-render must not clobber it). `appId: null` means "no
  // answer yet"; the empty string is a real draft.
  useEffect(() => {
    if (snapshot !== null) {
      setAppId((current) => current ?? snapshot.appId ?? '');
      setBusy(null);
      refusal.settle();
    }
  }, [snapshot]);
  useEffect(() => {
    if (test !== null) {
      setBusy(null);
      refusal.settle();
    }
  }, [test]);
  // A refusal answers with an `error` frame instead of a `qqbot` / `qqbot_test`
  // frame, so neither effect above would fire: without the hook releasing it the
  // section stays busy forever and both buttons stay dead (the same defect the
  // plugin and skill sections had). The hook also renders the reason.

  const draftAppId = appId ?? snapshot?.appId ?? '';
  const secretReading = snapshot?.clientSecretRef !== undefined
    ? `${SETTINGS_COPY['qqbot.secretRef']}: ${snapshot.clientSecretRef}`
    : snapshot?.hasClientSecret === true
      ? SETTINGS_COPY['qqbot.secretSet']
      : SETTINGS_COPY['qqbot.secretUnset'];

  const save = (): void => {
    setBusy('save');
    onClearTest();
    refusal.begin();
    send(secret.length > 0
      ? { type: 'save_qqbot', appId: draftAppId, clientSecret: secret }
      : { type: 'save_qqbot', appId: draftAppId });
  };

  const probe = (): void => {
    // Testing needs the FULL candidate: an empty secret field means the
    // operator wants the stored secret tested, which the browser does not
    // have — so the probe requires the field filled. The frame carries the
    // candidate for the test only; nothing is stored.
    setBusy('test');
    refusal.begin();
    send({ type: 'test_qqbot', appId: draftAppId, clientSecret: secret });
  };

  /**
   * The switched-off branch's one verb. `set_plugin_enabled` is the same frame
   * the 插件管理 page sends for an `advanced` row, so enabling from here and
   * from there are one operation; the page then re-asks for its own snapshot
   * (twice — see `REASK_AFTER_ENABLE_MS`) because the switch answers with a
   * `plugins` frame this page does not receive.
   */
  const enable = (): void => {
    setBusy('enable');
    refusal.begin();
    send({ type: 'set_plugin_enabled', name: 'qqbot', enabled: true });
    send({ type: 'qqbot' });
    globalThis.setTimeout(() => { send({ type: 'qqbot' }); }, REASK_AFTER_ENABLE_MS);
  };

  const edit = (setter: (value: string) => void) => (event: { currentTarget: { value: string } }): void => {
    setter(event.currentTarget.value);
    // A result belongs to the exact credentials it tested: any edit retires it
    // locally (the reducer clears it again on the next snapshot either way).
    if (test !== null) onClearTest();
  };

  const state = snapshot === null ? null : connectionState(snapshot);
  // The host may report a failure through BOTH `error` (a save echoes its verdict
  // there) and the live reading. Shown once: the state line owns it as the reason
  // it is not connected, so the config block keeps only a DIFFERENT problem — the
  // unresolved `{env:NAME}` that the boot diagnostic names.
  const configError = snapshot !== null && snapshot.error !== undefined && snapshot.error !== snapshot.live?.failure
    ? snapshot.error
    : undefined;
  const name = snapshot === null ? null : botNameReading(snapshot);
  const counts = snapshot === null ? null : countsReading(snapshot, Date.now());
  const detail = snapshot === null ? null : connectionDetail(snapshot);

  return (
    <SettingsSection>
      <h2 className={css.heading}>{SETTINGS_COPY['qqbot.title']}</h2>
      <p className={css.intro}>{SETTINGS_COPY['qqbot.intro']}</p>
      <ManageError message={refusal.message} />
      <QqbotGuide />
      {snapshot === null && <div className={css.status}>{SETTINGS_COPY['qqbot.loading']}</div>}
      {snapshot !== null && state !== null && (state === 'disabled' ? (
        // The plugin is off: the operator's switch, not a broken bot. No
        // credential fields and no counters — a form that cannot be used yet
        // reads as a working one, which is what this branch exists to avoid.
        <div className={css.closed}>
          <div className={css.state}>
            <StateDot state={DOT.disabled} />
            <span>{SETTINGS_COPY['qqbot.stateDisabled']}</span>
          </div>
          <p className={css.fieldHint}>{SETTINGS_COPY['qqbot.stateDisabledHint']}</p>
          <div className={css.actions}>
            <button
              type="button"
              className={css.primary}
              disabled={disabled || busy !== null}
              onClick={enable}
            >
              {busy === 'enable' ? SETTINGS_COPY['qqbot.enabling'] : SETTINGS_COPY['qqbot.enable']}
            </button>
          </div>
          <p className={css.note}>{SETTINGS_COPY['qqbot.stateDisabledNote']}</p>
        </div>
      ) : (
        <>
          {/* The plugin's own misconfiguration, when the host reported one. Shown
              BEFORE the fields: the row below may look perfectly configured while
              the stored credential is an unresolved `{env:NAME}`, and a reader who
              only saw the fields would conclude the bot works. */}
          {configError !== undefined && (
            <div className={css.configError} role="status">
              <span className={css.configErrorTitle}>{SETTINGS_COPY['qqbot.configError']}</span>
              <span className={css.configErrorDetail}>{configError}</span>
            </div>
          )}
          {/* The state line is a READING, not a control: it wears the shell's own
              StateDot rather than the shared Switch. A `role="switch"` here would
              promise a toggle and then ignore the click — the class of bug this
              whole task is about. The dot's colour says which state, the word
              says what it means, and a failure adds the host's own reason. */}
          <div className={css.state}>
            <StateDot state={DOT[state]} />
            <span>{runningReading(snapshot)}</span>
          </div>
          {detail !== null && <p className={css.detail}>{detail}</p>}
          {/* Who the bot is and what it has carried. Only while the channel is
              serving: 「收到 0 条」 beside 「未配置」 is noise, and a name row the
              host cannot fill would read as a field that is merely empty. */}
          {state === 'live' && (name !== null || counts !== null) && (
            <>
              <dl className={css.info}>
                {name !== null && (
                  <>
                    <dt className={css.infoTerm}>{SETTINGS_COPY['qqbot.botName']}</dt>
                    <dd className={css.infoValue}>{name}</dd>
                  </>
                )}
                {counts !== null && (
                  <>
                    <dt className={css.infoTerm}>{SETTINGS_COPY['qqbot.countsTerm']}</dt>
                    <dd className={css.infoValue}>{counts}</dd>
                  </>
                )}
              </dl>
              {counts !== null && <p className={css.note}>{SETTINGS_COPY['qqbot.countsScope']}</p>}
            </>
          )}
          <div className={css.field}>
            <label className={css.label} htmlFor="qqbot-appid">{SETTINGS_COPY['qqbot.appId']}</label>
            <input
              id="qqbot-appid"
              type="text"
              className={css.input}
              value={draftAppId}
              placeholder={SETTINGS_COPY['qqbot.appIdPlaceholder']}
              disabled={disabled || busy !== null}
              onChange={edit(setAppId)}
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="qqbot-secret">{SETTINGS_COPY['qqbot.secret']}</label>
            <input
              id="qqbot-secret"
              type="password"
              className={css.input}
              value={secret}
              placeholder={SETTINGS_COPY['qqbot.secretPlaceholder']}
              autoComplete="off"
              disabled={disabled || busy !== null}
              onChange={edit(setSecret)}
            />
            <p className={css.fieldHint}>{SETTINGS_COPY['qqbot.secretHint']}</p>
            <div className={css.secretState}>{secretReading}</div>
          </div>
          <div className={css.actions}>
            <button
              type="button"
              className={css.primary}
              disabled={disabled || busy !== null || draftAppId.trim().length === 0}
              onClick={save}
            >
              {busy === 'save' ? SETTINGS_COPY['qqbot.saving'] : SETTINGS_COPY['qqbot.save']}
            </button>
            <button
              type="button"
              className={css.ghost}
              disabled={disabled || busy !== null || draftAppId.trim().length === 0 || secret.length === 0}
              title={secret.length === 0 ? '测试连接需要填写密钥（已存密钥不会回显）' : undefined}
              onClick={probe}
            >
              {busy === 'test' ? SETTINGS_COPY['qqbot.testing'] : SETTINGS_COPY['qqbot.test']}
            </button>
          </div>
          {test !== null && (
            <p className={css.result} data-ok={test.ok ? 'true' : 'false'}>
              {test.ok
                ? `${SETTINGS_COPY['qqbot.testOk']}：${test.gateway ?? ''}`
                : `${SETTINGS_COPY['qqbot.testFail']}：${test.message ?? ''}`}
            </p>
          )}
          <p className={css.note}>{SETTINGS_COPY['qqbot.liveNote']}</p>
        </>
      ))}
    </SettingsSection>
  );
}
