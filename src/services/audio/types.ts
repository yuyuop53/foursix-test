import type { AssetRecord, PassageRecord } from '../../db/types';

export type AudioBackendKind = 'file' | 'tts';

export interface AudioSegment {
  index: number;
  start?: number;
  end?: number;
  text: string;
  textZh?: string;
}

export interface AudioState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  currentTime: number;
  duration: number;
  rate: number;
  segmentIndex: number | null;
  segmentOnce: number | null;
  loop: { startSeg: number; endSeg: number } | null;
  error?: string;
  warning?: string;
  voiceAvailable?: boolean;
}

export interface AudioBackend {
  kind: AudioBackendKind;
  load(asset: AssetRecord, passage: PassageRecord): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(sec: number): void;
  seekSegment(index: number): void;
  playSegmentOnce(index: number): Promise<void>;
  setRate(rate: number): void;
  setLoop(range: { startSeg: number; endSeg: number } | null): void;
  subscribe(listener: (state: AudioState) => void): () => void;
  destroy(): void;
}

export interface AudioResolution {
  kind: AudioBackendKind;
  backend: AudioBackend;
  error?: string;
}
