import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  latestDictationAttempts,
  listDictationAttempts,
  saveDictationAttempt,
  type SaveDictationInput,
} from './dictationRepo';

function attempt(
  overrides: Partial<SaveDictationInput> = {},
): SaveDictationInput {
  return {
    passageId: 'psg_1',
    examId: 'exam_1',
    assetId: 'aud_1',
    segmentIndex: 0,
    runId: 'run_1',
    inputText: 'hello world',
    referenceText: 'hello world',
    normalizedInput: 'hello world',
    normalizedReference: 'hello world',
    correctWords: 2,
    referenceWords: 2,
    actualWords: 2,
    accuracy: 1,
    playbackCount: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterAll(async () => {
  await db.delete();
});

describe('dictation repository', () => {
  it('saves and lists attempts by passage and segment', async () => {
    const id = await saveDictationAttempt(attempt());
    expect(id).toBeGreaterThan(0);

    const all = await listDictationAttempts('psg_1');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      segmentIndex: 0,
      accuracy: 1,
      referenceWords: 2,
    });

    const bySegment = await listDictationAttempts('psg_1', 0);
    expect(bySegment).toHaveLength(1);

    const latest = await latestDictationAttempts('psg_1', 'run_1');
    expect(latest).toHaveLength(1);
    expect(latest[0].id).toBe(id);
  });

  it('deduplicates an identical submission within 5 seconds and across runs', async () => {
    await saveDictationAttempt(attempt());
    await saveDictationAttempt(attempt());
    expect(await db.dictationRecords.count()).toBe(1);

    await saveDictationAttempt(attempt({ runId: 'run_2' }));
    expect(await db.dictationRecords.count()).toBe(2);

    await saveDictationAttempt(
      attempt({
        inputText: 'hello',
        normalizedInput: 'hello',
        actualWords: 1,
        correctWords: 1,
        accuracy: 0.5,
      }),
    );
    expect(await db.dictationRecords.count()).toBe(3);
  });

  it('returns the latest attempt per segment for a run', async () => {
    await saveDictationAttempt(
      attempt({
        inputText: 'one',
        normalizedInput: 'one',
        referenceText: 'one',
        normalizedReference: 'one',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await saveDictationAttempt(
      attempt({
        inputText: 'two',
        normalizedInput: 'two',
        referenceText: 'one two',
        normalizedReference: 'one two',
      }),
    );
    await saveDictationAttempt(
      attempt({
        segmentIndex: 1,
        inputText: 'three',
        normalizedInput: 'three',
        referenceText: 'three',
        normalizedReference: 'three',
      }),
    );

    const latest = await latestDictationAttempts('psg_1', 'run_1');
    expect(latest.map((record) => record.segmentIndex)).toEqual([0, 1]);
    expect(latest[0].normalizedInput).toBe('two');
  });
});
