/**
 * The settings page's model-list frames: read the stored list, and write it.
 *
 * Split from `manage-frames.ts` because it shares that family's discipline
 * (persist first, reload, answer with state) while touching a different file
 * section for a different reason: the plugin/skill switches flip one row of a
 * disable list, while this replaces the operator's whole model catalog. The
 * switch family is about ENABLING things that already exist; this one is about
 * what the picker may offer at all.
 */
import type { ConfiguredModel, ModelCapabilities } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { serializeServerFrame as serialize } from './protocol.js';
import type { WsConnection } from './ws.js';

/** What the model-list frames need from the controller. */
export interface ModelConfigHost {
  /** Write the operator's model list (config `models[]`); absent with no home. */
  persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined;
  /**
   * The model list as it is STORED right now (re-read from disk, not cached).
   *
   * Re-read because the file is the authority and the settings page is not its
   * only writer: answering from an in-memory copy would let the page show a list
   * the operator's own hand-edit already replaced.
   */
  readModels: () => Promise<readonly ConfiguredModel[]>;
  /** Write the session-TITLE model (config `titleModel`); `null` clears it. */
  persistTitleModel: ((model: string | null) => void | Promise<void>) | undefined;
  /** The stored title model, re-read from disk (`null` = none configured). */
  readTitleModel: () => Promise<string | null>;
  kernel: Kernel;
}

/** The `model_config` frame's payload. */
export interface ModelConfigFrame {
  type: 'model_config';
  models: ConfiguredModel[];
  published: string[];
  automatic: Record<string, ModelCapabilities>;
  /** The session-title model, `null` when unset (core falls back to no titles). */
  titleModel: string | null;
}

/**
 * Route one model-list frame. The caller guarantees `frame.type` is one of the
 * family's, and the validator guarantees the payload shapes.
 * @param client - the requesting socket.
 * @param frame - the validated frame.
 * @param host - the controller's model-list seams.
 */
export async function handleModelConfigFrame(
  client: WsConnection,
  frame:
    | { type: 'list_model_config' }
    | { type: 'save_models'; models: readonly ConfiguredModel[] }
    | { type: 'set_title_model'; model: string | null },
  host: ModelConfigHost,
): Promise<void> {
  if (frame.type === 'save_models') {
    if (host.persistModels === undefined) {
      client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
      return;
    }
    // Not refused mid-run (unlike a plugin flip): the list is read at boot and
    // on a menu open, so writing it now changes the NEXT menu rather than the
    // run in flight — nothing the live request is built on moves.
    await host.persistModels(frame.models);
  } else if (frame.type === 'set_title_model') {
    if (host.persistTitleModel === undefined) {
      client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
      return;
    }
    // Same shape as `save_models`: a per-SESSION read (`kernel-session`'s
    // `titleProvider` thunk), so the next opened session picks it up and the
    // one in flight is untouched.
    await host.persistTitleModel(frame.model);
  }
  // Both paths answer with what is now STORED, not what was sent: the host's own
  // normalization (blank ids dropped, an empty list deleting the key) is part of
  // the answer, and a page that echoed its input would drift from the file on the
  // first edit that normalized.
  client.send(serialize(await modelConfigFrame(host)));
}

/**
 * Assemble the settings page's model snapshot.
 *
 * Three facts, gathered together because the page needs all three to be an
 * editor: the stored list, the endpoint's own pool (so a removed id can come
 * back), and models.dev's answer per id (so an untouched field shows its real
 * default rather than looking empty).
 *
 * `automatic` is keyed by the STORED ids plus the current model, and only those:
 * the endpoint pool can be large, and looking up metadata for ids the page is
 * not showing would turn one frame into dozens of wasted lookups.
 * @param host - the model-list host (its `models` control may be absent).
 * @returns the `model_config` frame payload.
 */
async function modelConfigFrame(host: ModelConfigHost): Promise<ModelConfigFrame> {
  const models = [...(await host.readModels())];
  const titleModel = await host.readTitleModel();
  const control = host.kernel.models;
  if (control === undefined) {
    // No picker on this kernel (a scripted provider): the page still edits the
    // file, it just cannot offer the endpoint's pool or any automatic defaults.
    return { type: 'model_config', models, published: [], automatic: {}, titleModel };
  }
  const [published, automatic] = await Promise.all([
    control.published().catch(() => [] as readonly string[]),
    // De-duplicated: two stored rows may name the same id in different case.
    (async () => {
      const ids = [...new Set([...models.map((m) => m.id), control.current()])].filter((id) => id !== '');
      const found = await Promise.all(
        ids.map(async (id) => [id, await control.automatic(id)] as const),
      );
      return Object.fromEntries(
        found.filter((entry): entry is readonly [string, ModelCapabilities] => entry[1] !== undefined),
      );
    })(),
  ]);
  return { type: 'model_config', models, published: [...published], automatic, titleModel };
}
