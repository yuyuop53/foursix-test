import { useSyncExternalStore } from 'react';
import type { QuestionRecord } from '../db/types';
import { backfillDailyStats, recordDailyAnswer } from './localStats';

export type StudyModule = 'reading' | 'listening' | 'translation';

export interface LocalMistake {
  questionId: string;
  examId: string;
  passageId: string;
  module: StudyModule;
  selected: string;
  wrongAt: string;
  wrongCount: number;
}

export interface LocalExamRecord {
  examId: string;
  module: StudyModule;
  examTitle: string;
  total: number;
  answeredIds: string[];
  correctIds: string[];
  updatedAt: string;
  completed: boolean;
}

type MistakeMap = Record<string, LocalMistake>;
type RecordMap = Record<string, LocalExamRecord>;

const MISTAKES_KEY = 'cetlab:mistakes:v1';
const RECORDS_KEY = 'cetlab:examRecords:v1';

let revision = 0;
const listeners = new Set<() => void>();

function bump() {
  revision += 1;
  for (const listener of listeners) listener();
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    bump();
  } catch {
    // Ignore quota/privacy-mode failures; the UI still works for this session.
  }
}

function subscribeLocalProgress(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === 'undefined') {
    return () => listeners.delete(listener);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === MISTAKES_KEY || event.key === RECORDS_KEY) {
      bump();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-renders the calling component whenever local progress changes. */
export function useLocalProgressRevision(): number {
  return useSyncExternalStore(
    subscribeLocalProgress,
    () => revision,
    () => 0,
  );
}

export function getMistakes(module?: StudyModule): LocalMistake[] {
  const map = readJson<MistakeMap>(MISTAKES_KEY, {});
  return Object.values(map)
    .filter((mistake) => !module || mistake.module === module)
    .sort((a, b) => b.wrongAt.localeCompare(a.wrongAt));
}

export function recordMistake(input: {
  question: QuestionRecord;
  module: StudyModule;
  selected: string;
}): void {
  const map = readJson<MistakeMap>(MISTAKES_KEY, {});
  const existing = map[input.question.id];
  map[input.question.id] = {
    questionId: input.question.id,
    examId: input.question.examId,
    passageId: input.question.passageId,
    module: input.module,
    selected: input.selected,
    wrongAt: new Date().toISOString(),
    wrongCount: (existing?.wrongCount ?? 0) + 1,
  };
  writeJson(MISTAKES_KEY, map);
}

export function clearMistakes(module?: StudyModule): void {
  if (!module) {
    writeJson(MISTAKES_KEY, {});
    return;
  }
  const map = readJson<MistakeMap>(MISTAKES_KEY, {});
  for (const [questionId, mistake] of Object.entries(map)) {
    if (mistake.module === module) delete map[questionId];
  }
  writeJson(MISTAKES_KEY, map);
}

export function getExamRecords(module?: StudyModule): LocalExamRecord[] {
  const map = readJson<RecordMap>(RECORDS_KEY, {});
  return Object.values(map)
    .filter((record) => !module || record.module === module)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getExamRecord(
  examId: string,
  module: StudyModule,
): LocalExamRecord | undefined {
  return getExamRecords(module).find((record) => record.examId === examId);
}

export function recordExamAnswer(input: {
  examId: string;
  examTitle: string;
  module: StudyModule;
  questionId: string;
  isCorrect: boolean;
  total: number;
}): LocalExamRecord {
  const map = readJson<RecordMap>(RECORDS_KEY, {});
  backfillDailyStats(Object.values(map));
  const existing = map[input.examId];
  const answered = new Set(existing?.answeredIds ?? []);
  const correct = new Set(existing?.correctIds ?? []);

  answered.add(input.questionId);
  if (input.isCorrect) correct.add(input.questionId);
  else correct.delete(input.questionId);

  const total = Math.max(input.total, answered.size, 1);
  const record: LocalExamRecord = {
    examId: input.examId,
    module: input.module,
    examTitle: input.examTitle,
    total,
    answeredIds: [...answered],
    correctIds: [...correct],
    updatedAt: new Date().toISOString(),
    completed: answered.size >= total,
  };

  map[input.examId] = record;
  writeJson(RECORDS_KEY, map);
  recordDailyAnswer(input.isCorrect);
  return record;
}
