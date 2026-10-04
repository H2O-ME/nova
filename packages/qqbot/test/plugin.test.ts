/**
 * 插件那一半的契约：**没有可用凭据就什么都不启动**，而设置页照常应答。
 *
 * 这个文件钉的正是本次重构要修的那件事——「宿主留着一份候选对象就拨号」。在这里，
 * 载荷里没有可用凭据时插件必须既不建通道（`runningQqBotChannel()` 为 undefined）、
 * 也不碰 session 服务（假实现会在被调用时抛），但它的 RPC 命名空间必须还在：那是
 * 操作者把凭据填进去的唯一入口。
 *
 * 第二条钉的是密钥纪律与「失败是读数」：给一份字面密钥时通道会去拨号（fetch 被替换成
 * 立刻失败的假实现，测试不联网），失败必须落在**页面上**而不是让行激活失败——行失败
 * 会连设置页一起弄丢。同一份描述符里，密钥字段永不带出那个字面值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Context,
  pluginConfig as pluginConfigKey,
  pluginRpc as pluginRpcKey,
  sessions as sessionsKey,
  type PluginPageDescriptor,
  type PluginRpc,
  type SessionService,
} from '@nova-agent/core';
import { pluginRpcProvider, toolboxPlugin } from '@nova-agent/plugins';
import plugin, { QQ_BOT_PLUGIN_NAME, runningQqBotChannel } from '../src/plugin.js';

/** 会话服务：被调用即说明「没有凭据也开了会话」，那是 bug。 */
function fakeSessions(): SessionService {
  return {
    current: () => undefined,
    open: () => Promise.reject(new Error('the channel must not open a session without credentials')),
    activate: () => undefined,
  };
}

interface Mounted {
  rpc: PluginRpc;
  saved: { id: string; patch: { enabled?: boolean; config?: unknown } }[];
  dispose(): Promise<void>;
}

/** 装配一次这一行的激活；`config` 是行自己的设置（由 `Config` 校验）。 */
async function mount(config: unknown): Promise<Mounted> {
  const root: Context = Context.createRoot();
  // The same two providers every real tree loads first: the tool registry (the
  // channel's tool registers into it) and the plugin-RPC namespace.
  await root.plugin(toolboxPlugin).ready;
  await root.plugin(pluginRpcProvider()).ready;
  const saved: Mounted['saved'] = [];
  root.provide(pluginConfigKey, {
    setEntry: async (id, patch) => {
      saved.push({ id, patch });
    },
  });
  root.provide(sessionsKey, fakeSessions());
  const fiber = root.plugin(plugin, config);
  await fiber.ready;
  mounted = { rpc: root.must(pluginRpcKey), saved, dispose: () => fiber.dispose() };
  return mounted;
}

let mounted: Mounted | undefined;

afterEach(async () => {
  // The channel is process-wide state; leaving it registered would leak into the
  // next test (and that is exactly what the plugin's own effect must undo).
  await mounted?.dispose();
  mounted = undefined;
  expect(runningQqBotChannel()).toBeUndefined();
});

const page = (value: unknown): PluginPageDescriptor => value as PluginPageDescriptor;

describe('qqbot plugin without credentials', () => {
  it('starts nothing at all, and still answers its settings page', async () => {
    const active = await mount({});
    expect(runningQqBotChannel()).toBeUndefined();

    const descriptor = page(await active.rpc.invoke(QQ_BOT_PLUGIN_NAME, 'page', undefined));
    expect(descriptor.title).toBe('QQ 机器人');
    expect(descriptor.status?.some((row) => row.value.includes('还没有填写 AppID'))).toBe(true);
    // The fields ARE there — that is the whole point of answering without a channel.
    expect(descriptor.fields?.map((field) => field.key)).toEqual(['appId', 'clientSecret']);
    expect(descriptor.fields?.find((field) => field.key === 'clientSecret')?.kind).toBe('secret');
  });

  it('refuses an unknown setting by name instead of dropping it', async () => {
    const active = await mount({});
    await expect(active.rpc.invoke(QQ_BOT_PLUGIN_NAME, 'save', { fields: { appId: '1', nope: 'x' } }))
      .rejects.toThrow(/unknown setting "nope"/);
    expect(active.saved).toHaveLength(0);
  });

  it('saves through the plugin-config port and keeps an {env:NAME} reference verbatim', async () => {
    const active = await mount({});
    const descriptor = page(
      await active.rpc.invoke(QQ_BOT_PLUGIN_NAME, 'save', {
        fields: { appId: '1024', clientSecret: '{env:QQ_SECRET}' },
      }),
    );
    expect(active.saved).toEqual([
      {
        id: QQ_BOT_PLUGIN_NAME,
        patch: { enabled: true, config: { appId: '1024', clientSecret: '{env:QQ_SECRET}' } },
      },
    ]);
    // The reference is inert text the operator wrote: it may round-trip.
    expect(descriptor.fields?.find((field) => field.key === 'clientSecret')?.value).toBe('{env:QQ_SECRET}');
  });

  it('reports an unresolved reference as a problem instead of dialing with a placeholder', async () => {
    const active = await mount({ appId: '1024', clientSecret: '{env:QQ_SECRET_NOT_SET_ANYWHERE}' });
    expect(runningQqBotChannel()).toBeUndefined();
    const descriptor = page(await active.rpc.invoke(QQ_BOT_PLUGIN_NAME, 'page', undefined));
    expect(descriptor.status?.some((row) => row.value.includes('QQ_SECRET_NOT_SET_ANYWHERE'))).toBe(true);
  });
});

describe('qqbot plugin with credentials', () => {
  it('never echoes a literal secret and turns a failed dial into a page reading', async () => {
    // The dial is a real code path; only the transport is faked, so a 401 lands
    // where a bad secret lands in production — as a reason, not as a crash.
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );
    try {
      const active = await mount({ appId: '1024', clientSecret: 'literal-secret-xyz' });
      expect(runningQqBotChannel()).toBeDefined();
      // Let the async dial settle before reading the page.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const descriptor = page(await active.rpc.invoke(QQ_BOT_PLUGIN_NAME, 'page', undefined));
      const secret = descriptor.fields?.find((field) => field.key === 'clientSecret');
      expect(secret?.value).toBeUndefined();
      expect(JSON.stringify(descriptor)).not.toContain('literal-secret-xyz');
      expect(descriptor.status?.some((row) => row.value.includes('连接失败'))).toBe(true);
      // The namespace survived the failed dial: that page is how it gets fixed.
      expect(descriptor.actions?.map((action) => action.id)).toEqual(['test']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
