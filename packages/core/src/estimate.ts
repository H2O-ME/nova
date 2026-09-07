import type { AgentMessage, Usage } from './types.js';

/**
 * Heuristic token pricing used between provider calls: CJK characters are
 * roughly one token each, other text roughly four characters per token, plus
 * a small per-message role-framing allowance. This mirrors dsh's fixed
 * heuristic anchor; it never replaces real `usage` numbers, only bridges the
 * gaps between them (compaction pre-checks before the next request).
 */

const CJK_RANGE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

const FRAMING_TOKENS = 4;

/** Price a raw text blob (system prompts, tool schemas) with the same heuristic. */
export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RANGE.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateMessageTokens(msg: AgentMessage): number {
  return FRAMING_TOKENS + estimateTextTokens(msg.content);
}

/**
 * Project the next request's prompt tokens: the last successful provider
 * usage anchors the whole request image, and only messages appended after
 * that call need re-pricing (dsh token-meter's anchor + delta repricing,
 * simplified to whole-message granularity).
 */
export function estimateNextPromptTokens(anchor: Usage, added: AgentMessage[]): number {
  let total = anchor.promptTokens;
  for (const msg of added) total += estimateMessageTokens(msg);
  return total;
}
