/**
 * The QQ 机器人 page's connection information, pinned where it is decidable.
 *
 * The user's report was that the page could not be read: 「无法显示连接信息，用户
 * 也分不清连没连上」. So the two things asserted here are exactly the two the page
 * was missing — a state that distinguishes 未启用 / 连接中 / 已连接 / 失败, and the
 * connection's own facts (who the bot is, how much this run has carried). The
 * readings are pure functions, so each branch is driven without a DOM, and the
 * section is rendered to a string for the two claims that are about what a reader
 * sees (or must NOT see).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QqbotSection } from '../src/settings/QqbotSection.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import {
  botNameReading,
  connectionDetail,
  connectionState,
  countsReading,
  runningReading,
  type QqbotViewSnapshot,
} from '../src/settings/qqbot-view.js';

const noop = (): void => undefined;

/** The connected snapshot: a live channel with a name and a couple of messages. */
const LIVE: QqbotViewSnapshot = {
  appId: '1024',
  hasClientSecret: true,
  running: true,
  live: {
    connecting: false,
    pluginEnabled: true,
    botName: 'nova 助手',
    stats: { received: 3, replied: 2, lastReceivedAt: 1_700_000_000_000 },
  },
};

describe('the state a reader is shown', () => {
  it('tells the four answers apart, in the order that matters to the reader', () => {
    // The reported confusion in one assertion: 「已配置」 used to be the whole
    // answer, and a reader who saw it assumed the bot was serving.
    expect(connectionState({ hasClientSecret: false })).toBe('off');
    expect(connectionState({ appId: '1', hasClientSecret: true })).toBe('idle');
    expect(connectionState({ appId: '1', running: true })).toBe('live');
    expect(connectionState({ appId: '1', live: { connecting: true } })).toBe('connecting');
    expect(connectionState({ appId: '1', live: { connecting: false, pluginEnabled: true, failure: 'boom' } })).toBe('failed');
    // The plugin's own switch outranks everything: while it is off the tool is
    // not even registered, so a live socket would still not be serving.
    expect(connectionState({ appId: '1', running: true, live: { connecting: false, pluginEnabled: false } })).toBe('disabled');
    // 运行中's own wording stays on the LIVE state, not on 已配置.
    expect(runningReading({ appId: '1', running: true })).toBe(SETTINGS_COPY['qqbot.statusLive']);
  });

  it('states the host\'s own reason for a failure, not a paraphrase', () => {
    const snapshot: QqbotViewSnapshot = {
      appId: '1',
      live: { connecting: false, pluginEnabled: true, failure: 'QQ 机器人连接失败：invalid appid or secret' },
    };
    expect(connectionDetail(snapshot)).toBe('QQ 机器人连接失败：invalid appid or secret');
    // Nothing to add when nothing failed — the state line is the whole sentence.
    expect(connectionDetail({ appId: '1', running: true })).toBeNull();
  });

  it('never invents a bot name, and says which kind of missing it is', () => {
    // Asked and unanswered is a gateway answer; never-asked is a channel that is
    // not running. Both are shown as such — neither is a name.
    expect(botNameReading(LIVE)).toBe('nova 助手');
    expect(botNameReading({ appId: '1', live: { connecting: false, botName: null } })).toBe(SETTINGS_COPY['qqbot.botNameUnknown']);
    expect(botNameReading({ appId: '1', live: { connecting: false } })).toBe(SETTINGS_COPY['qqbot.botNameUnasked']);
    // A host that cannot tell gets no row at all rather than an empty one.
    expect(botNameReading({ appId: '1' })).toBeNull();
  });

  it('counts this run, and says so in the same sentence', () => {
    // 口径 is the point: the counter lives in the process, so 「本次运行」 has to
    // be part of the reading — a bare number reads as a lifetime total.
    const counts = countsReading(LIVE, 1_700_000_060_000);
    expect(counts).toContain('3');
    expect(counts).toContain('2');
    expect(counts).toContain('本次运行');
    // The newest message's clock comes from the host's own timestamp.
    expect(counts).toContain(SETTINGS_COPY['qqbot.lastMessage'].split('{time}')[0] ?? '');
    // No count from the host → no row, never a fabricated zero.
    expect(countsReading({ appId: '1' }, 0)).toBeNull();
  });
});

describe('what the page draws', () => {
  it('shows the connection information once the channel is live', () => {
    const html = renderToStaticMarkup(
      <QqbotSection snapshot={LIVE} test={null} disabled={false} manageError={null} send={noop} onClearTest={noop} />,
    );
    expect(html).toContain(SETTINGS_COPY['qqbot.statusLive']);
    expect(html).toContain(SETTINGS_COPY['qqbot.botName']);
    expect(html).toContain('nova 助手');
    expect(html).toContain(SETTINGS_COPY['qqbot.countsTerm']);
    expect(html).toContain(SETTINGS_COPY['qqbot.countsScope']);
  });

  it('says the plugin is off, offers the switch, and draws no fields at all', () => {
    // The other half of the report: a switched-off plugin used to render the same
    // usable-looking form as a working one. 「不要显示一堆看起来能用的字段」.
    const html = renderToStaticMarkup(
      <QqbotSection
        snapshot={{ appId: '1024', hasClientSecret: true, live: { connecting: false, pluginEnabled: false } }}
        test={null}
        disabled={false}
        manageError={null}
        send={noop}
        onClearTest={noop}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['qqbot.stateDisabled']);
    expect(html).toContain(SETTINGS_COPY['qqbot.enable']);
    // Not one credential field, no probe, no counters.
    expect(html).not.toContain(SETTINGS_COPY['qqbot.appId']);
    expect(html).not.toContain(SETTINGS_COPY['qqbot.secretHint']);
    expect(html).not.toContain(SETTINGS_COPY['qqbot.test']);
    expect(html).not.toContain(SETTINGS_COPY['qqbot.countsTerm']);
  });
});
