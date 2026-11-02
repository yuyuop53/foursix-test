import { db } from './db';
import {
  addDays,
  calendarDaysBetween,
  getCountdown,
  todayKey,
} from '../services/time/countdown';
import {
  examClampDate,
  planBackfill,
  planExamPolicy,
  SRS_RULES,
  type SrsReview,
  type SrsWord,
} from '../services/srs';

export interface MaintenanceResult {
  today: string;
  daysUntilExam: number;
  backfillApplied: boolean;
  scheduled: number;
  overflow: number;
  pausedUntil: string | null;
  suspensions: number;
  dueAtClamps: number;
}

function maxDate(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return left >= right ? left : right;
}

export async function runSrsMaintenance(): Promise<MaintenanceResult> {
  await db.open();

  const today = todayKey();
  const examClamp = examClampDate();
  const countdown = getCountdown();
  const now = new Date().toISOString();

  const [profile, reviews, words, dailyLogs, reviewLogs] = await Promise.all([
    db.profile.get('me'),
    db.reviews.toArray(),
    db.words.toArray(),
    db.dailyLogs.toArray(),
    db.reviewLogs.toArray(),
  ]);

  const wordsById = new Map<string, SrsWord>(
    words.map((word) => [
      word.id,
      { id: word.id, frequencyRank: word.frequencyRank },
    ]),
  );
  const srs = profile?.srs ?? {
    lastActiveAt: null,
    lastBackfillAt: null,
    newWordsPausedUntil: null,
    lastPlanDate: null,
  };

  const policy = planExamPolicy({
    today,
    examClamp,
    daysUntilExam: countdown.daysToExam,
    reviews,
    wordsById,
    rules: SRS_RULES,
  });

  let pausedUntil = maxDate(
    srs.newWordsPausedUntil,
    policy.newWordsPausedUntil,
  );
  let backfillApplied = false;
  let scheduled = 0;
  let overflow = 0;
  let lastBackfillAt = srs.lastBackfillAt;

  const reviewedTodayIds = new Set(
    reviewLogs
      .filter(
        (log) =>
          log.itemType === 'word' && todayKey(new Date(log.reviewedAt)) === today,
      )
      .map((log) => log.itemId),
  );

  const shouldBackfill =
    Boolean(srs.lastActiveAt) &&
    calendarDaysBetween(srs.lastActiveAt as string, today) >=
      SRS_RULES.backlog_trigger_days &&
    srs.lastBackfillAt !== today;

  if (shouldBackfill) {
    const logsByDate = new Map(dailyLogs.map((log) => [log.date, log]));
    const dailyReviewCounts = Array.from(
      { length: SRS_RULES.baseline_window_days },
      (_, index) => {
        const date = addDays(
          today,
          -(SRS_RULES.baseline_window_days - 1 - index),
        );
        return logsByDate.get(date)?.reviewsDone ?? 0;
      },
    );

    const plan = planBackfill({
      today,
      examClamp,
      reviews,
      wordsById,
      reviewedTodayIds,
      dailyReviewCounts,
      rules: SRS_RULES,
      daysUntilExam: countdown.daysToExam,
    });

    backfillApplied = true;
    scheduled = plan.scheduled;
    overflow = plan.overflow;
    pausedUntil = maxDate(pausedUntil, plan.pausedUntil);
    lastBackfillAt = today;

    await db.transaction(
      'rw',
      db.reviews,
      db.dailyLogs,
      db.profile,
      async () => {
        for (const suspension of policy.suspensions) {
          if (suspension.review.id === undefined) continue;
          await db.reviews.update(suspension.review.id, {
            suspended: true,
            suspendedReason: 'exam_core_only',
            updatedAt: now,
          });
        }

        for (const clamp of policy.dueAtClamps) {
          if (clamp.review.id === undefined) continue;
          await db.reviews.update(clamp.review.id, {
            dueAt: clamp.dueAt,
            updatedAt: now,
          });
        }

        for (const assignment of plan.assignments) {
          if (assignment.review.id === undefined) continue;
          await db.reviews.update(assignment.review.id, {
            dueAt: assignment.dueAt,
            backlog: assignment.backlog,
            adjustedAt: now,
            updatedAt: now,
          });
        }

        const log = await db.dailyLogs.get(today);
        await db.dailyLogs.put({
          date: today,
          phase: getCountdown().phase.id,
          minutes: log?.minutes ?? 0,
          questionsDone: log?.questionsDone ?? 0,
          correctCount: log?.correctCount ?? 0,
          newWords: log?.newWords ?? 0,
          reviewsDone: log?.reviewsDone ?? 0,
          backlogAssigned: plan.scheduled,
          backlogOverflow: plan.overflow,
          note: log?.note,
        });

        await db.profile.put({
          ...(profile ?? {
            id: 'me' as const,
            targetScore: 425,
            dailyMinutes: 60,
            registered: false,
            createdAt: now,
            preferences: {},
          }),
          srs: {
            lastActiveAt: today,
            lastBackfillAt,
            newWordsPausedUntil: pausedUntil,
            lastPlanDate: today,
          },
        });
      },
    );
  } else if (policy.suspensions.length > 0 || policy.dueAtClamps.length > 0) {
    await db.transaction('rw', db.reviews, db.profile, async () => {
      for (const suspension of policy.suspensions) {
        if (suspension.review.id === undefined) continue;
        await db.reviews.update(suspension.review.id, {
          suspended: true,
          suspendedReason: 'exam_core_only',
          updatedAt: now,
        });
      }

      for (const clamp of policy.dueAtClamps) {
        if (clamp.review.id === undefined) continue;
        await db.reviews.update(clamp.review.id, {
          dueAt: clamp.dueAt,
          updatedAt: now,
        });
      }

      if (profile) {
        await db.profile.put({
          ...profile,
          srs: {
            ...srs,
            lastActiveAt: today,
            newWordsPausedUntil: pausedUntil,
            lastPlanDate: today,
          },
        });
      }
    });
  } else if (profile) {
    await db.profile.put({
      ...profile,
      srs: {
        ...srs,
        lastActiveAt: today,
        newWordsPausedUntil: pausedUntil,
        lastPlanDate: today,
      },
    });
  }

  return {
    today,
    daysUntilExam: countdown.daysToExam,
    backfillApplied,
    scheduled,
    overflow,
    pausedUntil,
    suspensions: policy.suspensions.length,
    dueAtClamps: policy.dueAtClamps.length,
  };
}
