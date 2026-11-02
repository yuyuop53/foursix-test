import { describe, expect, it } from 'vitest';
import { median, planBackfill } from './backfill';
import { SRS_RULES } from './grade';
import type { SrsReview } from './types';

const today = '2027-01-01';
const examClamp = '2027-06-11';

function review(itemId: string, dueAt = today): SrsReview {
  return {
    itemType: 'word',
    itemId,
    stage: 1,
    dueAt,
    suspended: false,
    backlog: false,
    lapses: 0,
    lastReviewedAt: '2026-12-20',
  };
}

function input(overrides: Partial<Parameters<typeof planBackfill>[0]> = {}) {
  return {
    today,
    examClamp,
    reviews: [],
    wordsById: new Map(),
    reviewedTodayIds: new Set<string>(),
    dailyReviewCounts: Array.from({ length: 14 }, () => 20),
    rules: SRS_RULES,
    daysUntilExam: 100,
    ...overrides,
  };
}

describe('median', () => {
  it('handles empty, odd, and even inputs', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('planBackfill', () => {
  it('keeps a small overdue backlog on today', () => {
    const reviews = Array.from({ length: 10 }, (_, index) =>
      review(`w_${index}`),
    );
    const plan = planBackfill(input({ reviews }));

    expect(plan.spread).toBe(false);
    expect(plan.scheduled).toBe(10);
    expect(plan.overflow).toBe(0);
    expect(plan.assignments).toHaveLength(10);
    expect(plan.assignments.every((item) => item.dueAt === today)).toBe(true);
    expect(plan.pausedUntil).toBe('2027-01-04');
  });

  it('spreads a large backlog across 3 days with a 24/day capacity', () => {
    const reviews = Array.from({ length: 100 }, (_, index) =>
      review(`w_${index}`),
    );
    const plan = planBackfill(input({ reviews }));

    expect(plan.spread).toBe(true);
    expect(plan.scheduled).toBe(72);
    expect(plan.overflow).toBe(28);
    expect(plan.assignments).toHaveLength(72);
    expect(
      plan.assignments.filter((item) => item.dueAt === '2027-01-01'),
    ).toHaveLength(24);
    expect(
      plan.assignments.filter((item) => item.dueAt === '2027-01-02'),
    ).toHaveLength(24);
    expect(
      plan.assignments.filter((item) => item.dueAt === '2027-01-03'),
    ).toHaveLength(24);
  });

  it('does not spread during the final week', () => {
    const reviews = Array.from({ length: 100 }, (_, index) =>
      review(`w_${index}`),
    );
    const plan = planBackfill(input({ reviews, daysUntilExam: 5 }));

    expect(plan.spread).toBe(false);
    expect(plan.assignments).toHaveLength(24);
    expect(plan.overflow).toBe(76);
    expect(plan.assignments.every((item) => item.dueAt === today)).toBe(true);
    expect(plan.assignments.every((item) => item.backlog)).toBe(true);
  });

  it('clamps spread days to the exam clamp date', () => {
    const reviews = Array.from({ length: 100 }, (_, index) =>
      review(`w_${index}`),
    );
    const plan = planBackfill(
      input({
        reviews,
        examClamp: '2027-01-02',
      }),
    );

    expect(plan.assignments.every((item) => item.dueAt <= '2027-01-02')).toBe(
      true,
    );
  });

  it('uses the baseline floor and cap', () => {
    const reviews = Array.from({ length: 100 }, (_, index) =>
      review(`w_${index}`),
    );
    const plan = planBackfill(
      input({ reviews, dailyReviewCounts: Array.from({ length: 14 }, () => 0) }),
    );

    // floor 20 -> capacity 24
    expect(plan.scheduled).toBe(72);
  });
});
