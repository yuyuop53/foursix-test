import { describe, expect, it } from 'vitest';
import { loadWordBank, getWordBankFileCount } from './wordBankLoader';
import { WordBankEntrySchema, normalizeLemma } from './wordBankSchema';

describe('word bank data', () => {
  it('loads 500 valid, uniquely ranked entries from 5 files', () => {
    const { entries, errors } = loadWordBank();

    expect(errors).toEqual([]);
    expect(getWordBankFileCount()).toBe(5);
    expect(entries).toHaveLength(500);
    expect(entries[0].frequencyRank).toBe(1);
    expect(entries[entries.length - 1].frequencyRank).toBe(500);

    const lemmas = new Set(entries.map((entry) => normalizeLemma(entry.lemma)));
    const ranks = new Set(entries.map((entry) => entry.frequencyRank));
    expect(lemmas.size).toBe(500);
    expect(ranks.size).toBe(500);

    for (const entry of entries) {
      expect(entry.id).toMatch(/^wb_[a-z0-9_]+$/);
      expect(entry.meanings.zh.length).toBeGreaterThan(0);
      expect(entry.meanings.en.length).toBeGreaterThan(0);
      expect(entry.example.sentence.length).toBeGreaterThan(0);
      expect(entry.example.translation.length).toBeGreaterThan(0);
    }
  });

  it('rejects an entry missing required meanings', () => {
    const result = WordBankEntrySchema.safeParse({
      id: 'wb_bad',
      lemma: 'bad',
      pos: ['n.'],
      meanings: { zh: [], en: [] },
      example: { sentence: '', translation: '' },
      frequencyRank: 1,
      band: 'core_500',
    });

    expect(result.success).toBe(false);
  });

  it('normalizes lemma case and extra spaces', () => {
    expect(normalizeLemma('  Narrow   The Gap ')).toBe('narrow the gap');
  });
});
