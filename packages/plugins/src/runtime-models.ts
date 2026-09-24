/**
 * The kernel's model control (see core's `kernel/model.ts` for the shapes).
 *
 * Two authorities meet here and neither is duplicated:
 *
 *  - **The endpoint owns the ids.** `ChatProvider.listModels()` is the catalog
 *    (`GET /models` on an OpenAI-compatible gateway), so a deployment that adds
 *    or retires a model changes what the picker offers with no release here.
 *  - **The surface owns the metadata.** Display names and context windows come
 *    from the `ModelCatalogPort` the assembly was handed (the cli's models.dev
 *    store), because an endpoint reports ids and nothing else.
 *
 * The switch itself is in-place on the one client instance every consumer
 * already holds (`ChatProvider.setModel`), so nothing is rebuilt: the session
 * handles, the roster's subagent tool and the cache-affinity binding all keep
 * pointing at the same live client, and only the model id moves. The session
 * then ANNOUNCES the change on the kernel event stream, which is what makes a
 * switch made in one surface visible in the others.
 */
import {
  canSwitchModels,
  llm as llmKey,
  sessions as sessionsKey,
  type ModelCatalogPort,
  type ModelControl,
  type ModelOption,
} from '@nova-agent/core';
import type { Environment } from './runtime-env.js';

/**
 * Build the control, or `undefined` when this kernel cannot switch models:
 * no catalog port (a surface that never shows a picker), no retargetable
 * client (a scripted provider, a shim). Absence is a first-class answer — the
 * seat stays unrendered instead of opening onto a list it cannot apply.
 */
export function modelControl(env: Environment, port: ModelCatalogPort): ModelControl | undefined {
  const provider = env.provider;
  if (!canSwitchModels(provider)) return undefined;
  const current = (): string => env.root.must(llmKey).model;

  /** One row: the port's display metadata, falling back to the raw id. */
  const option = async (id: string): Promise<ModelOption> => {
    const meta = await port.describe(id).catch(() => undefined);
    return {
      id,
      name: meta?.name ?? id,
      ...(meta?.contextWindow !== undefined ? { contextWindow: meta.contextWindow } : {}),
    };
  };

  return {
    current,
    list: async () => {
      const listed = provider.listModels === undefined ? [] : await provider.listModels();
      // The model in force is always a row: it is the picker's check mark, and
      // an endpoint that stopped advertising a model it still serves must not
      // leave the menu with no answer to "what am I talking to".
      const inForce = current();
      const ids = listed.length === 0 || inForce === '' || listed.includes(inForce)
        ? listed
        : [inForce, ...listed];
      if (ids.length === 0) return [];
      return [{ id: 'endpoint', name: port.label, models: await Promise.all(ids.map(option)) }];
    },
    select: async (model) => {
      provider.setModel(model);
      const chosen = await option(model);
      env.root
        .get(sessionsKey)
        ?.current()
        ?.announceModel(model, { name: chosen.name, ...(chosen.contextWindow !== undefined ? { contextWindow: chosen.contextWindow } : {}) });
      return chosen;
    },
  };
}