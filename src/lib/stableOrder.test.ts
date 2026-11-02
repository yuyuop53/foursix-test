import { beforeEach, describe, expect, it } from 'vitest';
import { getStableOrder, resetStableOrder } from './stableOrder';

const ids = Array.from({ length: 20 }, (_, index) => `w${index}`);

beforeEach(() => {
  resetStableOrder('test-order');
});

describe('getStableOrder', () => {
  it('returns a permutation on first load', () => {
    const order = getStableOrder('test-order', ids);
    expect(order).toHaveLength(ids.length);
    expect([...order].sort()).toEqual([...ids].sort());
  });

  it('keeps the same order on subsequent calls', () => {
    const first = getStableOrder('test-order', ids);
    const second = getStableOrder('test-order', ids);
    expect(second).toEqual(first);
  });

  it('appends new ids without disturbing the existing relative order', () => {
    const first = getStableOrder('test-order', ids);
    const extended = getStableOrder('test-order', [...ids, 'w20']);

    expect(extended.slice(0, ids.length)).toEqual(first);
    expect(extended[ids.length]).toBe('w20');
  });

  it('drops removed ids while preserving the remaining order', () => {
    const first = getStableOrder('test-order', ids);
    const reduced = ids.filter((id) => id !== 'w5');
    const second = getStableOrder('test-order', reduced);

    expect(second).toEqual(first.filter((id) => id !== 'w5'));
  });

  it('returns an empty array for no ids', () => {
    expect(getStableOrder('test-order', [])).toEqual([]);
  });

  it('generates a fresh permutation after reset', () => {
    const first = getStableOrder('test-order', ids);
    resetStableOrder('test-order');
    const second = getStableOrder('test-order', ids);

    expect([...second].sort()).toEqual([...ids].sort());
    expect(second).toHaveLength(first.length);
  });
});
