import { db } from './db';
import type { DictationRecord } from './types';

export interface SaveDictationInput {
  passageId: string;
  examId: string;
  assetId: string;
  segmentIndex: number;
  runId: string;
  inputText: string;
  referenceText: string;
  normalizedInput: string;
  normalizedReference: string;
  correctWords: number;
  referenceWords: number;
  actualWords: number;
  accuracy: number;
  playbackCount: number;
}

export async function saveDictationAttempt(
  input: SaveDictationInput,
): Promise<number> {
  const now = new Date().toISOString();

  return db.transaction('rw', db.dictationRecords, async () => {
    const recent = await db.dictationRecords
      .where('[passageId+runId]')
      .equals([input.passageId, input.runId])
      .filter(
        (record) =>
          record.segmentIndex === input.segmentIndex &&
          record.normalizedInput === input.normalizedInput &&
          Date.now() - Date.parse(record.createdAt) < 5000,
      )
      .first();

    if (recent?.id !== undefined) return recent.id;

    return db.dictationRecords.add({ ...input, createdAt: now });
  });
}

export async function listDictationAttempts(
  passageId: string,
  segmentIndex?: number,
): Promise<DictationRecord[]> {
  const records =
    segmentIndex === undefined
      ? await db.dictationRecords
          .where('passageId')
          .equals(passageId)
          .toArray()
      : await db.dictationRecords
          .where('[passageId+segmentIndex]')
          .equals([passageId, segmentIndex])
          .toArray();

  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function latestDictationAttempts(
  passageId: string,
  runId: string,
): Promise<DictationRecord[]> {
  const records = await db.dictationRecords
    .where('[passageId+runId]')
    .equals([passageId, runId])
    .toArray();

  const latest = new Map<number, DictationRecord>();
  for (const record of records) {
    const previous = latest.get(record.segmentIndex);
    if (!previous || record.createdAt >= previous.createdAt) {
      latest.set(record.segmentIndex, record);
    }
  }

  return [...latest.values()].sort(
    (a, b) => a.segmentIndex - b.segmentIndex,
  );
}
