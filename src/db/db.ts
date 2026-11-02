import Dexie, { type Table } from 'dexie';
import type {
  AssetRecord,
  AttemptRecord,
  BlobRecord,
  ConfigRecord,
  ContentMetaRecord,
  DailyLogRecord,
  DictationRecord,
  ExamRecord,
  GradingRecord,
  MistakeRecord,
  PassageRecord,
  ProfileRecord,
  QuestionRecord,
  ReviewLogRecord,
  ReviewRecord,
  SessionRecord,
  SpeakingRecord,
  TemplateAllowlistRecord,
  WordBankRecord,
  WordRecord,
} from './types';

export class CetLabDB extends Dexie {
  profile!: Table<ProfileRecord, string>;
  exams!: Table<ExamRecord, string>;
  passages!: Table<PassageRecord, string>;
  questions!: Table<QuestionRecord, string>;
  sessions!: Table<SessionRecord, string>;
  dictationRecords!: Table<DictationRecord, number>;
  attempts!: Table<AttemptRecord, number>;
  mistakes!: Table<MistakeRecord, number>;
  words!: Table<WordRecord, string>;
  wordBank!: Table<WordBankRecord, string>;
  reviews!: Table<ReviewRecord, number>;
  reviewLogs!: Table<ReviewLogRecord, number>;
  gradingRecords!: Table<GradingRecord, number>;
  speakingRecords!: Table<SpeakingRecord, number>;
  assets!: Table<AssetRecord, string>;
  blobs!: Table<BlobRecord, string>;
  config!: Table<ConfigRecord, string>;
  dailyLogs!: Table<DailyLogRecord, string>;
  contentMeta!: Table<ContentMetaRecord, string>;
  templateAllowlist!: Table<TemplateAllowlistRecord, number>;

  constructor(name = 'cet-lab') {
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

    this.version(2)
      .stores({
        wordBank:
          'id, &lemma, frequencyRank, band, *pos, *tags, [band+frequencyRank]',
        words:
          'id, lemma, *tags, sourceQuestionId, frequencyRank, createdAt, wordBankId, origin, [origin+createdAt]',
        reviews:
          '++id, &[itemType+itemId], dueAt, [itemType+dueAt], stage, lapses',
      })
      .upgrade(async (tx) => {
        await tx
          .table('reviews')
          .toCollection()
          .modify((review: Record<string, unknown>) => {
            review.lapses ??= 0;
            review.introducedAt ??=
              (review.updatedAt as string | undefined) ??
              new Date().toISOString();
            review.lastReviewedAt ??= null;
            review.lastGrade ??= null;
            review.adjustedAt ??= null;
            review.suspendedReason ??= null;
          });

        await tx
          .table('words')
          .toCollection()
          .modify((word: Record<string, unknown>) => {
            word.wordBankId ??= null;
            word.origin ??= word.sourceQuestionId ? 'reading' : 'user';
            word.pos ??= [];
            word.phonetics ??= null;
            word.meaningEn ??= null;
            word.exampleZh ??= null;
            word.collocations ??= [];
            word.wordFamily ??= [];
          });

        await tx
          .table('profile')
          .toCollection()
          .modify((profile: Record<string, unknown>) => {
            profile.srs ??= {
              lastActiveAt: null,
              lastBackfillAt: null,
              newWordsPausedUntil: null,
              lastPlanDate: null,
            };
            profile.preferences ??= {};
          });

        await tx
          .table('dailyLogs')
          .toCollection()
          .modify((log: Record<string, unknown>) => {
            log.reviewsDone ??= 0;
          });
      });

    this.version(3).stores({
      dictationRecords:
        '++id, passageId, examId, createdAt, runId, [passageId+segmentIndex], [passageId+runId], [passageId+segmentIndex+createdAt]',
    });
  }
}

export const db = new CetLabDB();
