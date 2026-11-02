import { loadBundledContent, type ContentLoadError } from '../content/loader';
import {
  loadWordBank,
  type WordBankLoadError,
} from '../content/wordBankLoader';
import type { WordBankEntry } from '../content/wordBankSchema';
import type { Asset, Exam, ExamBundle, Passage, Question } from '../content/schema';
import { db } from './db';
import type {
  AssetRecord,
  ExamRecord,
  PassageRecord,
  QuestionRecord,
} from './types';

// Exam ids that were once shipped as bundled content but have since been
// removed. Keep this list so existing local databases drop the stale copy.
const RETIRED_BUNDLED_EXAM_IDS = ['exam_cet_reading_2026_11_custom'];

export interface SeedResult {
  bundles: number;
  errors: ContentLoadError[];
  wordBankEntries: number;
  wordBankErrors: WordBankLoadError[];
}

export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function mapExam(exam: Exam): ExamRecord {
  return {
    id: exam.id,
    title: exam.title,
    year: exam.year,
    month: exam.month,
    set: exam.set,
    source: exam.source,
    license: exam.license,
    contentVersion: exam.content_version,
    sections: exam.sections,
  };
}

export function mapPassage(passage: Passage): PassageRecord {
  return {
    id: passage.id,
    examId: passage.exam_id,
    section: passage.section,
    subtype: passage.subtype ?? 'careful_reading',
    order: passage.order,
    title: passage.title,
    bodyMd: passage.body_md,
    wordCount: passage.word_count,
    hotTopicTags: passage.hot_topic_tags,
    wordBank: passage.word_bank ?? null,
    audioAssetId: passage.audio_asset_id ?? null,
    accent: passage.accent ?? null,
    wpm: passage.wpm ?? null,
    transcript: passage.transcript ?? null,
    transcriptZh: passage.transcript_zh ?? null,
  };
}

export function mapQuestion(question: Question): QuestionRecord {
  return {
    id: question.id,
    examId: question.exam_id,
    passageId: question.passage_id,
    section: question.section,
    type: question.type,
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    explanation: question.explanation,
    evidence: question.evidence,
    knowledgeTags: question.knowledge_tags,
    errorCauseTags: question.error_cause_tags,
    hotTopicTags: question.hot_topic_tags,
    difficulty: question.difficulty,
    blankIndex: question.blank_index ?? null,
    audioSpan: question.audio_span ?? null,
    generated: question.generated ?? false,
  };
}

export function mapAsset(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    kind: asset.kind,
    backend: asset.backend,
    src: asset.src ?? '',
    accent: asset.accent ?? null,
    wpm: asset.wpm ?? null,
    synthetic: asset.synthetic ?? false,
    license: asset.license,
    durationSec: asset.duration_sec,
    segments: asset.segments,
  };
}

export async function ingestBundles(bundles: ExamBundle[]): Promise<void> {
  if (bundles.length === 0) return;

  await db.transaction(
    'rw',
    db.exams,
    db.passages,
    db.questions,
    db.assets,
    async () => {
      for (const bundle of bundles) {
        await db.exams.put(mapExam(bundle.exam));
        if (bundle.passages.length > 0) {
          await db.passages.bulkPut(bundle.passages.map(mapPassage));
        }
        if (bundle.questions.length > 0) {
          await db.questions.bulkPut(bundle.questions.map(mapQuestion));
        }
        if (bundle.assets.length > 0) {
          await db.assets.bulkPut(bundle.assets.map(mapAsset));
        }
      }
    },
  );
}

export async function ingestWordBank(entries: WordBankEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.transaction('rw', db.wordBank, async () => {
    await db.wordBank.bulkPut(entries);
  });
}

export async function ensureSeeded(): Promise<SeedResult> {
  await db.open();

  const profile = await db.profile.get('me');
  if (!profile) {
    await db.profile.put({
      id: 'me',
      targetScore: 425,
      dailyMinutes: 60,
      registered: false,
      createdAt: new Date().toISOString(),
      srs: {
        lastActiveAt: null,
        lastBackfillAt: null,
        newWordsPausedUntil: null,
        lastPlanDate: null,
      },
      preferences: {},
    });
  }

  const { bundles, errors } = loadBundledContent();
  const hash = hashString(JSON.stringify(bundles));
  const meta = await db.contentMeta.get('bundle');

  if (!meta || meta.value !== hash) {
    await ingestBundles(bundles);
    await db.contentMeta.put({
      key: 'bundle',
      value: hash,
      updatedAt: new Date().toISOString(),
    });
  }

  // Drop bundled exams that no longer exist in content/. User-imported exams
  // were never recorded here, so they are left untouched.
  const currentExamIds = bundles.map((bundle) => bundle.exam.id);
  const previousIdsMeta = await db.contentMeta.get('bundle_exam_ids');
  let previousExamIds: string[] = [];
  if (previousIdsMeta) {
    try {
      const parsed = JSON.parse(previousIdsMeta.value) as unknown;
      if (Array.isArray(parsed)) {
        previousExamIds = parsed.filter(
          (id): id is string => typeof id === 'string',
        );
      }
    } catch {
      previousExamIds = [];
    }
  }

  const removedExamIds = [
    ...new Set([
      ...RETIRED_BUNDLED_EXAM_IDS,
      ...previousExamIds.filter((id) => !currentExamIds.includes(id)),
    ]),
  ];

  if (removedExamIds.length > 0) {
    await db.transaction(
      'rw',
      db.exams,
      db.passages,
      db.questions,
      async () => {
        await db.questions.where('examId').anyOf(removedExamIds).delete();
        await db.passages.where('examId').anyOf(removedExamIds).delete();
        await db.exams.bulkDelete(removedExamIds);
      },
    );
  }

  await db.contentMeta.put({
    key: 'bundle_exam_ids',
    value: JSON.stringify(currentExamIds),
    updatedAt: new Date().toISOString(),
  });

  const { entries: wordBankEntries, errors: wordBankErrors } = loadWordBank();
  const wordBankHash = hashString(JSON.stringify(wordBankEntries));
  const wordBankMeta = await db.contentMeta.get('wordbank');

  if (!wordBankMeta || wordBankMeta.value !== wordBankHash) {
    await ingestWordBank(wordBankEntries);
    await db.contentMeta.put({
      key: 'wordbank',
      value: wordBankHash,
      updatedAt: new Date().toISOString(),
    });
  }

  await db.config.put({ key: 'content_load_errors', value: errors });
  await db.config.put({
    key: 'wordbank_load_errors',
    value: wordBankErrors,
  });

  return {
    bundles: bundles.length,
    errors,
    wordBankEntries: wordBankEntries.length,
    wordBankErrors,
  };
}
