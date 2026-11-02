import { useSyncExternalStore } from 'react';
import { todayKey } from '../services/time/countdown';
import type { LocalExamRecord } from './localProgress';

export interface DailyStat {
  answered: number;
  correct: number;
}

type DailyMap = Record<string, DailyStat>;

export interface DayStat extends DailyStat {
  date: string;
  accuracy: number;
}

const STATS_KEY = 'cetlab:dailyStats:v1';

let revision = 0;
const listeners = new Set<() => void>();

function bump() {
  revision += 1;
  for (const listener of listeners) listener();
}

function readStats(): DailyMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as DailyMap;
  } catch {
    return {};
  }
}

function writeStats(stats: DailyMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    bump();
  } catch {
    // Ignore quota/privacy-mode failures.
  }
}

function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === 'undefined') {
    return () => listeners.delete(listener);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STATS_KEY) bump();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLocalStatsRevision(): number {
  return useSyncExternalStore(subscribeStats, () => revision, () => 0);
}

/**
 * One-time migration: attribute the aggregate counts already stored in
 * exam records to the day they were last updated. This gives the chart a
 * starting point without double-counting future answers.
 */
export function backfillDailyStats(records: LocalExamRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(STATS_KEY)) return;
  } catch {
    return;
  }

  const stats: DailyMap = {};
  for (const record of records) {
    if (record.answeredIds.length === 0) continue;
    const date = todayKey(new Date(record.updatedAt));
    const entry = stats[date] ?? { answered: 0, correct: 0 };
    entry.answered += record.answeredIds.length;
    entry.correct += record.correctIds.length;
    stats[date] = entry;
  }

  if (Object.keys(stats).length > 0) writeStats(stats);
}

export function recordDailyAnswer(isCorrect: boolean): void {
  if (typeof window === 'undefined') return;
  const today = todayKey();
  const stats = readStats();
  const entry = stats[today] ?? { answered: 0, correct: 0 };
  entry.answered += 1;
  if (isCorrect) entry.correct += 1;
  stats[today] = entry;
  writeStats(stats);
}

export function getLast7Days(): DayStat[] {
  const stats = readStats();
  const days: DayStat[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = todayKey(date);
    const entry = stats[key] ?? { answered: 0, correct: 0 };
    days.push({
      date: key,
      answered: entry.answered,
      correct: entry.correct,
      accuracy: entry.answered > 0 ? entry.correct / entry.answered : 0,
    });
  }
  return days;
}

export function getOverallStats(): DailyStat & { accuracy: number } {
  const stats = readStats();
  let answered = 0;
  let correct = 0;
  for (const entry of Object.values(stats)) {
    answered += entry.answered;
    correct += entry.correct;
  }
  return {
    answered,
    correct,
    accuracy: answered > 0 ? correct / answered : 0,
  };
}
