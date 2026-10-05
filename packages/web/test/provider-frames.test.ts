/**
 * The provider switch TRANSACTION, driven one frame at a time.
 *
 * The transaction has two entries (`set_provider` and the auto-apply after
 * `save_providers`) and one shared half (`applyProvider`); these tests pin the
 * seams each half can silently get wrong:
 *
 *  - the pointer is persisted BEFORE the live client moves (a crash between the
 *    two must leave the file ahead, not behind — a restart then applies what was
 *    saved);
 *  - "already in force" compares against the LIVE id, not the file's
 *    `activeProvider` (the file can name an id the process never applied);
 *  - an `{env:NAME}` refusal names the variable and never touches the client;
 *  - the retarget carries the row's own sampling fields (temperature/maxTokens)
 *    — dropping them on the persist mapping silently reset the operator's
 *    sampling knobs on every switch;
 *  - a failed apply after a successful save answers with BOTH the saved state
 *    and the reason it is not yet in force.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatProvider } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { handleProviderFrame, type ProviderHost, type StoredKeyResolution } from '../src/provider-frames.js';
import type { WireProviderInput, WireProviderRow } from '../src/provider-wire.js';
import type { WsConnection } from '../src/ws.js';

class FakeConn implements WsConnection {
  readonly frames: Array<Record<string, unknown>> = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as Record<string, unknown>);
  }
  close(): void {}
}

const row = (over: Partial<WireProviderRow> = {}): WireProviderRow => ({
  id: 'p1',
  baseURL: 'https://p1.test/v1',
  hasApiKey: true,
  models: [],
  ...over,
});

interface EndpointCall {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/** A live client with `setEndpoint` (the switchable shell provider's real half). */
function liveProvider(fail = false): { provider: ChatProvider; calls: EndpointCall[] } {
  const calls: EndpointCall[] = [];
  const provider: ChatProvider & {
    setEndpoint(endpoint: EndpointCall): void;
    listModels(timeoutMs?: number): Promise<string[]>;
  } = {
    async *stream() {
      yield { type: 'finish', finishReason: 'stop' };
    },
    setEndpoint(endpoint: EndpointCall): void {
      if (fail) throw new Error('no client behind the placeholder');
      calls.push(endpoint);
    },
    listModels: async () => ['m'],
  };
  return { provider, calls };
}

function rig(opts: { rows?: WireProviderRow[]; activeId?: string; key?: StoredKeyResolution; liveId?: string; fail?: boolean } = {}) {
  const { provider, calls } = liveProvider(opts.fail);
  const persisted: Array<{ entries: readonly WireProviderInput[]; activeId?: string }> = [];
  let liveId: string | undefined = opts.liveId;
  const host: ProviderHost = {
    kernel: { llm: { provider } } as unknown as Kernel,
    persistProviders: (entries, activeId) => {
      persisted.push({ entries, activeId });
    },
    readProviders: async () => {
      // The file is the authority and a persist changes it: answer with the
      // LAST persisted pointer, the way a real re-read would.
      const activeId = persisted.at(-1)?.activeId ?? opts.activeId;
      return {
        providers: opts.rows ?? [row()],
        ...(activeId !== undefined ? { activeId } : {}),
      };
    },
    storedApiKey: async () => opts.key ?? { key: 'sk-stored' },
    configuredModel: () => 'm',
    liveProviderId: () => liveId,
    setLiveProviderId: (id) => {
      liveId = id;
    },
    refreshSeat: vi.fn(),
  };
  return { host, calls, persisted, liveId: () => liveId };
}

async function setProvider(host: ProviderHost, id: string): Promise<FakeConn> {
  const conn = new FakeConn();
  await handleProviderFrame(conn, { type: 'set_provider', id }, host);
  return conn;
}

