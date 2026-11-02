import { useSyncExternalStore } from 'react';
import { todayKey } from '../services/time/countdown';

export interface LocalWord {
  id: string;
  word: string;
  definition: string | null;
  sentence: string;
  examId: string | null;
  passageId: string | null;
  examTitle: string | null;
  passageTitle: string | null;
  addedAt: string;
  dueAt: string;
  reviewedAt: string | null;
}

type WordMap = Record<string, LocalWord>;

const WORDS_KEY = 'cetlab:words:v1';

let revision = 0;
const listeners = new Set<() => void>();

function bump() {
  revision += 1;
  for (const listener of listeners) listener();
}

function readWords(): WordMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as WordMap;
  } catch {
    return {};
  }
}

function writeWords(words: WordMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WORDS_KEY, JSON.stringify(words));
    bump();
  } catch {
    // Ignore quota/privacy-mode failures.
  }
}

function subscribeLocalWords(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === 'undefined') {
    return () => listeners.delete(listener);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === WORDS_KEY) bump();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLocalWordsRevision(): number {
  return useSyncExternalStore(
    subscribeLocalWords,
    () => revision,
    () => 0,
  );
}

export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getLocalWords(): LocalWord[] {
  return Object.values(readWords()).sort((a, b) =>
    b.addedAt.localeCompare(a.addedAt),
  );
}

export function getDueLocalWords(): LocalWord[] {
  const today = todayKey();
  return getLocalWords().filter((word) => word.dueAt <= today);
}

export function getLocalWord(id: string): LocalWord | undefined {
  const words = readWords();
  return words[normalizeWord(id)] ?? words[id];
}

export function addLocalWord(input: {
  word: string;
  definition: string | null;
  sentence: string;
  examId?: string | null;
  passageId?: string | null;
  examTitle?: string | null;
  passageTitle?: string | null;
}): LocalWord {
  const display = input.word.trim();
  const id = normalizeWord(display) || display.toLowerCase();
  const words = readWords();
  const existing = words[id];
  const now = new Date().toISOString();

  const word: LocalWord = {
    id,
    word: display,
    definition: input.definition ?? existing?.definition ?? null,
    sentence: input.sentence || existing?.sentence || '',
    examId: input.examId ?? existing?.examId ?? null,
    passageId: input.passageId ?? existing?.passageId ?? null,
    examTitle: input.examTitle ?? existing?.examTitle ?? null,
    passageTitle: input.passageTitle ?? existing?.passageTitle ?? null,
    addedAt: existing?.addedAt ?? now,
    dueAt: todayKey(),
    reviewedAt: null,
  };

  words[id] = word;
  writeWords(words);
  return word;
}

export function markLocalWordReviewed(id: string): void {
  const words = readWords();
  const key = normalizeWord(id);
  const word = words[key] ?? words[id];
  if (!word) return;
  word.reviewedAt = new Date().toISOString();
  word.dueAt = todayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  writeWords(words);
}

export function clearLocalWords(): void {
  writeWords({});
}
