import { beforeEach, describe, expect, it } from 'vitest';
import type { LocalExamRecord } from './localProgress';
import {
  backfillDailyStats,
  getLast7Days,
  getOverallStats,
  recordDailyAnswer,
} from './localStats';
import { todayKey } from './time/countdown';

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function installStorage() {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: createStorage() },
    configurable: true,
  });
}

function record(overrides: Partial<LocalExamRecord> = {}): LocalExamRecord {
  return {
    examId: 'exam_1',
    module: 'reading',
    examTitle: 'Test exam',
    total: 2,
    answeredIds: ['q1', 'q2'],
    correctIds: ['q1'],
    updatedAt: new Date().toISOString(),
    completed: false,
    ...overrides,
  };
}

describe('localStats', () => {
  beforeEach(() => {
    installStorage();
  });

  it('records daily attempts and computes overall accuracy', () => {
    recordDailyAnswer(true);
    recordDailyAnswer(false);

    const days = getLast7Days();
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe(todayKey());
    expect(days[6]).toMatchObject({ answered: 2, correct: 1 });
    expect(getOverallStats()).toMatchObject({
      answered: 2,
      correct: 1,
      accuracy: 0.5,
    });
  });

  it('backfills once from existing exam records', () => {
    backfillDailyStats([record()]);

    let overall = getOverallStats();
    expect(overall).toMatchObject({ answered: 2, correct: 1 });

    backfillDailyStats([record()]);
    overall = getOverallStats();
    expect(overall).toMatchObject({ answered: 2, correct: 1 });

    recordDailyAnswer(true);
    expect(getOverallStats()).toMatchObject({ answered: 3, correct: 2 });
  });

  it('returns an empty week when there is no data', () => {
    const days = getLast7Days();
    expect(days.every((day) => day.answered === 0)).toBe(true);
    expect(getOverallStats()).toMatchObject({
      answered: 0,
      correct: 0,
      accuracy: 0,
    });
  });
});
