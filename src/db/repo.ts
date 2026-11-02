import type { QuestionRecord } from './types';
import type {
  MistakeRecord,
  ReviewGrade,
  ReviewItemType,
  ReviewRecord,
  SessionMode,
  WordRecord,
} from './types';
import { db } from './db';
import { getCountdown, todayKey } from '../services/time/countdown';
import { examClampDate, gradeCard, SRS_RULES } from '../services/srs';
import { slugify } from '../lib/utils';

const EMPTY_SRS = {
  lastActiveAt: null,
  lastBackfillAt: null,
  newWordsPausedUntil: null,
  lastPlanDate: null,
};

export async function ensureReview(
  itemType: ReviewItemType,
  itemId: string,
  dueAt: string,
): Promise<number> {
  const now = new Date().toISOString();
  const existing = await db.reviews
    .where('[itemType+itemId]')
    .equals([itemType, itemId])
    .first();

  if (existing?.id !== undefined) {
    await db.reviews.update(existing.id, {
      dueAt,
      suspended: false,
      suspendedReason: null,
      backlog: false,
      updatedAt: now,
    });
    return existing.id;
  }

  return db.reviews.add({
    itemType,
    itemId,
    stage: 0,
    dueAt,
    suspended: false,
    backlog: false,
    updatedAt: now,
    lapses: 0,
    introducedAt: now,
    lastReviewedAt: null,
    lastGrade: null,
    adjustedAt: null,
    suspendedReason: null,
  });
}

export async function startSession(
  examId: string,
  mode: SessionMode,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.sessions.add({
    id,
    examId,
    mode,
    startedAt: new Date().toISOString(),
  });
  return id;
}

export interface RecordAnswerInput {
  sessionId: string;
  examId: string;
  question: QuestionRecord;
  selected: string;
  timeSpentSec?: number;
  mode: SessionMode;
}

export async function recordAnswer(
  input: RecordAnswerInput,
): Promise<{ isCorrect: boolean; mastered: boolean }> {
  const { question, selected } = input;
  const isCorrect = selected === question.answer;
  const now = new Date().toISOString();
  const reviewDue = todayKey();
  let mastered = false;

  await db.transaction(
    'rw',
    db.attempts,
    db.mistakes,
    db.reviews,
    async () => {
      await db.attempts.add({
        sessionId: input.sessionId,
        examId: input.examId,
        questionId: question.id,
        mode: input.mode,
        selected,
        isCorrect,
        createdAt: now,
        timeSpentSec: Math.max(0, Math.round(input.timeSpentSec ?? 0)),
        phase: getCountdown().phase.id,
      });

      const existing = await db.mistakes
        .where('questionId')
        .equals(question.id)
        .first();

      if (isCorrect) {
        if (existing?.id !== undefined && existing.status === 'open') {
          const correctStreak = existing.correctStreak + 1;
          mastered = correctStreak >= 2;
          await db.mistakes.update(existing.id, {
            correctStreak,
            status: mastered ? 'mastered' : 'open',
            lastCorrectAt: now,
            nextReviewAt: null,
          });

          if (mastered) {
            const review = await db.reviews
              .where('[itemType+itemId]')
              .equals(['mistake', question.id])
              .first();
            if (review?.id !== undefined) {
              await db.reviews.delete(review.id);
            }
          }
        }
        return;
      }

      if (existing?.id !== undefined) {
        await db.mistakes.update(existing.id, {
          wrongCount: existing.wrongCount + 1,
          correctStreak: 0,
          status: 'open',
          lastWrongAt: now,
          nextReviewAt: reviewDue,
          errorCauseTags: question.errorCauseTags,
          knowledgeTags: question.knowledgeTags,
          hotTopicTags: question.hotTopicTags,
        });
      } else {
        const mistake: MistakeRecord = {
          questionId: question.id,
          examId: question.examId,
          errorCauseTags: question.errorCauseTags,
          knowledgeTags: question.knowledgeTags,
          hotTopicTags: question.hotTopicTags,
          wrongCount: 1,
          correctStreak: 0,
          status: 'open',
          firstWrongAt: now,
          lastWrongAt: now,
          lastCorrectAt: null,
          nextReviewAt: reviewDue,
        };
        await db.mistakes.add(mistake);
      }

      await ensureReview('mistake', question.id, reviewDue);
    },
  );

  return { isCorrect, mastered };
}

export interface AddWordInput {
  lemma: string;
  meaningZh: string;
  example?: string | null;
  tags?: string[];
  sourceQuestionId?: string | null;
  sourceExamId?: string | null;
  sourcePassageId?: string | null;
  sourceSentence?: string | null;
  isHotTerm?: boolean;
}

