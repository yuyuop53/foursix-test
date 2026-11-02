import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CetLabDB } from './db';

const DB_NAME = 'cet-lab-migration-test';

class V1DB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      profile: 'id',
      exams: 'id, year, month, contentVersion',
      passages: 'id, examId, section, order, *hotTopicTags',
      questions:
        'id, examId, passageId, section, type, *knowledgeTags, *errorCauseTags, *hotTopicTags',
      sessions: 'id, examId, mode, startedAt',
      attempts:
        '++id, sessionId, examId, questionId, mode, createdAt, [questionId+createdAt]',
      mistakes:
        '++id, questionId, status, nextReviewAt, *errorCauseTags, *knowledgeTags, [status+nextReviewAt]',
      words: 'id, lemma, *tags, sourceQuestionId, frequencyRank, createdAt',
      reviews: '++id, &[itemType+itemId], dueAt, [itemType+dueAt], stage',
      reviewLogs: '++id, reviewId, reviewedAt, [itemType+itemId]',
      gradingRecords:
        '++id, taskType, attemptGroupId, createdAt, band, templateRatio',
      speakingRecords: '++id, promptId, createdAt',
      assets: 'id, kind, backend, checksum',
      blobs: 'assetId',
      config: 'key',
      dailyLogs: 'date, phase',
      contentMeta: 'key',
      templateAllowlist: '++id, &normPhrase',
    });
  }
}

class V2DB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      profile: 'id',
      exams: 'id, year, month, contentVersion',
      passages: 'id, examId, section, order, *hotTopicTags',
      questions:
        'id, examId, passageId, section, type, *knowledgeTags, *errorCauseTags, *hotTopicTags',
      sessions: 'id, examId, mode, startedAt',
      attempts:
        '++id, sessionId, examId, questionId, mode, createdAt, [questionId+createdAt]',
      mistakes:
        '++id, questionId, status, nextReviewAt, *errorCauseTags, *knowledgeTags, [status+nextReviewAt]',
      words: 'id, lemma, *tags, sourceQuestionId, frequencyRank, createdAt',
      reviews: '++id, &[itemType+itemId], dueAt, [itemType+dueAt], stage',
      reviewLogs: '++id, reviewId, reviewedAt, [itemType+itemId]',
      gradingRecords:
        '++id, taskType, attemptGroupId, createdAt, band, templateRatio',
      speakingRecords: '++id, promptId, createdAt',
      assets: 'id, kind, backend, checksum',
      blobs: 'assetId',
      config: 'key',
      dailyLogs: 'date, phase',
      contentMeta: 'key',
      templateAllowlist: '++id, &normPhrase',
    });
    this.version(2).stores({
      wordBank:
        'id, &lemma, frequencyRank, band, *pos, *tags, [band+frequencyRank]',
      words:
        'id, lemma, *tags, sourceQuestionId, frequencyRank, createdAt, wordBankId, origin, [origin+createdAt]',
      reviews:
        '++id, &[itemType+itemId], dueAt, [itemType+dueAt], stage, lapses',
    });
  }
}

async function seedV2() {
  const db = new V2DB(DB_NAME);
  await db.open();

  await db.table('profile').put({
    id: 'me',
    targetScore: 425,
    dailyMinutes: 60,
    registered: false,
    createdAt: '2026-11-02T00:00:00.000Z',
    srs: {
      lastActiveAt: '2026-11-02',
      lastBackfillAt: null,
      newWordsPausedUntil: null,
      lastPlanDate: '2026-11-02',
    },
    preferences: {},
  });
  await db.table('wordBank').put({
    id: 'wb_test',
    lemma: 'test',
    pos: ['n.'],
    meanings: { zh: ['測試'], en: ['test'] },
    example: { sentence: 'This is a test.', translation: '這是測試。' },
    frequencyRank: 1,
    band: 'core_500',
  });
  await db.table('words').put({
    id: 'w_bank',
    lemma: 'test',
    meaningZh: '測試',
    wordBankId: 'wb_test',
    origin: 'bank',
    pos: ['n.'],
    phonetics: null,
    meaningEn: 'test',
    exampleZh: '這是測試。',
    collocations: [],
    wordFamily: [],
    tags: ['core'],
    isHotTerm: false,
    frequencyRank: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
  });
  await db.table('reviews').put({
    itemType: 'word',
    itemId: 'w_bank',
    stage: 2,
    dueAt: '2026-11-05',
    suspended: false,
    backlog: false,
    updatedAt: '2026-11-02T00:00:00.000Z',
    lapses: 1,
    introducedAt: '2026-11-02T00:00:00.000Z',
    lastReviewedAt: '2026-11-02',
    lastGrade: 'good',
    adjustedAt: null,
    suspendedReason: null,
  });
  await db.table('dailyLogs').put({
    date: '2026-11-02',
    phase: 'foundation',
    minutes: 20,
    questionsDone: 3,
    correctCount: 2,
    newWords: 1,
    reviewsDone: 2,
  });
  await db.table('mistakes').put({
    questionId: 'q_v2',
    examId: 'exam_v2',
    errorCauseTags: ['lexical'],
    knowledgeTags: ['detail'],
    hotTopicTags: [],
    wrongCount: 1,
    correctStreak: 0,
    status: 'open',
    firstWrongAt: '2026-11-02T00:00:00.000Z',
    lastWrongAt: '2026-11-02T00:00:00.000Z',
    nextReviewAt: null,
  });

  db.close();
}

