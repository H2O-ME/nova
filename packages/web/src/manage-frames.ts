/**
 * The settings panel's management frames: the plugin manager's switches, the
 * Skill 中心's switches, and the qqbot connection page.
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
import { handleQqBotFrame, type QqBotRuntime, type QqBotSnapshot } from './qqbot-frames.js';
import { toWireRosterEntry } from './roster-wire.js';
import type { WireRosterEntry } from './roster-entry.js';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

// The qqbot snapshot and live-channel shapes live with the frames that consume
// them (`qqbot-frames.ts`, the same arrangement as `provider-frames.ts`), and are
// re-exported here so the controller, the frame host and the router keep reading
// every settings-family type from one place.
export type { QqBotRuntime, QqBotSnapshot } from './qqbot-frames.js';

/** The collaborators the management frames read, supplied by the controller. */
export interface ManageHost {
  agent: AgentSession;
  kernel: Kernel;
  /** Send every attached client this text (a broadcast, not a reply). */
  broadcast(text: string): void;
  /**
   * Re-broadcast the chrome `state` frame (model / approval tier / code mode) to
   * every attached client. A `ptc` flip follows the live code mode (closing the
   * row returns it to `native` — see `runtime-switch.ts`), and the composer's
   * mode chip reads that mode from this broadcast: a flip that skipped it left
   * the chips showing a mode whose plugin is gone.
   */
  broadcastState(): void;
  /** The qqbot page's config writer/snapshot/probe (absent with no home). */
  persistQqBot: ((opts: { appId?: string; clientSecret?: string }) => void | Promise<void>) | undefined;
  qqBotSnapshot(): QqBotSnapshot;
  setQqBotSnapshot(snapshot: QqBotSnapshot): void;
  testQqBot: ((opts: { appId: string; clientSecret: string }) => Promise<string>) | undefined;
  /**
   * Re-derive the qqbot diagnostic from what is now on disk, after a save.
   *
   * The rule for "is this stored value usable" lives in the shell (it owns the
   * config file and the `{env:NAME}` reference rule), so the panel asks instead
   * of re-implementing it: a save that stores ANOTHER unresolved reference must
   * keep reporting the problem, and one that stores a real secret must stop.
   * Absent with no durable home — the panel then leaves the snapshot alone.
   */
  recheckQqBot?: (() => Promise<string | undefined>) | undefined;
  /**
   * The LIVE channel in this process, when the shell runs one.
   *
   * Absent with no channel (tests, or a shell that has no qqbot at all): the page
   * then reads exactly as it did before this seam existed — a stored credential
   * is all it can know. See `QqBotRuntime` for why a save needs more than a writer.
   */
  qqBotRuntime?: QqBotRuntime | undefined;
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
    | { type: 'qqbot' }
    | { type: 'save_qqbot' }
    | { type: 'test_qqbot' }
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
        const disable = await kernel.setPluginEnabled(frame.name, frame.enabled);
        // Turning qqbot's row OFF must hang up the gateway too: it lives in the
        // shell's bridge, not inside the plugin's effects, so the flip alone
        // unregisters the tools and leaves the socket open — the page would say
        // 已关闭 while QQ peers still reach the agent.
        if (frame.name === 'qqbot' && !frame.enabled) host.qqBotRuntime?.stop?.();
        // The answer IS the new roster: the panel re-renders from it rather
        // than flipping its own row optimistically.
        client.send(serialize({ type: 'plugins', entries: rosterEntries(kernel), disable: [...disable] }));
        // The flip may have moved the live code mode (a `ptc` close returns it
        // to `native`), and every mode chip reads that mode from the state
        // broadcast — skipping this left the chips one flip behind the roster.
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
      case 'qqbot':
      case 'save_qqbot':
      case 'test_qqbot':
        // The qqbot family lives in its own module: same settings discipline,
        // but a save also has to make the channel RUN, which the plugin and
        // Skill rows never do (see `qqbot-frames.ts`).
        await handleQqBotFrame(client, frame, host);
        break;
    }
  } catch (err) {
    errorTo(client, err);
  }
}