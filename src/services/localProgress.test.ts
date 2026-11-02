import { beforeEach, describe, expect, it } from 'vitest';
import type { QuestionRecord } from '../db/types';
import {
  clearMistakes,
  getExamRecord,
  getMistakes,
  recordExamAnswer,
  recordMistake,
} from './localProgress';

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
  const localStorage = createStorage();
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });
  return localStorage;
}

const question = {
  id: 'q_exam_1_r1_01',
  examId: 'exam_1',
  passageId: 'psg_exam_1_r1',
  answer: 'A',
} as unknown as QuestionRecord;

describe('localProgress', () => {
  beforeEach(() => {
    installStorage();
  });

  it('records a mistake and increments the wrong count', () => {
    recordMistake({ question, module: 'reading', selected: 'B' });
    recordMistake({ question, module: 'reading', selected: 'C' });

    const mistakes = getMistakes('reading');
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]).toMatchObject({
      questionId: question.id,
      selected: 'C',
      wrongCount: 2,
      module: 'reading',
    });
    expect(getMistakes('listening')).toEqual([]);
  });

  it('tracks per-exam completion and accuracy', () => {
    recordExamAnswer({
      examId: 'exam_1',
      examTitle: 'Test exam',
      module: 'reading',
      questionId: 'q1',
      isCorrect: true,
      total: 2,
    });
    let record = getExamRecord('exam_1', 'reading');
    expect(record).toMatchObject({
      answeredIds: ['q1'],
      correctIds: ['q1'],
      completed: false,
      total: 2,
    });

    recordExamAnswer({
      examId: 'exam_1',
      examTitle: 'Test exam',
      module: 'reading',
      questionId: 'q2',
      isCorrect: false,
      total: 2,
    });
    record = getExamRecord('exam_1', 'reading');
    expect(record).toMatchObject({
      answeredIds: ['q1', 'q2'],
      correctIds: ['q1'],
      completed: true,
      total: 2,
    });

    recordExamAnswer({
      examId: 'exam_1',
      examTitle: 'Test exam',
      module: 'reading',
      questionId: 'q2',
      isCorrect: true,
      total: 2,
    });
    record = getExamRecord('exam_1', 'reading');
    expect(record?.correctIds.sort()).toEqual(['q1', 'q2']);
  });

  it('clears mistakes for one module only', () => {
    recordMistake({ question, module: 'reading', selected: 'B' });
    recordMistake({
      question: { ...question, id: 'q_listening' } as QuestionRecord,
      module: 'listening',
      selected: 'D',
    });

    clearMistakes('reading');

    expect(getMistakes('reading')).toEqual([]);
    expect(getMistakes('listening')).toHaveLength(1);
  });
});
