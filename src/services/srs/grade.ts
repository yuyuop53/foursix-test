import datesConfig from '../../../config/dates.json';
import rulesConfig from '../../../config/exam_rules.json';
import { addDays } from '../time/countdown';
import type { GradeInput, GradeResult, SrsRules } from './types';

export const SRS_LADDER = rulesConfig.srs.ladder_days as number[];

export const SRS_RULES = rulesConfig.srs as unknown as SrsRules;

export function examClampDate(): string {
  return addDays(
    datesConfig.exam_date,
    -Math.max(0, SRS_RULES.clamp_days_before_exam),
  );
}

export function gradeCard(input: GradeInput): GradeResult {
  const ladder = SRS_LADDER;
  const maxStage = ladder.length - 1;
  const previousStage = Math.max(0, Math.min(maxStage, input.stage));
  const previousLapses = Math.max(0, input.lapses ?? 0);

  let nextStage = previousStage;
  let intervalDays = ladder[previousStage];
  let lapses = previousLapses;

  switch (input.grade) {
    case 'again':
      nextStage = 0;
      intervalDays = ladder[0];
      lapses += 1;
      break;
    case 'hard':
      nextStage = previousStage;
      intervalDays = ladder[previousStage];
      break;
    case 'good':
      nextStage = Math.min(maxStage, previousStage + 1);
      intervalDays = ladder[nextStage];
      break;
    case 'easy':
      nextStage = Math.min(maxStage, previousStage + 2);
      intervalDays = ladder[nextStage];
      break;
  }

  let dueAt = addDays(input.today, intervalDays);
  if (dueAt > input.examClamp) dueAt = input.examClamp;
  if (dueAt < input.today) dueAt = input.today;

  return {
    stage: nextStage,
    intervalDays,
    dueAt,
    lapses,
  };
}

/** Phase 1 compatibility wrapper. */
export function scheduleNext(
  stage: number,
  correct: boolean,
  today: string = new Date().toISOString().slice(0, 10),
): GradeResult {
  return gradeCard({
    stage,
    grade: correct ? 'good' : 'again',
    today,
    examClamp: examClampDate(),
  });
}
