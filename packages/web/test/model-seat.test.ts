/**
 * The model seat's server half, on its own: the two facts the wire has to carry
 * (`ready`/`state` name the model in force; the gauge needs the window behind
 * it) and the one fetch. No kernel, no sockets — the controller's own test
 * covers the seam.
 */
import { describe, expect, it } from 'vitest';
import type { ModelControl } from '@nova-agent/core';
import { MODEL_LIST_FAILED, ModelSeat } from '../src/model-seat.js';

/** A stateful stand-in: `select` moves `current`, as the real client does. */
function control(over: Partial<ModelControl> = {}): ModelControl {
  let id = 'm1';
  return {
    current: () => id,
    list: async () => [{ id: 'endpoint', name: 'api.test', models: [{ id: 'm1', name: 'm1' }] }],
    select: async (model) => {
      id = model;
      return { id: model, name: model };
    },
    ...over,
  };
}

describe('ModelSeat', () => {
  it('is inert without a retargetable client, and says why', async () => {
    const seat = new ModelSeat(undefined, 'shell-model', 128_000);
    expect(seat.switching).toBe(false);
    expect(seat.model).toBe('shell-model'); // the shell's label is all we have
    expect(seat.contextWindow).toBe(128_000);
    expect(await seat.list()).toEqual({ groups: [], current: 'shell-model', error: expect.stringContaining('模型目录') });
    await expect(seat.select('m2')).rejects.toThrow();
  });

  it('prefers the live client id over the label the shell passed', async () => {
    const seat = new ModelSeat(control(), 'stale-label', undefined);
    expect(seat.switching).toBe(true);
    expect(seat.model).toBe('m1');
    expect(await seat.list()).toMatchObject({ current: 'm1' });
  });

  it('answers a failed listing with a reason instead of throwing at the socket', async () => {
    const seat = new ModelSeat(
      control({
        list: () => Promise.reject(new Error('network down')),
      }),
      'm1',
      undefined,
    );
    expect(await seat.list()).toEqual({ groups: [], current: 'm1', error: MODEL_LIST_FAILED });
  });

  it('takes the id from the client, the label and window from the kernel event', async () => {
    const seat = new ModelSeat(control(), 'm1', 128_000, 'Model One');
    expect(seat.model).toBe('m1');
    expect(seat.name).toBe('Model One');
    // The real order: the switch applies on the client, THEN the kernel
    // announces it — the seat reads both back from there.
    await seat.select('m2');
    seat.apply('m2', { name: 'Model Two', contextWindow: 4096 });
    expect(seat.model).toBe('m2');
    expect(seat.name).toBe('Model Two');
    expect(seat.contextWindow).toBe(4096);
    // A model nobody has metadata for falls back to its id and CLEARS the
    // denominator: the previous model's number would print a percentage that
    // belongs to a model no longer in use.
    await seat.select('m3');
    seat.apply('m3', {});
    expect(seat.model).toBe('m3');
    expect(seat.name).toBe('m3');
    expect(seat.contextWindow).toBeUndefined();
  });
});