async function seedV1() {
  const v1 = new V1DB(DB_NAME);
  await v1.open();

  await v1.table('profile').put({
    id: 'me',
    targetScore: 425,
    dailyMinutes: 60,
    registered: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  await v1.table('words').put({
    id: 'w_old',
    lemma: 'old',
    meaningZh: '舊的',
    tags: ['core'],
    isHotTerm: false,
    frequencyRank: 10,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  await v1.table('reviews').put({
    itemType: 'word',
    itemId: 'w_old',
    stage: 1,
    dueAt: '2027-01-01',
    suspended: false,
    backlog: false,
    updatedAt: '2026-11-01T00:00:00.000Z',
  });
  await v1.table('mistakes').put({
    questionId: 'q_old',
    examId: 'exam_old',
    errorCauseTags: ['lexical'],
    knowledgeTags: ['detail'],
    hotTopicTags: [],
    wrongCount: 1,
    correctStreak: 0,
    status: 'open',
    firstWrongAt: '2026-11-01T00:00:00.000Z',
    lastWrongAt: '2026-11-01T00:00:00.000Z',
    nextReviewAt: null,
  });
  await v1.table('dailyLogs').put({
    date: '2026-11-01',
    phase: 'foundation',
    minutes: 10,
    questionsDone: 2,
    correctCount: 1,
    newWords: 1,
  });

  v1.close();
}

beforeEach(async () => {
  await Dexie.delete(DB_NAME);
});

afterAll(async () => {
  await Dexie.delete(DB_NAME);
});

describe('Dexie v1 -> v3 migration', () => {
  it('preserves existing data and fills new fields with defaults', async () => {
    await seedV1();

    const v2 = new CetLabDB(DB_NAME);
    await v2.open();

    const word = await v2.words.get('w_old');
    expect(word).toMatchObject({
      id: 'w_old',
      meaningZh: '舊的',
      wordBankId: null,
      origin: 'user',
      pos: [],
      collocations: [],
      wordFamily: [],
    });

    const reviews = await v2.reviews.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      itemId: 'w_old',
      stage: 1,
      lapses: 0,
      lastReviewedAt: null,
      suspendedReason: null,
    });

    const profile = await v2.profile.get('me');
    expect(profile?.srs).toEqual({
      lastActiveAt: null,
      lastBackfillAt: null,
      newWordsPausedUntil: null,
      lastPlanDate: null,
    });

    const log = await v2.dailyLogs.get('2026-11-01');
    expect(log?.reviewsDone).toBe(0);
    expect(log?.minutes).toBe(10);

    const mistakes = await v2.mistakes.toArray();
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].questionId).toBe('q_old');

    expect(await v2.wordBank.count()).toBe(0);
    v2.close();
  });
});

describe('Dexie v2 -> v3 migration', () => {
  it('preserves v2 data and adds queryable dictationRecords', async () => {
    await seedV2();

    const db = new CetLabDB(DB_NAME);
    await db.open();

    const word = await db.words.get('w_bank');
    expect(word).toMatchObject({
      wordBankId: 'wb_test',
      origin: 'bank',
      frequencyRank: 1,
    });
    expect(await db.wordBank.count()).toBe(1);

    const reviews = await db.reviews.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      itemId: 'w_bank',
      stage: 2,
      lapses: 1,
      lastGrade: 'good',
    });

    const profile = await db.profile.get('me');
    expect(profile?.srs.lastActiveAt).toBe('2026-11-02');

    const log = await db.dailyLogs.get('2026-11-02');
    expect(log?.reviewsDone).toBe(2);
    expect(await db.mistakes.count()).toBe(1);
    expect(await db.dictationRecords.count()).toBe(0);

    const id = await db.dictationRecords.add({
      passageId: 'psg_v3',
      examId: 'exam_v3',
      assetId: 'aud_v3',
      segmentIndex: 0,
      runId: 'run_1',
      inputText: 'hello',
      referenceText: 'hello',
      normalizedInput: 'hello',
      normalizedReference: 'hello',
      correctWords: 1,
      referenceWords: 1,
      actualWords: 1,
      accuracy: 1,
      playbackCount: 1,
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    expect(id).toBeGreaterThan(0);

    expect(
      await db.dictationRecords
        .where('[passageId+segmentIndex]')
        .equals(['psg_v3', 0])
        .count(),
    ).toBe(1);
    expect(
      await db.dictationRecords
        .where('[passageId+runId]')
        .equals(['psg_v3', 'run_1'])
        .count(),
    ).toBe(1);

    db.close();
  });
});
