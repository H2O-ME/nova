/**
 * The settings page's provider (BYOK) frames: read the list, replace it, switch
 * the endpoint in force, and probe a candidate.
 *
 * Same discipline as the sibling config families — **persist first, then reload,
 * then answer with state** — with one step they do not have: switching the
 * provider must retarget the ONE live client (`ChatProvider.setEndpoint`) and
 * reconcile the model id against the NEW endpoint's own catalog. That is why this
 * file exists rather than the family living in `model-config-frames.ts`: a probe
 * is a network call whose failure is an answer, and a switch is a mutation of
 * kernel state that a model-list edit never performs.
 */
import { errMessage, resolveModelId, type ChatProvider } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame, WireProviderInput, WireProviderRow } from './protocol.js';
import { MODEL_LIST_FAILED } from './model-seat.js';
import type { WsConnection } from './ws.js';

/** One stored provider row, as the settings page reads it. */
export interface StoredProviderRow extends WireProviderRow {}

/** The provider snapshot as the page sees it. */
export interface ProvidersSnapshot {
  providers: readonly StoredProviderRow[];
  activeId?: string;
}

/** What the provider frames need from the controller. */
export interface ProviderHost {
  kernel: Kernel;
  /** Write the list; absent with no durable home, and the save then refuses. */
  persistProviders: ((entries: readonly WireProviderInput[], activeId: string | undefined) => void | Promise<void>) | undefined;
  /** Re-read the list from disk (the file is the authority, the page is not). */
  readProviders: () => Promise<ProvidersSnapshot>;
  /**
   * Resolve the stored key for one provider id, so a probe or a switch can reuse
   * it without the browser ever holding it. Returns undefined when nothing is
   * stored. Async because it is a read of the config file, not a cached field.
   */
  storedApiKey: (id: string) => string | undefined | Promise<string | undefined>;
  /** The model id to carry when retargeting (config `provider.model`). */
  configuredModel: () => string | undefined;
  /** Tell every client the seat moved (the kernel event, then a fresh state). */
  refreshSeat: () => void;
}

/**
 * The live client a switch retargets, read off the `llm` service.
 *
 * Read LIVE rather than captured: the service is the single place every session
 * and every nested subagent gets its provider from, so retargeting the instance
 * it hands out is what makes a switch reach all of them at once. `setEndpoint`
 * may be absent on a scripted or third-party provider — that absence is the
 * refusal, reported with a reason instead of a silent no-op.
 */
function endpointClient(host: ProviderHost):
  | (ChatProvider & { setEndpoint(endpoint: { baseURL: string; apiKey: string; model: string }): void })
  | undefined {
  const provider = host.kernel.llm.provider as ChatProvider & {
    setEndpoint?(endpoint: { baseURL: string; apiKey: string; model: string }): void;
  };
  return typeof provider.setEndpoint === 'function'
    ? (provider as ChatProvider & { setEndpoint(endpoint: { baseURL: string; apiKey: string; model: string }): void })
    : undefined;
}

/** A `providers` frame from a snapshot. */
function providersFrame(snapshot: ProvidersSnapshot): ReturnType<typeof serialize> {
  return serialize({
    type: 'providers',
    providers: snapshot.providers,
    ...(snapshot.activeId !== undefined ? { activeId: snapshot.activeId } : {}),
  });
}

/**
 * Ask one candidate endpoint for its catalog (`GET {baseURL}/models`).
 *
 * Deliberately NOT a `ChatProvider` instance: this may be an endpoint the
 * operator has typed but not saved, so building the real session client for it
 * would apply a choice nobody made. A bare `fetch` of the one route is the whole
 * probe, and it stores nothing.
 * @param baseURL - the candidate endpoint.
 * @param apiKey - the candidate key, when the operator typed one.
 * @returns the ids it published.
 */
