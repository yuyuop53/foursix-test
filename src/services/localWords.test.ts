import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLocalWord,
  clearLocalWords,
  getDueLocalWords,
  getLocalWord,
  getLocalWords,
  markLocalWordReviewed,
} from './localWords';

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

describe('localWords', () => {
  beforeEach(() => {
    installStorage();
  });

  it('adds a word with its definition, sentence and source', () => {
    addLocalWord({
      word: 'effort',
      definition: 'n. 努力；尝试',
      sentence: 'We all take a little extra effort to look nice.',
      examId: 'exam_1',
      passageId: 'psg_1',
      examTitle: 'Test exam',
      passageTitle: 'Test passage',
    });

    const words = getLocalWords();
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({
      id: 'effort',
      word: 'effort',
      definition: 'n. 努力；尝试',
      examTitle: 'Test exam',
      passageTitle: 'Test passage',
    });
    expect(getDueLocalWords()).toHaveLength(1);
    expect(getLocalWord('effort')?.sentence).toContain('extra effort');
  });

  it('updates an existing word instead of creating a duplicate', () => {
    addLocalWord({
      word: 'Effort',
      definition: null,
      sentence: 'First sentence.',
    });
    addLocalWord({
      word: 'effort',
      definition: 'n. 努力',
      sentence: 'Second sentence.',
    });

    expect(getLocalWords()).toHaveLength(1);
    expect(getLocalWord('effort')).toMatchObject({
      word: 'effort',
      definition: 'n. 努力',
      sentence: 'Second sentence.',
    });
  });

  it('marks a word reviewed and removes it from due words', () => {
    addLocalWord({ word: 'ability', definition: null, sentence: 'Ability.' });
    expect(getDueLocalWords()).toHaveLength(1);

    markLocalWordReviewed('ability');

    expect(getDueLocalWords()).toEqual([]);
    expect(getLocalWord('ability')?.reviewedAt).toBeTruthy();
  });

  it('clears the local word book', () => {
    addLocalWord({ word: 'absorb', definition: null, sentence: 'Absorb.' });
    clearLocalWords();
    expect(getLocalWords()).toEqual([]);
  });
});
