/**
 * The inbound frame router: one validated `ClientFrame` → zero or more kernel
 * calls, never throwing.
 *
 * It is a free function rather than a controller method because it reads almost
 * every collaborator (agent, kernel, seat, pages, session list, workspace move)
 * and is the part of the controller that grows with each new frame. Naming those
 * reads once as {@link FrameHost} keeps this routing TABLE apart from the
 * lifetime, socket and broadcast machinery that owns it — the split
 * `fs-frames.ts` already makes for the filesystem frames, one hop further down.
 */
import {
  errMessage,
  isBlankSession,
  sessionLogPath,
  userConfigPath,
} from '@nova-agent/core';
import { panelShell, shellCandidates } from '@nova-agent/plugins';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import { admitPromptImages } from './prompt-images.js';
import type { WsConnection } from './ws.js';
import { handleFsFrame } from './fs-frames.js';
import { handleEntryFrame } from './entry-frames.js';
import { handleGitFrame } from './git-frames.js';
import { handleJobFrame } from './job-frames.js';
import { handleTermFrame, matchShell } from './term-frames.js';
import { handlePickerFrame } from './picker-frames.js';
import { pickNativePath } from './native-picker.js';
import { handleSessionFrame } from './session-frames.js';
import { handleHumanAnswer } from './human-frames.js';
import { handleManageFrame } from './manage-frames.js';
import { handlePluginFrame } from './plugin-frames.js';
import { toWireRosterEntry } from './roster-wire.js';
import { handleProviderFrame } from './provider-frames.js';
import { sessionRows } from './session-rows.js';
// The collaborator contract is its own module (`frame-host.ts`); re-exported so
// the controller and existing importers keep one path for both.
import type { FrameHost } from './frame-host.js';

export type { FrameHost } from './frame-host.js';

/**
 * Route one frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 * @returns nothing; every failure travels to the caller as an `error` frame.
 */
