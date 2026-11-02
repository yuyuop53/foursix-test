import { addDays } from '../time/countdown';
import { sortReviews } from './queue';
import type {
  BackfillAssignment,
  BackfillInput,
  BackfillPlan,
} from './types';

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function planBackfill(input: BackfillInput): BackfillPlan {
  const { rules } = input;

  const baseline = Math.min(
    rules.daily_review_cap,
    Math.max(rules.baseline_floor, median(input.dailyReviewCounts)),
  );
  const capacity = Math.ceil(
    baseline * Math.max(1, rules.backlog_overload_factor),
  );

  const overdue = sortReviews(
    input.reviews.filter(
      (review) =>
        review.itemType === 'word' &&
        !review.suspended &&
        review.dueAt <= input.today &&
        !input.reviewedTodayIds.has(review.itemId),
    ),
    input.wordsById,
    input.today,
  );

  const assignments: BackfillAssignment[] = [];
  let overflow = 0;
  let scheduled = 0;
  let spread = false;

  if (overdue.length <= capacity) {
    for (const review of overdue) {
      assignments.push({
        review,
        dueAt: input.today,
        backlog: false,
      });
    }
    scheduled = overdue.length;
  } else if (input.daysUntilExam <= 7) {
    const todayItems = overdue.slice(0, capacity);
    for (const review of todayItems) {
      assignments.push({
        review,
        dueAt: input.today,
        backlog: true,
      });
    }
    overflow = overdue.length - todayItems.length;
    scheduled = todayItems.length;
    spread = false;
  } else {
    spread = true;
    const dayCount = Math.min(
      rules.backlog_spread_days,
      rules.backlog_allocation.length,
    );
    const totalScheduled = Math.min(overdue.length, capacity * dayCount);
    const targets = rules.backlog_allocation
      .slice(0, dayCount)
      .map((weight) => Math.round(totalScheduled * weight));
    const quotas = new Array<number>(dayCount).fill(0);
    let remaining = totalScheduled;

    for (let index = 0; index < dayCount; index += 1) {
      quotas[index] = Math.min(capacity, targets[index] ?? 0, remaining);
      remaining -= quotas[index];
    }

    for (let index = 0; index < dayCount && remaining > 0; index += 1) {
      const extra = Math.min(capacity - quotas[index], remaining);
      quotas[index] += extra;
      remaining -= extra;
    }

    let cursor = 0;
    quotas.forEach((quota, dayIndex) => {
      const dueAt = addDays(input.today, dayIndex);
      const clampedDueAt =
        dueAt > input.examClamp ? input.examClamp : dueAt;
      const items = overdue.slice(cursor, cursor + quota);
      cursor += items.length;
      for (const review of items) {
        assignments.push({
          review,
          dueAt: clampedDueAt,
          backlog: true,
        });
      }
    });

    scheduled = cursor;
    overflow = overdue.length - cursor;
  }

  return {
    assignments,
    pausedUntil: addDays(
      input.today,
      rules.pause_new_words_days_after_backlog,
    ),
    scheduled,
    overflow,
    spread,
  };
}
