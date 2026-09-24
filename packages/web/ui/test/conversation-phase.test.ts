/**
 * Direct lane for the hero/settling/active choice: the column's `data-phase`
 * decides between a centered hero composer, an invisible (still mounted) seat,
 * and the docked active layout.
 */
import { describe, expect, it } from 'vitest';
import { conversationPhase } from '../src/conversation/phase.js';

describe('conversationPhase', () => {
  it('is the hero without a bound session', () => {
    expect(conversationPhase({ bound: false, blank: true, replaying: false })).toBe('hero');
    // Even mid-replay: there is no session to replay into.
    expect(conversationPhase({ bound: false, blank: true, replaying: true })).toBe('hero');
  });

  it('is active as soon as the transcript holds anything', () => {
    expect(conversationPhase({ bound: true, blank: false, replaying: false })).toBe('active');
    expect(conversationPhase({ bound: true, blank: false, replaying: true })).toBe('active');
  });

  it('settles a bound but still-blank session while history is in flight', () => {
    expect(conversationPhase({ bound: true, blank: true, replaying: true })).toBe('settling');
    expect(conversationPhase({ bound: true, blank: true, replaying: false })).toBe('hero');
  });
});