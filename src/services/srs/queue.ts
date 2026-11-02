import { calendarDaysBetween } from '../time/countdown';
import type {
  QueueInput,
  QueueResult,
  SrsReview,
  SrsWord,
} from './types';

export function stableHash(input: string): number {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash % 1000;
}

export function reviewPriority(
  review: SrsReview,
  word: SrsWord | undefined,
  today: string,
): number[] {
  const isNew = review.stage === 0 && !review.lastReviewedAt;
  const lapses = review.lapses ?? 0;
  const frequencyRank = word?.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const overdueDays = Math.max(
    0,
    calendarDaysBetween(review.dueAt, today),
  );

  return [
    isNew ? 0 : 1,
    lapses >= 2 ? 0 : 1,
    frequencyRank <= 2000 ? 0 : 1,
    -overdueDays,
    review.stage,
    calendarDaysBetween('1970-01-01', review.dueAt),
    stableHash(`${review.itemType}:${review.itemId}`),
  ];
}

function comparePriority(
  a: SrsReview,
  b: SrsReview,
  wordsById: Map<string, SrsWord>,
  today: string,
): number {
  const pa = reviewPriority(a, wordsById.get(a.itemId), today);
  const pb = reviewPriority(b, wordsById.get(b.itemId), today);

  for (let index = 0; index < pa.length; index += 1) {
    if (pa[index] !== pb[index]) return pa[index] - pb[index];
  }
  return 0;
}

export function sortReviews(
  reviews: SrsReview[],
  wordsById: Map<string, SrsWord>,
  today: string,
): SrsReview[] {
  return [...reviews].sort((a, b) => {
    if (a.backlog !== b.backlog) return a.backlog ? 1 : -1;
    return comparePriority(a, b, wordsById, today);
  });
}

export function buildQueue(input: QueueInput): QueueResult {
  const due = input.reviews.filter(
    (review) =>
      review.itemType === 'word' &&
      !review.suspended &&
      review.dueAt <= input.today &&
      !input.reviewedTodayIds.has(review.itemId),
  );

  const sorted = sortReviews(due, input.wordsById, input.today);
  const remainingCap = Math.max(0, input.cap - input.completedToday);
  const queue = sorted.slice(0, remainingCap);

  return {
    queue,
    dueCount: sorted.length,
    remaining: Math.max(0, sorted.length - queue.length),
  };
}
