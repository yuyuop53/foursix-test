import type { PolicyInput, PolicyPlan } from './types';

export function planExamPolicy(input: PolicyInput): PolicyPlan {
  const { rules } = input;
  const suspensions: PolicyPlan['suspensions'] = [];
  const dueAtClamps: PolicyPlan['dueAtClamps'] = [];
  let newWordsPausedUntil: string | null = null;

  if (input.daysUntilExam <= rules.stop_new_words_days_before_exam) {
    newWordsPausedUntil = input.examClamp;
  }

  for (const review of input.reviews) {
    if (review.itemType !== 'word' || review.suspended) continue;

    if (input.daysUntilExam <= rules.core_only_days_before_exam) {
      const word = input.wordsById.get(review.itemId);
      const frequencyRank = word?.frequencyRank;
      const lapses = review.lapses ?? 0;

      if (
        typeof frequencyRank === 'number' &&
        frequencyRank > rules.core_frequency_rank_max &&
        lapses < rules.core_lapses_min
      ) {
        suspensions.push({ review, reason: 'exam_core_only' });
        continue;
      }
    }

    if (review.dueAt > input.examClamp) {
      dueAtClamps.push({
        review,
        dueAt: input.examClamp < input.today ? input.today : input.examClamp,
      });
    }
  }

  return { suspensions, dueAtClamps, newWordsPausedUntil };
}