describe('set_provider — the switch transaction', () => {
  it('persists the pointer first, retargets with the row’s sampling fields, tracks the live id', async () => {
    const rig1 = rig({
      rows: [row({ temperature: 0.3, maxTokens: 4096 }), row({ id: 'p2', baseURL: 'https://p2.test/v1' })],
      activeId: 'p2',
    });
    const conn = await setProvider(rig1.host, 'p1');
    expect(rig1.persisted).toEqual([expect.objectContaining({ activeId: 'p1' })]);
    expect(rig1.calls).toEqual([
      { baseURL: 'https://p1.test/v1', apiKey: 'sk-stored', model: 'm', temperature: 0.3, maxTokens: 4096 },
    ]);
    expect(rig1.liveId()).toBe('p1');
    expect(rig1.host.refreshSeat).toHaveBeenCalled();
    expect(conn.frames.at(-1)).toMatchObject({ type: 'providers', activeId: 'p1' });
  });

  it('answers state without churn when the LIVE client already serves the row', async () => {
    const rig1 = rig({ liveId: 'p1', activeId: 'p2' });
    const conn = await setProvider(rig1.host, 'p1');
    expect(rig1.persisted).toEqual([]);
    expect(rig1.calls).toEqual([]);
    expect(conn.frames).toEqual([expect.objectContaining({ type: 'providers', activeId: 'p2' })]);
  });

  it('refuses an unresolved env reference BY NAME and never touches the client', async () => {
    const rig1 = rig({ key: { problem: 'env-unset', envName: 'MY_KEY' } });
    const conn = await setProvider(rig1.host, 'p1');
    const error = conn.frames.find((f) => f['type'] === 'error');
    expect(String(error?.['message'])).toContain('{env:MY_KEY}');
    expect(rig1.calls).toEqual([]);
    expect(rig1.persisted).toEqual([]);
    expect(rig1.liveId()).toBeUndefined();
  });

  it('refuses a provider with no stored key', async () => {
    const rig1 = rig({ key: { problem: 'missing' } });
    const conn = await setProvider(rig1.host, 'p1');
    const error = conn.frames.find((f) => f['type'] === 'error');
    expect(String(error?.['message'])).toContain('还没有填写 API 密钥');
    expect(rig1.calls).toEqual([]);
  });

  it('keeps the saved pointer when the apply fails, and says the process did not move', async () => {
    const rig1 = rig({ fail: true });
    const conn = await setProvider(rig1.host, 'p1');
    expect(rig1.persisted).toHaveLength(1);
    expect(rig1.liveId()).toBeUndefined();
    // The state frame (the file's truth) comes BEFORE the error frame (the
    // process's delta): a page that renders both in order shows 已保存 + 未生效.
    expect(conn.frames.map((f) => f['type'])).toEqual(['providers', 'error']);
    expect(String(conn.frames[1]?.['message'])).toContain('本次进程未生效');
  });
});

describe('save_providers — the auto-apply', () => {
  it('applies a saved pointer the process is not serving yet', async () => {
    const rig1 = rig();
    const conn = new FakeConn();
    await handleProviderFrame(
      conn,
      { type: 'save_providers', providers: [{ id: 'p1', baseURL: 'https://p1.test/v1' }], activeId: 'p1' },
      rig1.host,
    );
    expect(rig1.calls).toHaveLength(1);
    expect(rig1.liveId()).toBe('p1');
    expect(rig1.host.refreshSeat).toHaveBeenCalled();
    expect(conn.frames.at(-1)).toMatchObject({ type: 'providers', activeId: 'p1' });
  });

  it('does not re-apply a pointer the live client already serves', async () => {
    const rig1 = rig({ liveId: 'p1' });
    const conn = new FakeConn();
    await handleProviderFrame(
      conn,
      { type: 'save_providers', providers: [{ id: 'p1', baseURL: 'https://p1.test/v1' }], activeId: 'p1' },
      rig1.host,
    );
    expect(rig1.calls).toEqual([]);
    expect(conn.frames).toEqual([expect.objectContaining({ type: 'providers' })]);
  });

  it('reports a failed auto-apply without unsaving', async () => {
    const rig1 = rig({ fail: true });
    const conn = new FakeConn();
    await handleProviderFrame(
      conn,
      { type: 'save_providers', providers: [{ id: 'p1', baseURL: 'https://p1.test/v1' }], activeId: 'p1' },
      rig1.host,
    );
    expect(rig1.liveId()).toBeUndefined();
    expect(conn.frames.map((f) => f['type'])).toEqual(['providers', 'error']);
    expect(String(conn.frames[1]?.['message'])).toContain('未生效');
  });
});

describe('probe_provider — the stored key it reuses', () => {
  it('sends the RESOLVED stored key, not the raw file text', async () => {
    const rig1 = rig({ rows: [row({ id: 'p1', baseURL: 'https://p1.test/v1' })] });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const conn = new FakeConn();
      await handleProviderFrame(conn, { type: 'probe_provider', baseURL: 'https://p1.test/v1' }, rig1.host);
      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> } | undefined;
      expect(init?.headers['authorization']).toBe('Bearer sk-stored');
      expect(conn.frames.at(-1)).toMatchObject({ type: 'provider_probe', ok: true, models: ['m'] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
