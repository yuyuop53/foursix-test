import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import type { QuestionRecord } from './types';
import {
  addWord,
  advanceReview,
  deleteWord,
  recordAnswer,
  startSession,
} from './repo';
import { todayKey } from '../services/time/countdown';

const question: QuestionRecord = {
  id: 'q_test_01',
  examId: 'exam_test',
  passageId: 'psg_test_r1',
  section: 'reading',
  type: 'detail',
  stem: 'Test question?',
  options: [
    { key: 'A', text: 'Correct' },
    { key: 'B', text: 'Wrong' },
  ],
  answer: 'A',
  explanation: 'Because A is correct.',
  evidence: [{ paragraph: 1, sentence: 1, quote: 'Test quote.' }],
  knowledgeTags: ['detail'],
  errorCauseTags: ['locating'],
  hotTopicTags: [],
  difficulty: 2,
  generated: false,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterAll(async () => {
  await db.delete();
});

describe('recordAnswer', () => {
  it('creates a mistake and review row on a wrong answer, then masters it after two correct answers', async () => {
    const sessionId = await startSession('exam_test', 'practice');

    const wrong = await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'B',
      mode: 'practice',
    });
    expect(wrong.isCorrect).toBe(false);

    let mistakes = await db.mistakes.toArray();
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].wrongCount).toBe(1);
    expect(mistakes[0].status).toBe('open');
    let reviews = await db.reviews.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].itemType).toBe('mistake');
    expect(reviews[0].dueAt).toBe(todayKey());

    const firstCorrect = await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'A',
      mode: 'review',
    });
    expect(firstCorrect.isCorrect).toBe(true);
    expect(firstCorrect.mastered).toBe(false);

    mistakes = await db.mistakes.toArray();
    expect(mistakes[0].correctStreak).toBe(1);
    expect(mistakes[0].status).toBe('open');

    const secondCorrect = await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'A',
      mode: 'review',
    });
    expect(secondCorrect.mastered).toBe(true);

    mistakes = await db.mistakes.toArray();
    expect(mistakes[0].status).toBe('mastered');
    reviews = await db.reviews.toArray();
    expect(reviews).toHaveLength(0);
    expect(await db.attempts.count()).toBe(3);
  });

  it('reopens a mastered mistake after a new wrong answer', async () => {
    const sessionId = await startSession('exam_test', 'practice');
    await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'B',
      mode: 'practice',
    });
    await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'A',
      mode: 'review',
    });
    await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'A',
      mode: 'review',
    });

    await recordAnswer({
      sessionId,
      examId: 'exam_test',
      question,
      selected: 'B',
      mode: 'review',
    });

    const mistakes = await db.mistakes.toArray();
    expect(mistakes[0].status).toBe('open');
    expect(mistakes[0].wrongCount).toBe(2);
    expect(mistakes[0].correctStreak).toBe(0);
    expect(await db.reviews.count()).toBe(1);
  });
});

describe('words and review scheduling', () => {
  it('deduplicates a word and advances its review schedule', async () => {
    const first = await addWord({
      lemma: 'narrow the gap',
      meaningZh: '縮小差距',
      isHotTerm: true,
    });
    expect(first.created).toBe(true);
    expect(first.word.isHotTerm).toBe(true);

    const second = await addWord({
      lemma: 'Narrow the gap',
      meaningZh: '拉近差距',
    });
    expect(second.created).toBe(false);
    expect(second.word.meaningZh).toBe('拉近差距');
    expect(await db.words.count()).toBe(1);

    const review = await advanceReview('word', second.word.id, true);
    expect(review.stage).toBe(1);
    expect(review.dueAt > todayKey()).toBe(true);

    await deleteWord(second.word.id);
    expect(await db.words.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
  });
});
