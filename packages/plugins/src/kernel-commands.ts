/**
 * The kernel's own slash commands — the `commands` capability seam's first
 * producer (core declares `CommandRegistry`; nothing registered into it until
 * now, so every surface had to invent its own catalog).
 *
 * What belongs here: commands a kernel can run **on itself**, with no surface's
 * help — `/compact` is the model case (it summarizes the live session; the
 * compaction lifecycle then rides the event stream, so the surface only has to
 * render rows it already knows). What does not: anything that needs a surface
 * affordance (`/theme` needs a renderer, `/exit` needs a process, `/model`
 * needs the picker) — those stay with their surface, and a surface may offer
 * them beside this catalog without a second registry.
 *
 * Registration goes through `registerCommand` (the public plugin API a third
 * party would use), which ties the entry to this plugin's fiber — so a
 * re-roster unregisters cleanly.
 */
import { commands as commandsKey, errMessage, sessions as sessionsKey, type CommandDefinition, type Plugin } from '@nova-agent/core';
import { goalCommand } from './goal-command.js';
import { registerCommand } from './toolbox.js';
import type { Environment } from './runtime-env.js';

/** One row a surface offers: what to type and what it does. */
export interface CommandSummary {
  name: string;
  description: string;
}

/**
 * The live catalog and the one runner, both reading the container (never a
 * snapshot), so a plugin that registers a command — first-party or third —
 * shows up in every surface's menu and is runnable by the same path.
 */
export function commandRunner(env: Environment): {
  catalog: () => readonly CommandSummary[];
  run: (name: string, args: string) => Promise<void>;
} {
  const current = () => env.root.get(sessionsKey)?.current();
  return {
    catalog: () =>
      (env.root.get(commandsKey)?.all() ?? []).map((command) => ({
        name: command.name,
        description: command.description,
      })),
    run: async (name, args) => {
      const registry = env.root.get(commandsKey);
      const command = registry?.all().find((entry) => entry.name === name);
      const agent = current();
      if (command === undefined) {
        agent?.announceCommand(name, 'done', `未知命令：/${name}`);
        return;
      }
      // The row opens before the work and closes with its outcome: a command
      // that throws reports its reason in the SAME row instead of leaving a
      // half-finished one behind (and never fails the caller's run).
      agent?.announceCommand(name, 'run');
      const lines: string[] = [];
      try {
        await command.run(args, {
          rootDir: env.state.rootDir,
          log: (message) => { lines.push(message); },
        });
        agent?.announceCommand(name, 'done', lines.join('\n'));
      } catch (err) {
        agent?.announceCommand(name, 'done', lines.concat(errMessage(err)).join('\n'));
      }
    },
  };
}


/** The kernel-executable catalog. */
export function kernelCommandsPlugin(env: Environment): Plugin {
  return {
    name: 'commands',
    inject: [commandsKey],
    apply: (ctx) => {
      const commands: CommandDefinition[] = [
        {
          name: 'compact',
          description: '压缩上下文：总结历史，日志保留完整记录',
          async run(_args, out) {
            const agent = env.root.get(sessionsKey)?.current();
            if (agent === undefined) {
              out.log('没有可压缩的活动会话');
              return;
            }
            // The refusal copy here is UX, not enforcement: core's compaction
            // runner is the single guard (`cannot compact while a run is
            // active`) — this pre-check only makes the row say it in the
            // product's language. The work itself reports: `compaction`
            // start/summary/end events are already the transcript's rows.
            if (agent.running) {
              out.log('本轮进行中，压缩会在轮结束后自动把关（或稍后再试）');
              return;
            }
            await agent.compact('manual');
          },
        },
        // `/goal` owns its own grammar and its state-dependent command list, so
        // it lives in its own module; this catalog only needs the row, and the
        // session it acts on is read at run time (a command outlives a switch).
        goalCommand(() => env.root.get(sessionsKey)?.current()),
      ];
      for (const command of commands) registerCommand(ctx, command);
    },
  };
}