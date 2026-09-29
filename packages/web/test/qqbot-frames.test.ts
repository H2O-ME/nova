/**
 * The qqbot frame family (`qqbot-frames.ts`): the connection snapshot, the save
 * and the probe.
 *
 * The claim this file exists for is the one the operator reported: **a save must
 * make the channel run**, not merely store credentials. `recheckQqBot` answers
 * "is the stored text usable", which is a question about the file; the channel
 * was built at boot, when the file was still empty, so a save that stops at the
 * writer leaves a configured-looking bot that answers nothing.
 *
 * Driven through the frame handler with a fake runtime, so the assertion is about
 * the ORDER and the ANSWER the panel receives, not about any real socket.
 */
import { describe, expect, it } from 'vitest';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import { handleQqBotFrame, type QqBotSnapshot } from '../src/qqbot-frames.js';
import type { WsConnection } from '../src/ws.js';

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  last<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame?.type === type) return frame as Extract<ServerFrame, { type: T }>;
    }
    return undefined;
  }
}

interface Rig {
  conn: FakeConn;
  /** What the save wrote (the "config file"). */
  written: { appId?: string; clientSecret?: string }[];
  /** Everything the runtime was asked to do, in order. */
  calls: string[];
  snapshot: () => QqBotSnapshot;
  save(frame: Extract<ClientFrame, { type: 'save_qqbot' }>): Promise<void>;
}

function makeRig(opts: { running?: boolean; afterSave?: string | undefined } = {}): Rig {
  const conn = new FakeConn();
  const written: Rig['written'] = [];
  const calls: string[] = [];
  let snapshot: QqBotSnapshot = {};
  return {
    conn,
    written,
    calls,
    snapshot: () => snapshot,
    save: async (frame) => {
      await handleQqBotFrame(conn, frame, {
        persistQqBot: (saved) => {
          written.push(saved);
        },
        qqBotSnapshot: () => snapshot,
        setQqBotSnapshot: (next) => {
          snapshot = next;
        },
        testQqBot: undefined,
        qqBotRuntime: {
          running: () => {
            calls.push('running');
            return opts.running === true;
          },
          afterSave: () => {
            calls.push('afterSave');
            return Promise.resolve(opts.afterSave);
          },
        },
      });
    },
  };
}

describe('qqbot frames', () => {
  it('runs the live channel on save, and reports it as running', async () => {
    // The reported defect, at the frame: the save reached the writer and stopped
    // there, so the answer read 「已配置」 while nothing was listening.
    const rig = makeRig({ running: true });
    await rig.save({ type: 'save_qqbot', appId: '1024', clientSecret: 'sekret' });

    // The save must have DONE something beyond storing: this is the whole fix.
    expect(rig.calls).toContain('afterSave');
    // And the answer is the live state, so the page draws 运行中 rather than
    // 已配置但未启动.
    expect(rig.conn.last('qqbot')?.running).toBe(true);
    expect(rig.written).toEqual([{ appId: '1024', clientSecret: 'sekret' }]);
  });

  it('reports running over the stored snapshot when a channel is live', async () => {
    const rig = makeRig({ running: true });
    await handleQqBotFrame(rig.conn, { type: 'qqbot' }, {
      persistQqBot: undefined,
      qqBotSnapshot: () => ({ appId: '9', hasClientSecret: true }),
      setQqBotSnapshot: () => undefined,
      testQqBot: undefined,
      qqBotRuntime: { running: () => true, afterSave: () => Promise.resolve(undefined) },
    });
    expect(rig.conn.last('qqbot')).toMatchObject({ appId: '9', running: true });
  });

  it('leaves the field off entirely with no channel wired', async () => {
    // No runtime means "this surface cannot tell", which must stay distinguishable
    // from "not running": the page falls back to exactly its pre-existing read.
    const rig = new FakeConn();
    await handleQqBotFrame(rig, { type: 'qqbot' }, {
      persistQqBot: undefined,
      qqBotSnapshot: () => ({ appId: '9' }),
      setQqBotSnapshot: () => undefined,
      testQqBot: undefined,
    });
    expect(rig.last('qqbot')).not.toHaveProperty('running');
  });

  it('surfaces why the channel did not start instead of claiming success', async () => {
    // A save can be stored and still not connect (a wrong secret, an unset
    // variable). That reason REPLACES the boot-time complaint: it is a verdict on
    // the file as it is now.
    const rig = makeRig({ running: false, afterSave: 'QQ 机器人连接失败：bad token' });
    await rig.save({ type: 'save_qqbot', appId: '1024', clientSecret: 'bad' });
    const answer = rig.conn.last('qqbot');
    expect(answer?.running).toBe(false);
    expect(answer?.error).toBe('QQ 机器人连接失败：bad token');
  });

  it('carries the live reading when the host can produce one', async () => {
    // The page's connection information — who the bot is, what it has carried,
    // and whether the plugin is even on — travels on this frame and nowhere
    // else, so a snapshot without it is a page that cannot answer any of it.
    const rig = new FakeConn();
    await handleQqBotFrame(rig, { type: 'qqbot' }, {
      persistQqBot: undefined,
      qqBotSnapshot: () => ({ appId: '9', hasClientSecret: true }),
      setQqBotSnapshot: () => undefined,
      testQqBot: undefined,
      qqBotRuntime: {
        running: () => true,
        afterSave: () => Promise.resolve(undefined),
        connection: () => Promise.resolve({
          connecting: false,
          pluginEnabled: true,
          botName: 'nova 助手',
          stats: { received: 3, replied: 2, lastReceivedAt: 1_700_000_000_000 },
        }),
      },
    });
    expect(rig.last('qqbot')?.live).toEqual({
      connecting: false,
      pluginEnabled: true,
      botName: 'nova 助手',
      stats: { received: 3, replied: 2, lastReceivedAt: 1_700_000_000_000 },
    });
  });
});
