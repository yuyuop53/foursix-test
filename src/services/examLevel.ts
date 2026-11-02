import { useEffect, useState } from 'react';

export type ExamLevel = 'CET4' | 'CET6';

const STORAGE_KEY = 'cetlab:exam-level:v1';
const CHANGE_EVENT = 'cetlab:exam-level-change';

export function getExamLevel(): ExamLevel {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'CET6'
      ? 'CET6'
      : 'CET4';
  } catch {
    return 'CET4';
  }
}

export function setExamLevel(level: ExamLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // localStorage may be unavailable in private mode; state still works.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useExamLevel(): [ExamLevel, (level: ExamLevel) => void] {
  const [level, setLevel] = useState<ExamLevel>(getExamLevel);

  useEffect(() => {
    const sync = () => setLevel(getExamLevel());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [level, setExamLevel];
}

export function examLevelOf(exam: { id: string; title?: string | null }): ExamLevel {
  const text = `${exam.id} ${exam.title ?? ''}`.toLowerCase();
  return text.includes('cet6') || text.includes('六级') ? 'CET6' : 'CET4';
}

export const EXAM_LEVEL_LABELS: Record<ExamLevel, string> = {
  CET4: 'CET-4 四級',
  CET6: 'CET-6 六級',
};