export async function addWord(
  input: AddWordInput,
): Promise<{ word: WordRecord; created: boolean }> {
  const lemma = input.lemma.trim();
  const meaningZh = input.meaningZh.trim();

  if (!lemma) throw new Error('請輸入單詞或片語');
  if (!meaningZh) throw new Error('請輸入中文意思');

  const id = `w_${slugify(lemma)}`;
  const now = new Date().toISOString();
  let created = false;
  let result: WordRecord | undefined;

  await db.transaction('rw', db.words, db.reviews, async () => {
    const existing = await db.words.get(id);
    created = !existing;

    const tags = Array.from(
      new Set([...(existing?.tags ?? []), ...(input.tags ?? [])]),
    );

    const word: WordRecord = {
      id,
      lemma,
      meaningZh,
      meaningEn: existing?.meaningEn ?? null,
      example: input.example?.trim() || existing?.example || null,
      exampleZh: existing?.exampleZh ?? null,
      sourceQuestionId:
        input.sourceQuestionId ?? existing?.sourceQuestionId ?? null,
      sourceExamId: input.sourceExamId ?? existing?.sourceExamId ?? null,
      sourcePassageId:
        input.sourcePassageId ?? existing?.sourcePassageId ?? null,
      sourceSentence:
        input.sourceSentence ?? existing?.sourceSentence ?? null,
      wordBankId: existing?.wordBankId ?? null,
      origin: existing?.origin ?? 'user',
      pos: existing?.pos ?? [],
      phonetics: existing?.phonetics ?? null,
      collocations: existing?.collocations ?? [],
      wordFamily: existing?.wordFamily ?? [],
      tags,
      isHotTerm: Boolean(existing?.isHotTerm || input.isHotTerm),
      frequencyRank: existing?.frequencyRank ?? null,
      createdAt: existing?.createdAt ?? now,
    };

    result = word;
    await db.words.put(word);
    await ensureReview('word', id, todayKey());
  });

  if (!result) throw new Error('單詞儲存失敗');
  return { word: result, created };
}

export async function addWordFromBank(
  bankId: string,
): Promise<{ word: WordRecord; created: boolean }> {
  const entry = await db.wordBank.get(bankId);
  if (!entry) throw new Error('找不到詞庫條目');

  const today = todayKey();
  const profile = await db.profile.get('me');
  const pausedUntil = profile?.srs?.newWordsPausedUntil ?? null;
  if (pausedUntil && pausedUntil >= today) {
    throw new Error(`新詞暫停中，${pausedUntil} 後再試`);
  }

  const countdown = getCountdown();
  if (countdown.daysToExam <= SRS_RULES.stop_new_words_days_before_exam) {
    throw new Error(
      `距考試只剩 ${Math.max(0, countdown.daysToExam)} 天，已停止新增單詞`,
    );
  }

  if ((await countNewWordsToday()) >= SRS_RULES.daily_new_words) {
    throw new Error(`今日新詞已達 ${SRS_RULES.daily_new_words} 個上限`);
  }

  const id = `w_${slugify(entry.lemma)}`;
  const now = new Date().toISOString();
  let result: WordRecord | undefined;
  let created = false;

  await db.transaction('rw', db.words, db.reviews, async () => {
    const existing =
      (await db.words.get(id)) ??
      (await db.words.where('wordBankId').equals(bankId).first());

    if (existing) {
      result = existing;
      await ensureReview('word', existing.id, today);
      return;
    }

    const word: WordRecord = {
      id,
      lemma: entry.lemma,
      meaningZh: entry.meanings.zh.join('；'),
      meaningEn: entry.meanings.en.join('；'),
      example: entry.example.sentence,
      exampleZh: entry.example.translation,
      sourceQuestionId: null,
      sourceExamId: null,
      sourcePassageId: null,
      sourceSentence: null,
      wordBankId: entry.id,
      origin: 'bank',
      pos: entry.pos,
      phonetics: entry.phonetics ?? null,
      collocations: entry.collocations ?? [],
      wordFamily: entry.wordFamily ?? [],
      tags: entry.tags ?? [],
      isHotTerm: false,
      frequencyRank: entry.frequencyRank,
      createdAt: now,
    };

    await db.words.put(word);
    await ensureReview('word', word.id, today);
    result = word;
    created = true;
  });

  if (!result) throw new Error('單詞儲存失敗');
  return { word: result, created };
}

export async function countNewWordsToday(): Promise<number> {
  const today = todayKey();
  const words = await db.words.toArray();
  return words.filter((word) => todayKey(new Date(word.createdAt)) === today)
    .length;
}