export async function handleFrame(
  client: WsConnection,
  frame: ClientFrame,
  host: FrameHost,
): Promise<void> {
  const { agent, kernel } = host;
  try {
    switch (frame.type) {
      case 'prompt': {
        // Verify the cited images BEFORE the prompt is logged: a frame may name
        // any digest, and a reference to bytes this host never stored would
        // otherwise be written into the durable log and only fail much later, at
        // request time. A dropped image is reported to the client rather than
        // silently omitted, because the user selected it deliberately.
        const admitted = await admitPromptImages(frame.images);
        if (admitted.missing.length > 0) {
          client.send(serialize({
            type: 'error',
            message: `有 ${admitted.missing.length} 张图片已不可用，未随本条消息发送`,
          }));
        }
        await agent.prompt(frame.text, admitted.images);
        break;
      }
      case 'abort':
        agent.abort();
        break;
      case 'resolve_approval':
      case 'resolve_question':
      case 'cancel_question':
        // One seam for every human answer; the broker decides, and a refusal is
        // reported back to this client (see `human-frames.ts`).
        handleHumanAnswer(client, agent, frame);
        break;
      case 'compact':
        await agent.compact('manual');
        break;
      case 'list_sessions':
        client.send(serialize({ type: 'sessions', items: await sessionRows(host.sessions, agent) }));
        break;
      case 'resume':
        await host.switchSession({ resumeFile: sessionLogPath(frame.file) });
        break;
      case 'new_session':
        // Already on a blank session? Then there is nothing to start: the
        // session is created before the first prompt, so minting another one
        // would append a second empty log, and the sidebar would grow a row
        // ("新会话") that names nothing. The client still gets a baseline, so a
        // pressed "new session" always lands somewhere predictable.
        if (isBlankSession(agent.messages)) host.broadcast(host.readyFrame());
        else await host.switchSession({});
        break;
      case 'list_files':
      case 'list_directory':
      case 'create_directory':
        // The read-only filesystem frames share one discipline (validate before
        // mutating, answer with state); they live in `fs-frames.ts`.
        await handleFsFrame(client, frame, { rootDir: kernel.rootDir() });
        break;
      case 'read_entry':
      case 'rename_entry':
      case 'remove_entry':
      case 'new_entry':
      case 'open_entry':
        // The right panel's editor frames: one entry at a time, core's own
        // boundary rule (see `entry-frames.ts`).
        await handleEntryFrame(client, frame, { rootDir: kernel.rootDir() });
        break;
      case 'git_status':
      case 'git_diff':
      case 'git_stage':
      case 'git_unstage':
      case 'git_commit':
      case 'git_log':
        // The 变更 tab's git lens (`git-frames.ts`): argv-only git in the
        // workspace, every mutation answered with a fresh status, reads served
        // from the process's one status cache.
        await handleGitFrame(client, frame, { rootDir: kernel.rootDir(), cache: host.gitCache });
        break;
      case 'pick_file':
      case 'pick_directory':
        // The native-dialog pair: the host opens the OS picker and answers with
        // one `picked` frame (see `picker-frames.ts`).
        await handlePickerFrame(client, frame, host.pickPath ?? pickNativePath);
        break;
      case 'set_workspace':
      case 'delete_session':
      case 'git_clone':
        // The frames that redefine what is OPEN (`git_clone` ends in a new
        // workspace, so it restates the surface like `set_workspace` does).
        // They need the host's extra collaborators (which session is current,
        // how to abandon it), so they are their own module rather than a branch
        // of the read-only one.
        await handleSessionFrame(client, frame, {
          currentSessionFile: () => agent.session.file,
          currentRootDir: () => kernel.rootDir(),
          abandonCurrentSession: () => host.abandonCurrentSession(),
          setWorkspace: async (dir) => {
            // The kernel re-seeds a still-blank session itself (see
            // `runtime-facade.ts`), so every surface gets that half for free.
            await kernel.setWorkspace(dir);
          },
          broadcastReady: () => { host.broadcast(host.readyFrame()); },
          sendSessions: async (target) => {
            target.send(serialize({ type: 'sessions', items: await sessionRows(host.sessions, agent) }));
          },
        });
        break;
      case 'load_earlier': {
        const page = host.pages.earlierThan(frame.have);
        client.send(serialize({ type: 'history_earlier', blocks: page.items, total: page.total }));
        break;
      }
      case 'load_trace': {
        const page = host.pages.trace(frame.have, agent.session.events);
        client.send(serialize({ type: 'trace', rows: page.items, total: page.total }));
        break;
      }
      case 'context': {
        client.send(serialize(host.context.frame(agent, kernel)));
        break;
      }
      case 'set_approval_mode':
        // Both halves at once: the live session switches now, and every later
        // session starts here.
        //
        // DELIBERATELY allowed mid-run, unlike an operation that rebuilds the
        // toolset. The tier is a single field on the permission service
        // (`PermissionService.setMode`), read fresh on every `autoAllows` call —
        // it is not part of the cached prefix, it does not re-roster the tool
        // registry, and it does not touch the request already in flight. What it
        // changes is the NEXT tool call that needs adjudicating, which is exactly
        // what the operator reaches for when a run turns out to need more (or
        // less) rope. Refusing here made the setting unreachable for the entire
        // duration of a long run.
        //
        // This is also the safe direction of asymmetry: tightening takes effect
        // immediately, and loosening cannot retroactively un-gate a call that was
        // already denied.
        agent.setApprovalMode(frame.mode);
        host.setApprovalDefault(frame.mode);
        host.broadcastState();
        break;
      case 'plugin_request':
        // Every plugin operation goes through here, and the host adds nothing:
        // the request names its own plugin, the registry finds it, the plugin
        // answers or refuses. A page whose plugin is switched off gets `ok: false`
        // and a sentence, which is the honest answer — and the reason one broken
        // plugin cannot take the settings panel with it.
        await handlePluginFrame(client, frame, host.pluginRpc);
        break;
      case 'list_models':
        client.send(serialize({ type: 'models', ...(await host.seat.list()) }));
        break;
      case 'roster':
        client.send(
          serialize({
            type: 'roster',
            // The shared row builder, NOT a local copy: this is the FIRST-PAINT
            // path (the panel asks for the roster when it mounts), so a field
            // missing here shows up as English identifiers in a tier-less group
            // until some later flip happens to answer through `manage-frames.ts`.
            entries: kernel.roster().map(toWireRosterEntry),
            configPath: userConfigPath(),
          }),
        );
        break;
      case 'set_model':
        // The kernel announces the switch on its event stream; that event
        // carries the new label back to every attached client. The durable half
        // follows the switch rather than preceding it: a config that says one
        // model while the client runs another is the bug being fixed. A write
        // failure is reported and does not undo the switch — the running process
        // really is on the new model either way.
        await host.seat.select(frame.model);
        await host.persistModel?.(frame.model);
        break;
      case 'command':
        // The registry's row (a `command` event pair) is the reporting; a
        // refused or unknown name reports there too, so the caller's click
        // always lands somewhere the reader can see.
        await kernel.runCommand(frame.name, frame.args);
        break;
      case 'stop_job':
        // Unknown/settled ids are a no-op: the control is optimistic, and the
        // authoritative answer always arrives as a `job_update`.
        await agent.stopJob(frame.id);
        break;
      case 'discover_shells': {
        // The menu IS the host's inventory: installed candidates only, the
        // environment's default first, so a row never fails to spawn and the
        // checkmark names what a choiceless `term_open` would start.
        client.send(serialize({
          type: 'shells',
          items: shellCandidates(),
          current: panelShell().path,
        }));
        break;
      }
      case 'term_input':
      case 'term_resize':
      case 'term_kill':
      case 'term_open': {
        // The 终端 tab: one real PTY per session, spawned on first open and
        // taken down with the session (see `term-frames.ts`). A requested shell
        // must be one the host discovered — a path typed into a frame is not a
        // program to spawn.
        const wanted = frame.type === 'term_open' ? frame.shell : undefined;
        const shell = matchShell(shellCandidates(), wanted, panelShell());
        if (shell === undefined) {
          client.send(serialize({ type: 'error', message: `无法启动该 shell：它不在宿主的已安装清单里（${wanted ?? ''}）` }));
          break;
        }
        await handleTermFrame(client, frame, {
          terms: host.terms,
          sessionId: agent.session.id,
          rootDir: kernel.rootDir(),
          // The operator's own default, NOT the model's shell (see term-frames).
          shell,
          broadcast: host.broadcast,
        });
        break;
      }
      case 'list_jobs':
        // The 任务 tab's read: live jobs as state, never output (output is the
        // model's cursor — see `job-frames.ts`).
        handleJobFrame(client, { jobs: kernel.jobs, sessionId: agent.session.id });
        break;
      case 'set_plugin_enabled':
      case 'set_skill_enabled':
      case 'list_skills':
      case 'list_model_config':
      case 'save_models':
        // The settings panel's management frames share one discipline (persist
        // first, reload, answer with state) and live together in
        // `manage-frames.ts`. A PLUGIN's own page is not here: it goes through
        // `plugin_request` above, because the host does not know what any plugin's
        // settings are.
        await handleManageFrame(client, frame, {
          agent,
          kernel,
          broadcast: host.broadcast,
          broadcastState: host.broadcastState,
          persistModels: host.persistModels,
          readModels: host.readModels,
        });
        break;
      case 'list_providers':
      case 'save_providers':
      case 'set_provider':
      case 'probe_provider':
        // The BYOK family: it shares the management discipline but owns two
        // steps the model-list family does not — retargeting the live client and
        // probing an unsaved endpoint — so it lives in its own module.
        await handleProviderFrame(client, frame, {
          kernel,
          persistProviders: host.persistProviders,
          readProviders: host.readProviders,
          storedApiKey: host.storedApiKey,
          configuredModel: host.configuredModel,
          refreshSeat: host.broadcastState,
        });
        break;
    }
  } catch (err) {
    client.send(serialize({ type: 'error', message: errMessage(err) }));
  }
}
