import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addWordFromBank } from './repo';
import type { WordBankEntry } from '../content/wordBankSchema';

function entry(index: number): WordBankEntry {
  return {
    id: `wb_test_${index}`,
    lemma: `testword${index}`,
    pos: ['n.'],
    meanings: {
      zh: [`測試${index}`],
      en: [`test word ${index}`],
    },
    example: {
      sentence: `This is test word ${index}.`,
      translation: `這是測試單詞 ${index}。`,
    },
    collocations: [`test word ${index}`],
    tags: ['core'],
    frequencyRank: index,
    band: 'core_500',
    source: { name: 'test', license: 'CC0-1.0' },
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
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
});

afterAll(async () => {
  await db.delete();
});

describe('addWordFromBank', () => {
  it('copies the bank snapshot and creates a review', async () => {
    await db.wordBank.bulkPut([entry(1)]);

    const result = await addWordFromBank('wb_test_1');
    expect(result.created).toBe(true);
    expect(result.word).toMatchObject({
      wordBankId: 'wb_test_1',
      origin: 'bank',
      lemma: 'testword1',
      meaningZh: '測試1',
      frequencyRank: 1,
      isHotTerm: false,
    });
    expect(await db.words.count()).toBe(1);
    expect(await db.reviews.count()).toBe(1);

    const again = await addWordFromBank('wb_test_1');
    expect(again.created).toBe(false);
    expect(await db.words.count()).toBe(1);
  });

  it('enforces the daily new-word cap of 20', async () => {
    await db.wordBank.bulkPut(
      Array.from({ length: 21 }, (_, index) => entry(index + 1)),
    );

    for (let index = 1; index <= 20; index += 1) {
      const result = await addWordFromBank(`wb_test_${index}`);
      expect(result.created).toBe(true);
    }

    expect(await db.words.count()).toBe(20);
    await expect(addWordFromBank('wb_test_21')).rejects.toThrow(/上限/);
    expect(await db.words.count()).toBe(20);
  });
});
