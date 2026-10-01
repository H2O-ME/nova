/**
 * The `context` plugin: it provides the context-insight capability and nothing
 * else.
 *
 * A plugin with no tools, no commands and no hooks is unusual here, so the
 * reason belongs in writing: reading a session's window is a WALK OVER THE WHOLE
 * LOG, and most sessions never ask for it. Making it a tier-gated provider is
 * what keeps that cost off the default install — the fold runs only when
 * something consumes the service, and the consumer is the web surface, which
 * renders the panel only when the service is there. So the presence of this
 * provider IS the on/off switch: there is no second flag, and no way for a
 * settings row and the data to disagree about whether the feature is on.
 *
 * It is `advanced` (off until `plugins.enable` names it) for the same reason
 * `subagent` and `ptc` are: nothing a fresh install needs, and its absence
 * costs a reader only a tab that is not drawn.
 */
import { contextInsights as contextInsightsKey, type Plugin } from '@nova-agent/core';
import { contextInsightsOf } from './fold.js';

export const contextPlugin: Plugin = {
  name: 'context',
  description: 'Folds a session log into a context reading: composition, per-request trend, events and file activity.',
  apply(ctx): void {
    ctx.provide(contextInsightsKey, contextInsightsOf());
  },
};
