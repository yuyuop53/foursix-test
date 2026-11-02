import { describe, expect, it } from 'vitest';
import { buildQueue, sortReviews } from './queue';
import type { SrsReview, SrsWord } from './types';

const today = '2027-01-01';

function review(
  itemId: string,
  overrides: Partial<SrsReview> = {},
): SrsReview {
  return {
    itemType: 'word',
    itemId,
    stage: 1,
    dueAt: today,
    suspended: false,
    backlog: false,
    lapses: 0,
    lastReviewedAt: '2026-12-20',
    ...overrides,
  };
}

function wordMap(
  entries: Record<string, number | null>,
): Map<string, SrsWord> {
  return new Map(
    Object.entries(entries).map(([id, frequencyRank]) => [
      id,
      { id, frequencyRank },
    ]),
  );
}

describe('buildQueue', () => {
  it('puts new words first', () => {
    const reviews = [
      review('w_old', { stage: 2 }),
      review('w_new', {
        stage: 0,
        lastReviewedAt: null,
        lapses: 0,
      }),
    ];
    const words = wordMap({ w_old: 10, w_new: 5000 });

    const result = buildQueue({
      today,
      reviews,
      wordsById: words,
      reviewedTodayIds: new Set(),
      cap: 60,
      completedToday: 0,
    });

    expect(result.queue[0].itemId).toBe('w_new');
  });

  it('prioritizes lapses before frequency', () => {
    const reviews = [
      review('w_frequent', { lapses: 0 }),
      review('w_weak', { lapses: 2 }),
    ];
    const result = buildQueue({
      today,
      reviews,
      wordsById: wordMap({ w_frequent: 10, w_weak: 9000 }),
      reviewedTodayIds: new Set(),
      cap: 60,
      completedToday: 0,
    });

    expect(result.queue[0].itemId).toBe('w_weak');
  });

  it('prioritizes core frequency before rare words', () => {
    const reviews = [review('w_rare'), review('w_core')];
    const result = buildQueue({
      today,
      reviews,
      wordsById: wordMap({ w_rare: 5000, w_core: 500 }),
      reviewedTodayIds: new Set(),
      cap: 60,
      completedToday: 0,
    });

    expect(result.queue[0].itemId).toBe('w_core');
  });

  it('prioritizes older due dates and lower stages', () => {
    const reviews = [
      review('w_recent', { dueAt: '2026-12-31', stage: 3 }),
      review('w_old', { dueAt: '2026-12-20', stage: 1 }),
    ];
    const sorted = sortReviews(reviews, wordMap({}), today);
    expect(sorted.map((item) => item.itemId)).toEqual(['w_old', 'w_recent']);
  });

  it('keeps a stable tie-break across calls', () => {
    const reviews = [review('w_b'), review('w_a')];
    const first = sortReviews(reviews, wordMap({}), today).map(
      (item) => item.itemId,
    );
    const second = sortReviews(reviews, wordMap({}), today).map(
      (item) => item.itemId,
    );
    expect(first).toEqual(second);
  });

  it('sorts backlog items after normal items', () => {
    const reviews = [
      review('w_backlog', { backlog: true }),
      review('w_normal', { backlog: false }),
    ];
    const sorted = sortReviews(reviews, wordMap({}), today);
    expect(sorted[0].itemId).toBe('w_normal');
  });

  it('applies the daily cap and excludes completed items', () => {
    const reviews = [
      review('w_1'),
      review('w_2'),
      review('w_3'),
      review('w_done'),
    ];
    const result = buildQueue({
      today,
      reviews,
      wordsById: wordMap({}),
      reviewedTodayIds: new Set(['w_done']),
      cap: 2,
      completedToday: 1,
    });

    expect(result.dueCount).toBe(3);
    expect(result.queue).toHaveLength(1);
    expect(result.remaining).toBe(2);
    expect(result.queue.some((item) => item.itemId === 'w_done')).toBe(false);
  });

  it('excludes suspended items and non-word item types', () => {
    const reviews = [
      review('w_ok'),
      review('w_suspended', { suspended: true }),
      review('m_1', { itemType: 'mistake' }),
    ];
    const result = buildQueue({
      today,
      reviews,
      wordsById: wordMap({}),
      reviewedTodayIds: new Set(),
      cap: 60,
      completedToday: 0,
    });

    expect(result.queue.map((item) => item.itemId)).toEqual(['w_ok']);
  });
});
