import { describe, expect, it } from 'vitest';
import { planExamPolicy } from './policy';
import { SRS_RULES } from './grade';
import type { SrsReview } from './types';

const today = '2027-01-01';
const examClamp = '2027-06-11';

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
    ...overrides,
  };
}

function input(
  overrides: Partial<Parameters<typeof planExamPolicy>[0]> = {},
) {
  return {
    today,
    examClamp,
    daysUntilExam: 20,
    reviews: [],
    wordsById: new Map(),
    rules: SRS_RULES,
    ...overrides,
  };
}

describe('planExamPolicy', () => {
  it('does nothing outside the configured windows', () => {
    const plan = planExamPolicy(input());
    expect(plan.newWordsPausedUntil).toBeNull();
    expect(plan.suspensions).toHaveLength(0);
    expect(plan.dueAtClamps).toHaveLength(0);
  });

  it('stops new words at D<=14', () => {
    const plan = planExamPolicy(input({ daysUntilExam: 14 }));
    expect(plan.newWordsPausedUntil).toBe(examClamp);
  });

  it('suspends non-core words at D<=3 but keeps core and lapsed words', () => {
    const reviews = [
      review('w_rare'),
      review('w_rare_lapsed', { lapses: 2 }),
      review('w_core'),
    ];
    const words = new Map([
      ['w_rare', { id: 'w_rare', frequencyRank: 3000 }],
      ['w_rare_lapsed', { id: 'w_rare_lapsed', frequencyRank: 3000 }],
      ['w_core', { id: 'w_core', frequencyRank: 500 }],
    ]);

    const plan = planExamPolicy(
      input({ daysUntilExam: 3, reviews, wordsById: words }),
    );

    expect(plan.suspensions.map((item) => item.review.itemId)).toEqual([
      'w_rare',
    ]);
  });

  it('does not suspend words with unknown frequencyRank', () => {
    const reviews = [review('w_unknown')];
    const words = new Map([['w_unknown', { id: 'w_unknown', frequencyRank: null }]]);

    const plan = planExamPolicy(
      input({ daysUntilExam: 3, reviews, wordsById: words }),
    );
    expect(plan.suspensions).toHaveLength(0);
  });

  it('ignores mistake reviews for suspension', () => {
    const reviews = [
      review('m_1', { itemType: 'mistake' }),
    ];
    const words = new Map([['m_1', { id: 'm_1', frequencyRank: 9000 }]]);

    const plan = planExamPolicy(
      input({ daysUntilExam: 3, reviews, wordsById: words }),
    );
    expect(plan.suspensions).toHaveLength(0);
  });

  it('clamps future due dates to the exam clamp', () => {
    const reviews = [
      review('w_future', { dueAt: '2027-08-01' }),
      review('w_past', { dueAt: '2026-12-01' }),
    ];

    const plan = planExamPolicy(input({ reviews }));

    expect(plan.dueAtClamps).toHaveLength(1);
    expect(plan.dueAtClamps[0]).toMatchObject({
      review: reviews[0],
      dueAt: examClamp,
    });
  });

  it('uses today when the exam clamp is already in the past', () => {
    const reviews = [review('w_future', { dueAt: '2027-06-20' })];
    const plan = planExamPolicy(
      input({
        today: '2027-06-12',
        examClamp: '2027-06-11',
        reviews,
      }),
    );

    expect(plan.dueAtClamps[0].dueAt).toBe('2027-06-12');
  });
});
