import { describe, expect, it } from 'vitest';
import {
  diffDictation,
  normalizeDictation,
  scoreDictation,
} from './diff';

describe('normalizeDictation', () => {
  it('lowercases and removes punctuation', () => {
    expect(normalizeDictation('Hello, WORLD!')).toBe('hello world');
  });

  it('expands common contractions and curly apostrophes', () => {
    expect(normalizeDictation('I don’t think it’s ready.')).toBe(
      'i do not think it is ready',
    );
    expect(normalizeDictation("We can't go; they won't wait.")).toBe(
      'we can not go they will not wait',
    );
  });

  it('normalizes numbers with commas and hyphens', () => {
    expect(normalizeDictation('There are 1,200 well-known cases.')).toBe(
      'there are 1200 well known cases',
    );
  });

  it('removes possessive apostrophes after alignment', () => {
    expect(normalizeDictation("The student's book is here.")).toBe(
      'the students book is here',
    );
  });
});

describe('diffDictation', () => {
  it('returns equal operations for an exact match', () => {
    const diff = diffDictation('The quick brown fox', 'the quick brown fox');
    expect(diff).toEqual([
      { type: 'equal', reference: 'the', actual: 'the' },
      { type: 'equal', reference: 'quick', actual: 'quick' },
      { type: 'equal', reference: 'brown', actual: 'brown' },
      { type: 'equal', reference: 'fox', actual: 'fox' },
    ]);
  });

  it('marks omitted and extra words', () => {
    const diff = diffDictation('one two three', 'one three four');
    expect(diff).toContainEqual({ type: 'missing', reference: 'two' });
    expect(diff).toContainEqual({ type: 'extra', actual: 'four' });
  });

  it('coalesces an adjacent missing/extra pair into replace', () => {
    const diff = diffDictation('one two', 'one three');
    expect(diff).toContainEqual({
      type: 'replace',
      reference: 'two',
      actual: 'three',
    });
  });
});

describe('scoreDictation', () => {
  it('scores an exact match as 1', () => {
    const score = scoreDictation('Good morning, everyone.', 'good morning everyone');
    expect(score.accuracy).toBe(1);
    expect(score.isExact).toBe(true);
    expect(score.correctWords).toBe(3);
  });

  it('scores a partially correct answer', () => {
    const score = scoreDictation('one two three four', 'one three four');
    expect(score.correctWords).toBe(3);
    expect(score.referenceWords).toBe(4);
    expect(score.actualWords).toBe(3);
    expect(score.accuracy).toBe(0.75);
    expect(score.isExact).toBe(false);
  });

  it('scores an empty input as 0', () => {
    const score = scoreDictation('one two', '');
    expect(score.accuracy).toBe(0);
    expect(score.actualWords).toBe(0);
    expect(score.diff.every((op) => op.type === 'missing')).toBe(true);
  });

  it('does not reward word spam', () => {
    const score = scoreDictation(
      'one two three',
      'one two three four five six seven eight nine ten',
    );
    expect(score.accuracy).toBe(0.3);
    expect(score.correctWords).toBe(3);
  });

  it('handles reordered words without claiming an exact match', () => {
    const score = scoreDictation('one two three', 'three two one');
    expect(score.isExact).toBe(false);
    expect(score.accuracy).toBeLessThan(1);
    expect(score.accuracy).toBeGreaterThan(0);
  });
});
