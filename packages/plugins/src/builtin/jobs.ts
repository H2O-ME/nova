import type { ToolExecuteContext } from '@nova-agent/core';
import type { Plugin } from '../types.js';

function formatStatus(status: string): string {
  return status;
}

/**
 * Model-facing control surface for background jobs started via
 * `bash { run_in_background: true }`. Jobs that finish naturally
 * (completed/failed) are announced automatically on the next LLM request
 * via JobRegistry.drainFinished() — the model does NOT need to poll.
 * This tool is for reading incremental output or stopping a job early.
 */
export function jobsPlugin(): Plugin {
  return {
    name: 'jobs',
    description: 'Inspect and control background jobs started with the bash tool.',
    activate(ctx) {
      ctx.registerTool({
        name: 'jobs',
        description:
          'Lists, reads output of, or stops background jobs. Args: action ("list" | "output" | "stop", required), id (required for output/stop). A background job that finishes is announced to you automatically — do not poll in a loop; when notified, read its output once with action=output.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'output', 'stop'],
              description: 'list all jobs, read new output since the last read, or request termination.',
            },
            id: { type: 'string', description: 'Job id (e.g. "bash-1"); required for output and stop.' },
          },
          required: ['action'],
          additionalProperties: false,
        },
        async execute(args, c: ToolExecuteContext) {
          if (c.jobs === undefined) return 'No background jobs available in this context.';
          const action = typeof args['action'] === 'string' ? args['action'] : 'list';

          if (action === 'list') {
            const jobs = c.jobs.list();
            if (jobs.length === 0) return 'No background jobs.';
            return jobs
              .map((job) => `- ${job.id} [${formatStatus(job.status)}] ${job.label}${job.detail !== undefined ? ` (${job.detail})` : ''}`)
              .join('\n');
          }

          const id = typeof args['id'] === 'string' ? args['id'] : '';
          if (id.length === 0) return 'Error: id is required for output and stop actions';

          if (action === 'output') {
            const job = c.jobs.get(id);
            if (job === undefined) return `Error: unknown job "${id}"`;
            const output = c.jobs.readOutput(id);
            const lines = [`${job.id} [${job.status}] ${job.label}${job.detail !== undefined ? ` (${job.detail})` : ''}`];
            lines.push(output !== undefined && output.length > 0 ? output : '(no new output since last read)');
            return lines.join('\n');
          }

          // action === 'stop'
          const stopped = await c.jobs.stop(id, 'stopped by model');
          if (stopped === undefined) return `Error: unknown job "${id}"`;
          return `Stop requested for ${stopped.id}. Current status: ${stopped.status}.`;
        },
        // Querying/observing the agent's own jobs has no side effects beyond
        // stop; killing a job the agent itself spawned is gated as read.
        isConcurrencySafe() {
          return true;
        },
      }, { permission: 'read' });
    },
  };
}
