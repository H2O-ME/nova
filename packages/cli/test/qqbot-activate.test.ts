/**
 * 「保存凭据之后，通道真的跑起来」——阶段 A 的验收探针。
 *
 * 用户报的缺陷是「即使输入设置好连接参数也不会实际运行」：凭据存进了文件，而通道是在
 * 启动时按**当时的**文件内容建好的，于是保存这个动作本身什么也没发生，必须重启才生效。
 * 这里用**真实的**文件与**真实的**桥驱动那条保存后的路径，只把网络那一层换成假的。
 *
 * 断言刻意只有一条：空配置 → 保存凭据 → **不重启** → 通道已在跑。其余细节（token 缓存、
 * 去重、被动窗口）各有自己的测试，这里只钉「存了就能用」这件事本身。
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { userConfigPath } from '@nova-agent/core';
import { saveQqBotConfig } from '../src/config-write.js';
import { startQqBotBridge, type QqBotBridge } from '../src/qqbot-bridge.js';
import { qqBotRuntimeSeam } from '../src/qqbot-activate.js';
/** A home directory holding `raw` at ~/.nova/config.json, or no file at all. */
async function withHome(raw: string | undefined): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-qqbot-save-'));
  if (raw !== undefined) {
    await mkdir(path.join(home, '.nova'), { recursive: true });
    await writeFile(userConfigPath(home), raw, 'utf8');
  }
  return home;
}

describe('saving qqbot credentials starts the channel', () => {
  it('goes from an empty config to a running channel without a restart', async () => {
    // The whole point: nothing on disk when the process boots (the first-run state,
    // and the state the operator complains about), then the settings page writes
    // the credentials while the process runs.
    const home = await withHome(undefined);
    const prevProfile = process.env['USERPROFILE'];
    const prevHome = process.env['HOME'];
    process.env['USERPROFILE'] = home;
    process.env['HOME'] = home;
    try {
      // The channel is built BEFORE the credentials exist: that is the boot order,
      // and the reason a boot-time credential snapshot never sees them.
      //
      // The gateway URL is NOT injected, deliberately: the default resolver fetches
      // a token first, and the token request is where the credentials are actually
      // read. Injecting a URL would bypass the token grant and let this test pass
      // even if `start()` never re-read the file — i.e. it would not be a probe of
      // late binding at all. So the fake fetch records what it was asked for.
      const tokenRequests: string[] = [];
      const bridge = await startQqBotBridge(() => undefined, {
        fetchFn: (url, init) => {
          if (url.includes('getAppAccessToken')) {
            tokenRequests.push(init?.body ?? '');
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'tok', expires_in: '7200' }) });
          }
          // The gateway lookup: only reachable once a token exists.
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ url: 'wss://gateway.test' }) });
        },
        socketFactory: () =>
          Promise.resolve({
            send: () => undefined,
            close: () => undefined,
            onMessage: () => undefined,
            onClose: () => undefined,
          }),
      });
      const enabled: string[] = [];
      const seam = qqBotRuntimeSeam(bridge, () => ({
        setPluginEnabled: (name, on) => {
          if (on) enabled.push(name);
          return Promise.resolve([]);
        },
      }));
      expect(seam.running()).toBe(false);
      // Nothing was dialed at boot, so no credential was ever read.
      expect(tokenRequests).toEqual([]);

      // The save writes exactly what the `save_qqbot` frame handler writes, then
      // the shell's post-save step runs — no restart anywhere in between.
      await saveQqBotConfig({ appId: '1024', clientSecret: 'sekret' }, home);
      const note = await seam.afterSave();

      expect({ note, running: seam.running(), enabled }).toEqual({
        note: undefined,
        running: true,
        enabled: ['qqbot'],
      });
      // The credentials reached the wire, and they are the ones just saved: this is
      // what "late-bound" means, and it is the half an injected gateway URL hides.
      expect(tokenRequests).toEqual([JSON.stringify({ appId: '1024', clientSecret: 'sekret' })]);
    } finally {
      if (prevProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = prevProfile;
      if (prevHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = prevHome;
    }
  });
});

describe('the connection reading the settings page shows', () => {
  it('takes the switch from the kernel roster and everything else from the channel', async () => {
    // The reported defect: the page could not tell「插件关着」、「连不上」and
    // 「连着」apart. `connection()` is the one answer that carries all three, so
    // the mapping is pinned here with a fake channel — the real one is asserted
    // in the case below.
    const fake: QqBotBridge = {
      plugin: { name: 'qqbot', activate: () => undefined },
      start: () => Promise.resolve(undefined),
      running: () => true,
      stop: () => undefined,
      reading: () => Promise.resolve({
        received: 7,
        replied: 5,
        lastReceivedAt: 1_700_000_000_000,
        connecting: false,
        botName: 'nova 助手',
      }),
    };
    let enabled = false;
    const seam = qqBotRuntimeSeam(fake, () => ({
      setPluginEnabled: () => Promise.resolve([]),
      roster: () => [{ name: 'qqbot', enabled }],
    }));

    expect(await seam.connection()).toMatchObject({
      pluginEnabled: false,
      connecting: false,
      botName: 'nova 助手',
      received: 7,
      replied: 5,
    });
    // The switch is the KERNEL's fact, not the channel's: read from the roster,
    // so 插件管理 and this page can never disagree about it.
    enabled = true;
    expect((await seam.connection()).pluginEnabled).toBe(true);
  });

  it('records why the real channel did not start, for the page to show', async () => {
    // The page's 「连接失败」 needs the host's own sentence. `start()` returns it,
    // and the reader has to be able to read it back later — the page asks on
    // its next open, long after the call that produced it.
    const bridge = await startQqBotBridge(() => undefined);
    const note = await bridge.start();
    expect(note).toMatch(/未配置/u);
    expect(await bridge.reading()).toMatchObject({ connecting: false, failure: note, received: 0, replied: 0 });
  });

  it('hangs up the bridge when the shell switches the plugin off', () => {
    // Turning the row OFF is a shell action, but the socket lives in the BRIDGE
    // — the roster flip only unregisters tools. The seam is the one path from
    // the switch to the hang-up, so it must reach `stop()` and nothing else.
    const stops: string[] = [];
    const seam = qqBotRuntimeSeam(
      {
        plugin: { name: 'qqbot', activate: () => undefined },
        start: () => Promise.resolve(undefined),
        running: () => true,
        stop: () => {
          stops.push('qqbot');
        },
        reading: () => Promise.resolve({ received: 0, replied: 0, connecting: false }),
      },
      () => undefined,
    );
    seam.stop();
    expect(stops).toEqual(['qqbot']);
  });
});
