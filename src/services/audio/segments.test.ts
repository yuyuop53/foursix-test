import { describe, expect, it } from 'vitest';
import type { AssetRecord, PassageRecord } from '../../db/types';
import {
  clampRate,
  findSegmentAt,
  nextLoopTime,
  segmentsFromAsset,
  splitTranscript,
} from './segments';

const passage = {
  id: 'psg_test',
  transcript: 'One. Two! Three?',
  transcriptZh: '一。二！三？',
} as PassageRecord;

const asset = {
  id: 'aud_test',
  kind: 'audio',
  backend: 'tts',
  src: '',
  synthetic: true,
  license: 'TTS',
} as AssetRecord;

describe('splitTranscript', () => {
  it('splits English sentences and aligns Chinese translations', () => {
    const segments = splitTranscript('One. Two! Three?', '一。二！三？');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ index: 0, text: 'One.', textZh: '一。' });
    expect(segments[2]).toMatchObject({ index: 2, text: 'Three?', textZh: '三？' });
  });
});

describe('segmentsFromAsset', () => {
  it('uses explicit segments and normalizes their indexes', () => {
    const segments = segmentsFromAsset(
      {
        ...asset,
        segments: [
          { index: 5, text: 'Second' },
          { index: 2, text: 'First' },
        ],
      },
      passage,
    );
    expect(segments.map((segment) => segment.text)).toEqual([
      'First',
      'Second',
    ]);
    expect(segments.map((segment) => segment.index)).toEqual([0, 1]);
  });

  it('falls back to the transcript when segments are missing', () => {
    const segments = segmentsFromAsset(asset, passage);
    expect(segments).toHaveLength(3);
    expect(segments[1].textZh).toBe('二！');
  });
});

describe('timed segment helpers', () => {
  const timed = [
    { index: 0, start: 0, end: 3, text: 'A' },
    { index: 1, start: 3, end: 6, text: 'B' },
    { index: 2, start: 6, end: 9, text: 'C' },
  ];

  it('finds the segment at a time', () => {
    expect(findSegmentAt(timed, 0)).toBe(0);
    expect(findSegmentAt(timed, 2.9)).toBe(0);
    expect(findSegmentAt(timed, 3)).toBe(1);
    expect(findSegmentAt(timed, 10)).toBeNull();
  });

  it('loops back to the start once the loop end is reached', () => {
    const loop = { startSeg: 1, endSeg: 2 };
    expect(nextLoopTime(timed, loop, 5.9)).toBeNull();
    expect(nextLoopTime(timed, loop, 6)).toBeNull();
    expect(nextLoopTime(timed, loop, 9)).toBe(3);
    expect(nextLoopTime(timed, { startSeg: 1, endSeg: 1 }, 6)).toBe(3);
    expect(nextLoopTime(timed, null, 6)).toBeNull();
  });

  it('clamps playback rates', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(1.25)).toBe(1.25);
    expect(clampRate(4)).toBe(2);
  });
});
