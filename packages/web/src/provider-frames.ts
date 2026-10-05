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
 *
 * The switch is ONE transaction shared by two entries (`set_provider`, and the
 * auto-apply after `save_providers`): resolve the key (refusing BEFORE anything
 * is written), persist the pointer, apply to the live client, track the applied
 * id. "Which provider is in force" is therefore a fact about the PROCESS
 * (`liveProviderId`), not about the file — the file can name an id the process
 * never applied (boot built no client, or an apply failed after the save), and
 * comparing against the file would report a switch as a no-op while requests
 * still go to the previous endpoint.
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

/**
 * One attempt to turn a stored key into a USABLE secret. Structural mirror of
 * the shell's reader (`cli/src/config-providers.ts`): the shell owns the file
 * and the `{env:NAME}` expansion, the surface only needs the outcome — a key,
 * or the named reason there is none. An unset variable is a NAMED refusal, so
 * the caller can report it and never touch the network.
 */
export interface StoredKeyResolution {
  /** The secret a request may carry, when one is stored and resolvable. */
  readonly key?: string;
  /** Why there is no usable secret. */
  readonly problem?: 'missing' | 'env-unset';
  /** The variable name, for an `env-unset` problem. */
  readonly envName?: string;
}

/** What the provider frames need from the controller. */
export interface ProviderHost {
  kernel: Kernel;
  /** Write the list; absent with no durable home, and the save then refuses. */
  persistProviders: ((entries: readonly WireProviderInput[], activeId: string | undefined) => void | Promise<void>) | undefined;
  /** Re-read the list from disk (the file is the authority, the page is not). */
  readProviders: () => Promise<ProvidersSnapshot>;
  /**
   * Resolve the stored key for one provider id — EXPANDED for use in a request,
   * so a referenced `{env:NAME}` resolves here or is refused by name, and the
   * raw file text (which is a file format, not a credential) never reaches a
   * fetch. Async because it is a read of the config file, not a cached field.
   */
  storedApiKey: (id: string) => StoredKeyResolution | Promise<StoredKeyResolution>;
  /** The model id to carry when retargeting (config `provider.model`). */
  configuredModel: () => string | undefined;
  /** The provider id the live client is currently serving; undefined = none applied. */
  liveProviderId: () => string | undefined;
  /** Record that a switch took effect on the live client. */
  setLiveProviderId: (id: string) => void;
  /** Tell every client the seat moved (the kernel event, then a fresh state). */
  refreshSeat: () => void;
}