export async function probeProvider(baseURL: string, apiKey: string | undefined): Promise<string[]> {
  const target = new URL('models', baseURL.endsWith('/') ? baseURL : `${baseURL}/`);
  const response = await fetch(target, {
    headers: apiKey === undefined || apiKey.length === 0 ? {} : { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${MODEL_LIST_FAILED}（HTTP ${String(response.status)}）`);
  }
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const ids = (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * Route one provider frame. The caller guarantees `frame.type` is one of the
 * four, and the validator guarantees the payload shapes.
 * @param client - the requesting socket.
 * @param frame - the validated frame.
 * @param host - the controller's provider seams.
 */
export async function handleProviderFrame(
  client: WsConnection,
  frame: Extract<
    ClientFrame,
    | { type: 'list_providers' }
    | { type: 'save_providers' }
    | { type: 'set_provider' }
    | { type: 'probe_provider' }
  >,
  host: ProviderHost,
): Promise<void> {
  try {
    switch (frame.type) {
      case 'list_providers': {
        client.send(providersFrame(await host.readProviders()));
        break;
      }
      case 'save_providers': {
        if (host.persistProviders === undefined) {
          client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
          break;
        }
        // A run in flight is not a reason to refuse: the list is read at boot and
        // when a menu opens, so writing it changes the NEXT request rather than
        // the one being built. The SAME reasoning does not extend to
        // `set_provider`, which does refuse (see below).
        await host.persistProviders(frame.providers, frame.activeId);
        client.send(providersFrame(await host.readProviders()));
        break;
      }
      case 'set_provider': {
        const snapshot = await host.readProviders();
        const chosen = snapshot.providers.find((entry) => entry.id === frame.id);
        if (chosen === undefined) {
          client.send(serialize({ type: 'error', message: `没有这个供应商：${frame.id}` }));
          break;
        }
        const live = endpointClient(host);
        if (live === undefined) {
          client.send(serialize({ type: 'error', message: '本次启动的模型客户端不支持切换端点' }));
          break;
        }
        if (frame.id === snapshot.activeId) {
          // Already in force: answer with state rather than a no-op write, so a
          // double click cannot churn the config file.
          client.send(providersFrame(snapshot));
          break;
        }
        if (host.persistProviders === undefined) {
          client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
          break;
        }
        const apiKey = await host.storedApiKey(frame.id);
        if (apiKey === undefined) {
          client.send(serialize({ type: 'error', message: `供应商「${chosen.name ?? chosen.id}」还没有填写 API 密钥` }));
          break;
        }
        // Persist the pointer FIRST: a switch that the process applied but the
        // file never recorded would silently revert on restart, leaving the
        // operator with a seat that moves back on its own.
        await host.persistProviders(
          snapshot.providers.map((entry) => ({
            id: entry.id,
            baseURL: entry.baseURL,
            ...(entry.name !== undefined ? { name: entry.name } : {}),
            ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
            models: entry.models,
          })),
          frame.id,
        );
        // Retarget in place, then reconcile the id against THIS endpoint's
        // catalog: the previous endpoint's spelling is a name the new one
        // probably does not serve (see `core/model-id.ts`).
        const configured = host.configuredModel();
        live.setEndpoint({
          baseURL: chosen.baseURL,
          apiKey,
          model: configured ?? '',
        });
        if (configured !== undefined && live.listModels !== undefined) {
          const available = await live.listModels(5_000).catch(() => [] as string[]);
          const reconciled = resolveModelId(configured, available);
          if (reconciled !== configured) live.setModel?.(reconciled);
        }
        host.refreshSeat();
        client.send(providersFrame(await host.readProviders()));
        break;
      }
      case 'probe_provider': {
        // A stored key may stand in for a typed one: re-probing a saved endpoint
        // must not require the operator to paste the secret again. The match is by
        // baseURL because the probe is deliberately address-based — the operator is
        // testing text they just typed, which may not be saved under any id yet.
        const known = findByBaseURL(await host.readProviders(), frame.baseURL);
        const stored =
          frame.apiKey === undefined && known !== undefined ? await host.storedApiKey(known) : undefined;
        const apiKey = frame.apiKey ?? stored;
        try {
          const models = await probeProvider(frame.baseURL, apiKey);
          client.send(serialize({ type: 'provider_probe', ok: true, baseURL: frame.baseURL, models }));
        } catch (err) {
          client.send(
            serialize({
              type: 'provider_probe',
              ok: false,
              baseURL: frame.baseURL,
              models: [],
              message: errMessage(err),
            }),
          );
        }
        break;
      }
    }
  } catch (err) {
    client.send(serialize({ type: 'error', message: errMessage(err) }));
  }
}

/** The stored row matching a baseURL, for reusing its key on a re-probe. */
function findByBaseURL(snapshot: ProvidersSnapshot, baseURL: string): string | undefined {
  const normalized = baseURL.replace(/\/+$/, '');
  return snapshot.providers.find((entry) => entry.baseURL.replace(/\/+$/, '') === normalized)?.id;
}