export async function countReviewsToday(): Promise<number> {
  const today = todayKey();
  const logs = await db.reviewLogs.toArray();
  return logs.filter(
    (log) =>
      log.itemType === 'word' && todayKey(new Date(log.reviewedAt)) === today,
  ).length;
}

export async function deleteWord(wordId: string): Promise<void> {
  await db.transaction('rw', db.words, db.reviews, db.reviewLogs, async () => {
    await db.words.delete(wordId);
    await db.reviews
      .where('[itemType+itemId]')
      .equals(['word', wordId])
      .delete();
    await db.reviewLogs
      .where('[itemType+itemId]')
      .equals(['word', wordId])
      .delete();
  });
}

export async function advanceReviewGrade(
  itemType: ReviewItemType,
  itemId: string,
  grade: ReviewGrade,
): Promise<ReviewRecord> {
  const now = new Date().toISOString();
  const today = todayKey();
  const examClamp = examClampDate();
  let updated: ReviewRecord | undefined;

  await db.transaction(
    'rw',
    db.reviews,
    db.reviewLogs,
    db.dailyLogs,
    db.profile,
    async () => {
      let review = await db.reviews
        .where('[itemType+itemId]')
        .equals([itemType, itemId])
        .first();

      if (!review) {
        const id = await db.reviews.add({
          itemType,
          itemId,
          stage: 0,
          dueAt: today,
          suspended: false,
          backlog: false,
          updatedAt: now,
          lapses: 0,
          introducedAt: now,
          lastReviewedAt: null,
          lastGrade: null,
          adjustedAt: null,
          suspendedReason: null,
        });
        review = await db.reviews.get(id);
      }

      if (!review?.id) throw new Error('找不到複習項目');

      const next = gradeCard({
        stage: review.stage,
        lapses: review.lapses ?? 0,
        grade,
        today,
        examClamp,
      });

      const nextReview: ReviewRecord = {
        ...review,
        id: review.id,
        stage: next.stage,
        dueAt: next.dueAt,
        lapses: next.lapses,
        lastReviewedAt: today,
        lastGrade: grade,
        backlog: false,
        adjustedAt: null,
        updatedAt: now,
      };
      updated = nextReview;
      await db.reviews.put(nextReview);
      await db.reviewLogs.add({
        reviewId: review.id,
        itemType,
        itemId,
        reviewedAt: now,
        grade,
        prevStage: review.stage,
        newStage: next.stage,
        scheduledFor: next.dueAt,
        context: 'review',
      });

      const log = await db.dailyLogs.get(today);
      await db.dailyLogs.put({
        date: today,
        phase: getCountdown().phase.id,
        minutes: log?.minutes ?? 0,
        questionsDone: log?.questionsDone ?? 0,
        correctCount: log?.correctCount ?? 0,
        newWords: log?.newWords ?? 0,
        reviewsDone: (log?.reviewsDone ?? 0) + 1,
        backlogAssigned: log?.backlogAssigned,
        backlogOverflow: log?.backlogOverflow,
        note: log?.note,
      });

      const profile = await db.profile.get('me');
      if (profile) {
        await db.profile.put({
          ...profile,
          srs: {
            ...(profile.srs ?? EMPTY_SRS),
            lastActiveAt: today,
            lastPlanDate: today,
          },
        });
      }
    },
  );

  if (!updated) throw new Error('複習排程更新失敗');
  return updated;
}

/** Phase 1 compatibility wrapper. */
export async function advanceReview(
  itemType: ReviewItemType,
  itemId: string,
  correct: boolean,
  grade: ReviewGrade = correct ? 'good' : 'again',
): Promise<ReviewRecord> {
  return advanceReviewGrade(itemType, itemId, grade);
}

export async function setRegistered(registered: boolean): Promise<void> {
  await db.profile.update('me', { registered });
}

export interface StudyLogInput {
  minutes?: number;
  questionsDone?: number;
  correctCount?: number;
  newWords?: number;
}

export async function logStudy(input: StudyLogInput): Promise<void> {
  const date = todayKey();
  const phase = getCountdown().phase.id;
  const existing = await db.dailyLogs.get(date);

  await db.dailyLogs.put({
    date,
    phase,
    minutes: (existing?.minutes ?? 0) + Math.max(0, input.minutes ?? 0),
    questionsDone:
      (existing?.questionsDone ?? 0) + Math.max(0, input.questionsDone ?? 0),
    correctCount:
      (existing?.correctCount ?? 0) + Math.max(0, input.correctCount ?? 0),
    newWords: (existing?.newWords ?? 0) + Math.max(0, input.newWords ?? 0),
    reviewsDone: existing?.reviewsDone ?? 0,
    backlogAssigned: existing?.backlogAssigned,
    backlogOverflow: existing?.backlogOverflow,
    note: existing?.note,
  });
}