/** The live client a switch retargets, read off the `llm` service. */
interface RetargetableClient extends ChatProvider {
  setEndpoint(endpoint: {
    baseURL: string;
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): void | Promise<void>;
}

/**
 * Read LIVE rather than captured: the service is the single place every session
 * and every nested subagent gets its provider from, so retargeting the instance
 * it hands out is what makes a switch reach all of them at once. The switchable
 * shell provider's `setEndpoint` is async (a placeholder target is rebuilt from
 * the just-saved file first); a scripted or third-party provider without one is
 * the refusal, reported with a reason instead of a silent no-op.
 */
function endpointClient(host: ProviderHost): RetargetableClient | undefined {
  const provider = host.kernel.llm.provider as ChatProvider & { setEndpoint?: RetargetableClient['setEndpoint'] };
  return typeof provider.setEndpoint === 'function' ? (provider as RetargetableClient) : undefined;
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
 * Turn a row's stored key into a USABLE secret, refusing by name. Runs BEFORE
 * anything is persisted: a refusal is not a switch, and persisting the pointer
 * anyway would leave the file naming a provider no request can serve — worse,
 * an unresolvable `{env:NAME}` in the mirrored `provider` block is FATAL at the
 * next load, so the refusal must happen while the file is still untouched.
 * @throws with the operator-facing reason.
 */
async function resolveUsableKey(host: ProviderHost, chosen: StoredProviderRow): Promise<string> {
  const key = await host.storedApiKey(chosen.id);
  if (key.problem === 'env-unset') {
    throw new Error(
      `供应商「${chosen.name ?? chosen.id}」引用的环境变量 {env:${key.envName}} 未设置，切换前请先在环境里提供它`,
    );
  }
  if (key.key === undefined) {
    throw new Error(`供应商「${chosen.name ?? chosen.id}」还没有填写 API 密钥`);
  }
  return key.key;
}

/**
 * Point the live client at one saved row whose key is ALREADY resolved, then
 * reconcile the model id against the new endpoint's catalog. Persisting the
 * pointer is the caller's job.
 */
async function applyResolved(
  host: ProviderHost,
  id: string,
  key: string,
  chosen: StoredProviderRow,
): Promise<void> {
  const live = endpointClient(host);
  if (live === undefined) {
    throw new Error('本次启动的模型客户端不支持切换端点');
  }
  // Retarget in place, then reconcile the id against THIS endpoint's
  // catalog: the previous endpoint's spelling is a name the new one
  // probably does not serve (see `core/model-id.ts`).
  const configured = host.configuredModel();
  await live.setEndpoint({
    baseURL: chosen.baseURL,
    apiKey: key,
    model: configured ?? '',
    ...(chosen.temperature !== undefined ? { temperature: chosen.temperature } : {}),
    ...(chosen.maxTokens !== undefined ? { maxTokens: chosen.maxTokens } : {}),
  });
  if (configured !== undefined && live.listModels !== undefined) {
    const available = await live.listModels(5_000).catch(() => [] as string[]);
    const reconciled = resolveModelId(configured, available);
    if (reconciled !== configured) live.setModel?.(reconciled);
  }
  host.setLiveProviderId(id);
  host.refreshSeat();
}

/**
 * The apply half of the switch transaction for the path whose persist already
 * happened (`save_providers`): resolve the key, then retarget.
 * @throws with the operator-facing reason when the row, the key or the live
 *   client cannot serve the switch.
 */
async function applyProvider(host: ProviderHost, id: string): Promise<void> {
  const snapshot = await host.readProviders();
  const chosen = snapshot.providers.find((entry) => entry.id === id);
  if (chosen === undefined) {
    throw new Error(`没有这个供应商：${id}`);
  }
  await applyResolved(host, id, await resolveUsableKey(host, chosen), chosen);
}

/** The stored row's full shape, ready to persist (the switch rewrites the list). */
function toPersistEntry(entry: StoredProviderRow): WireProviderInput {
  return {
    id: entry.id,
    baseURL: entry.baseURL,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    models: entry.models,
  };
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
        // the one being built.
        await host.persistProviders(frame.providers, frame.activeId);
        client.send(providersFrame(await host.readProviders()));
        // The saved pointer is also the live pointer whenever it names a provider
        // the process has not applied — a first save on the placeholder shell, or
        // a save that swaps the active row. A failure does NOT unsave: the frame
        // above is the truth (已保存), the error frame is the delta (未生效).
        if (frame.activeId !== undefined && host.liveProviderId() !== frame.activeId) {
          try {
            await applyProvider(host, frame.activeId);
          } catch (err) {
            client.send(
              serialize({ type: 'error', message: `已保存，但切换到新供应商未生效：${errMessage(err)}` }),
            );
          }
        }
        break;
      }
      case 'set_provider': {
        const snapshot = await host.readProviders();
        const chosen = snapshot.providers.find((entry) => entry.id === frame.id);
        if (chosen === undefined) {
          client.send(serialize({ type: 'error', message: `没有这个供应商：${frame.id}` }));
          break;
        }
        if (host.liveProviderId() === frame.id) {
          // Already in force on the LIVE client — not "matches the file": the
          // file can name an id the process never applied, and answering state
          // to that would claim a switch that never reached a request.
          client.send(providersFrame(snapshot));
          break;
        }
        if (host.persistProviders === undefined) {
          client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
          break;
        }
        // Refuse BEFORE anything is written: a refusal is not a switch, and
        // persisting the pointer anyway would leave the file naming a provider
        // no request can serve (see `resolveUsableKey`).
        const key = await resolveUsableKey(host, chosen);
        // Persist the pointer FIRST: a switch that the process applied but the
        // file never recorded would silently revert on restart, leaving the
        // operator with a seat that moves back on its own.
        await host.persistProviders(
          snapshot.providers.map(toPersistEntry),
          frame.id,
        );
        try {
          await applyResolved(host, frame.id, key, chosen);
        } catch (err) {
          // The file is ahead of the process: the pointer is saved, the live
          // client still serves the previous endpoint, and a restart applies
          // what the file names. Say both, instead of pretending nothing
          // happened.
          client.send(providersFrame(await host.readProviders()));
          client.send(
            serialize({ type: 'error', message: `已写入配置，但本次进程未生效：${errMessage(err)}` }),
          );
          break;
        }
        client.send(providersFrame(await host.readProviders()));
        break;
      }
      case 'probe_provider': {
        // A stored key may stand in for a typed one: re-probing a saved endpoint
        // must not require the operator to paste the secret again. The match is by
        // baseURL because the probe is deliberately address-based — the operator is
        // testing text they just typed, which may not be saved under any id yet.
        const known = findByBaseURL(await host.readProviders(), frame.baseURL);
        let stored: string | undefined;
        if (frame.apiKey === undefined && known !== undefined) {
          stored = (await host.storedApiKey(known)).key;
        }
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
