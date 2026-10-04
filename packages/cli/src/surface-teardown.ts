/**
 * Undoing an assembly that ended in a REFUSAL.
 *
 * `surface-host.ts` assembles and then runs a surface; a surface that will not
 * serve this invocation throws out of `start`. By then the host has already paid
 * for a kernel — and the assembly opens a session on its way (`runtime-session.ts`
 * writes the log, the workspace marker and the context fragment BEFORE any prompt
 * exists). So "I will not run" used to leave a blank `~/.nova/sessions/…` line
 * behind: `nova qqbot` with its row missing, switched off or unloadable still
 * produced one empty session per invocation. That is the concrete form of "a
 * plugin that is switched off still did something at boot".
 *
 * It lives in its own module because it is the mirror of the assembly, not part
 * of it: `surface-host.ts` decides what to build, this decides what to take back.
 *
 * ## Why the refusal is not moved earlier instead
 *
 * The cleanest fix would be to refuse BEFORE the kernel exists. Two of the
 * refusals cannot be hoisted: "the row the surface depends on is missing / off /
 * would not load" and "the row loaded but its channel has no credentials" are
 * facts about a live roster, and the roster is a product of the assembly.
 * Deciding them earlier would require a SECOND reader of a row's state beside
 * `plugin-report.ts`'s ONE reader — two answers to "what state is this row in",
 * which is exactly the drift this repo keeps paying for. So the decision stays
 * where it is exact, and the OUTCOME is guaranteed here instead.
 */
import path from 'node:path';
import { deleteSessionLog, isBlankSession, type AgentSurfaceKernel } from '@nova-agent/core';

/**
 * Tear down a boot that ended in a refusal, so the refusal leaves nothing behind.
 *
 * Two guards keep the cleanup honest, and both are about NOT overreaching:
 *
 *  - only a session this boot CREATED is a candidate — `resumeFile` names the
 *    operator's own log, and a refusal must never delete it;
 *  - only a session that is still BLANK is removed (core's `isBlankSession`, the
 *    same rule the session list and the "new session" button use). A log with a
 *    real prompt in it is a record of work; an empty shell is not.
 *
 * The path to delete comes from the session store itself (`agent.session.file`),
 * never from input, and its own bucket is the boundary (`deleteSessionLog`'s
 * `root`) — so this can only ever remove a log that lives where logs live.
 *
 * Best-effort by design: the caller is about to report the REAL reason, and a
 * cleanup failure must not replace it with its own.
 * @param kernel - the kernel the assembly produced for the refused surface.
 * @param resumeFile - the invocation's `--resume` target, when there was one.
 */
export async function discardRefusedBoot(
  kernel: AgentSurfaceKernel,
  resumeFile: string | undefined,
): Promise<void> {
  try {
    const agent = kernel.agent;
    if (resumeFile === undefined && isBlankSession(agent.messages)) {
      const { file } = agent.session;
      // Seal BEFORE unlinking: `appendFile` recreates a missing file, so a run
      // still in flight would resurrect the log we just removed — the session
      // store's own documented reason for sealing on close.
      await agent.dispose();
      await deleteSessionLog(file, path.dirname(file));
    }
    await kernel.dispose();
  } catch {
    // The refusal is the message that matters — see above.
  }
}
