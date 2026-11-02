import type { AssetRecord, PassageRecord } from '../../db/types';
import type { AudioSegment } from './types';

export function splitTranscript(
  transcript: string,
  transcriptZh?: string | null,
): AudioSegment[] {
  const texts = transcript
    .split(/(?<=[.!?])\s+/)
    .map((text) => text.trim())
    .filter(Boolean);

  const translations = transcriptZh
    ? transcriptZh
        .split(/(?<=[。！？])\s*/)
        .map((text) => text.trim())
        .filter(Boolean)
    : [];

  return texts.map((text, index) => ({
    index,
    text,
    textZh: translations[index],
  }));
}

export function segmentsFromAsset(
  asset: AssetRecord,
  passage: PassageRecord,
): AudioSegment[] {
  if (asset.segments && asset.segments.length > 0) {
    return [...asset.segments]
      .sort((a, b) => a.index - b.index)
      .map((segment, index) => ({ ...segment, index }));
  }

  return splitTranscript(
    passage.transcript ?? '',
    passage.transcriptZh ?? null,
  );
}

export function findSegmentAt(
  segments: AudioSegment[],
  seconds: number,
): number | null {
  for (const segment of segments) {
    if (
      segment.start !== undefined &&
      segment.end !== undefined &&
      seconds >= segment.start &&
      seconds < segment.end
    ) {
      return segment.index;
    }
  }
  return null;
}

export function nextLoopTime(
  segments: AudioSegment[],
  loop: { startSeg: number; endSeg: number } | null,
  currentTime: number,
): number | null {
  if (!loop) return null;

  const endSegment = segments[loop.endSeg];
  const startSegment = segments[loop.startSeg];
  if (
    !endSegment ||
    !startSegment ||
    endSegment.end === undefined ||
    startSegment.start === undefined
  ) {
    return null;
  }

  return currentTime >= endSegment.end ? startSegment.start : null;
}

export function clampRate(rate: number, min = 0.5, max = 2): number {
  return Math.min(max, Math.max(min, rate));
}
