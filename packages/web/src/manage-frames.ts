/**
 * The settings panel's management frames: the plugin manager's switches and the
 * Skill 中心's switches.
 *
 * Split from `frame-router.ts` the way `fs-frames.ts` already is: the routing
 * table grows with every new frame, and this family shares one discipline —
 * **persist first, then reload, then answer with state** (a successful call
 * means the config file and the live kernel agree; a throw means neither
 * moved, and the answer is an `error` frame, never a half-applied row).
 */
import { errMessage, type AgentSession, type ConfiguredModel } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { handleModelConfigFrame } from './model-config-frames.js';
import { toWireRosterEntry } from './roster-wire.js';
import type { WireRosterEntry } from './roster-entry.js';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** The collaborators the management frames read, supplied by the controller. */
export interface ManageHost {
  agent: AgentSession;
  kernel: Kernel;
  /** Send every attached client this text (a broadcast, not a reply). */
  broadcast(text: string): void;
  /** Re-broadcast the chrome `state` frame (model / approval tier). */
  broadcastState(): void;
  /** The operator's model list; the model-list frames live in their own module. */
  persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined;
  readModels: () => Promise<readonly ConfiguredModel[]>;
}

function errorTo(client: WsConnection, err: unknown): void {
  client.send(serialize({ type: 'error', message: errMessage(err) }));
}

function rosterEntries(kernel: Kernel): readonly WireRosterEntry[] {
  // The single builder (`roster-entry.ts`) — the `roster` frame uses it too, so a
  // field added for one path cannot go missing on the other.
  return kernel.roster().map(toWireRosterEntry);
}

/**
 * The Skill 中心's rows: EVERY discovered skill with its switch state.
 *
 * Reads `allSkills` (discovery), not `skills` (the filtered list the fragment
 * and the `skill` tool are built from). A disabled skill is absent from
 * `skills` by definition, so listing from there made the switch ONE-WAY: the
 * row vanished on the very flip that disabled it, leaving the operator no way
 * to turn it back on short of editing the config file by hand.
 * @param kernel - the kernel handle.
 * @param disable - the names currently switched off.
 * @returns one row per discovered skill.
 */
function skillRows(
  kernel: Kernel,
  disable: readonly string[],
): { name: string; description: string; source: string; enabled: boolean }[] {
  const off = new Set(disable);
  return kernel.allSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.level,
    enabled: !off.has(skill.name),
  }));
}

/**
 * Route one management frame. The caller guarantees `frame.type` is one of the
 * family's, and the validator guarantees the payload shapes.
 */
export async function handleManageFrame(
  client: WsConnection,
  frame: Extract<
    ClientFrame,
    | { type: 'set_plugin_enabled' }
    | { type: 'set_skill_enabled' }
    | { type: 'list_skills' }
    | { type: 'list_model_config' }
    | { type: 'save_models' }
  >,
  host: ManageHost,
): Promise<void> {
  const { kernel } = host;
  try {
    switch (frame.type) {
      case 'set_plugin_enabled': {
        // Refused mid-run: the mode rows already hold this line (a mode is a
        // promise about the whole run), and a plugin flip re-rosters the tool
        // registry the live request is built on.
        if (host.agent.running) {
          client.send(serialize({ type: 'error', message: '运行中不能切换插件开关' }));
          break;
        }
        // The flip itself is the whole story now: a plugin's resources live in
        // its own fiber, so dropping the row tears them down. There is no
        // per-plugin "also stop the socket" step to forget here — that step
        // existed because the channel used to be started by the shell.
        const disable = await kernel.setPluginEnabled(frame.name, frame.enabled);
        // The answer IS the new roster: the panel re-renders from it rather
        // than flipping its own row optimistically.
        client.send(serialize({ type: 'plugins', entries: rosterEntries(kernel), disable: [...disable] }));
        host.broadcastState();
        break;
      }
      case 'set_skill_enabled': {
        if (host.agent.running) {
          client.send(serialize({ type: 'error', message: '运行中不能切换 Skill 开关' }));
          break;
        }
        const disable = await kernel.setSkillEnabled(frame.name, frame.enabled);
        client.send(serialize({ type: 'skills', items: skillRows(kernel, disable), disable: [...disable] }));
        break;
      }
      case 'list_skills': {
        // The CURRENT disable list, not an empty one: the panel draws each row's
        // switch from it, so reporting [] here would show every disabled skill
        // as if it were on — and the operator's next click would then be a no-op
        // that reads as a broken switch.
        const off = [...kernel.disabled.skills];
        client.send(serialize({ type: 'skills', items: skillRows(kernel, off), disable: off }));
        break;
      }
      case 'list_model_config':
      case 'save_models':
        // The model-list family lives in its own module (same discipline,
        // different config section and a wholly-replaced list rather than a
        // flipped switch).
        await handleModelConfigFrame(client, frame, host);
        break;

    }
  } catch (err) {
    errorTo(client, err);
  }
}