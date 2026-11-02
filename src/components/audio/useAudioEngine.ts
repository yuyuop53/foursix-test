import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRecord, PassageRecord } from '../../db/types';
import {
  createAudioBackend,
  segmentsFromAsset,
  type AudioBackend,
  type AudioSegment,
  type AudioState,
} from '../../services/audio';

export interface AudioEngine {
  state: AudioState | null;
  resolutionError: string | null;
  segments: AudioSegment[];
  isTts: boolean;
  hasError: boolean;
  activeIndex: number;
  loop: { startSeg: number; endSeg: number } | null;
  isPlaying: boolean;
  play(): Promise<void>;
  pause(): void;
  toggle(): void;
  stop(): void;
  seek(sec: number): void;
  seekSegment(index: number): void;
  playSegmentOnce(index: number): Promise<void>;
  setRate(rate: number): void;
  setLoop(range: { startSeg: number; endSeg: number } | null): void;
  setLoopPoint(kind: 'a' | 'b'): void;
}

export function useAudioEngine(
  asset: AssetRecord,
  passage: PassageRecord,
): AudioEngine {
  const backendRef = useRef<AudioBackend | null>(null);
  const [state, setState] = useState<AudioState | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  const segments = useMemo(
    () => segmentsFromAsset(asset, passage),
    [asset, passage],
  );
  const isTts = asset.backend === 'tts';
  const hasError = Boolean(state?.error || resolutionError);
  const activeIndex = state?.segmentIndex ?? 0;
  const loop = state?.loop ?? null;
  const isPlaying = state?.status === 'playing';

  useEffect(() => {
    setState(null);
    setResolutionError(null);

    const resolution = createAudioBackend(asset, passage);
    const backend = resolution.backend;
    backendRef.current = backend;

    if (resolution.error) setResolutionError(resolution.error);

    const unsubscribe = backend.subscribe((next) => setState(next));
    void backend
      .load(asset, passage)
      .then(() => setResolutionError(null))
      .catch((error) => {
        setResolutionError(
          error instanceof Error ? error.message : '音頻載入失敗',
        );
      });

    return () => {
      unsubscribe();
      backend.destroy();
      backendRef.current = null;
    };
  }, [asset.id, passage.id]);

  const play = async (): Promise<void> => {
    await backendRef.current?.play();
  };

  const pause = (): void => {
    backendRef.current?.pause();
  };

  const toggle = (): void => {
    const backend = backendRef.current;
    if (!backend) return;
    if (state?.status === 'playing') backend.pause();
    else void backend.play();
  };

  const stop = (): void => {
    backendRef.current?.stop();
  };

  const seek = (sec: number): void => {
    backendRef.current?.seek(sec);
  };

  const seekSegment = (index: number): void => {
    backendRef.current?.seekSegment(index);
  };

  const playSegmentOnce = async (index: number): Promise<void> => {
    await backendRef.current?.playSegmentOnce(index);
  };

  const setRate = (rate: number): void => {
    backendRef.current?.setRate(rate);
  };

  const setLoop = (
    range: { startSeg: number; endSeg: number } | null,
  ): void => {
    backendRef.current?.setLoop(range);
  };

  const setLoopPoint = (kind: 'a' | 'b'): void => {
    const backend = backendRef.current;
    if (!backend) return;

    const current = activeIndex;
    const start = kind === 'a' ? current : loop?.startSeg ?? current;
    const end = kind === 'b' ? current : loop?.endSeg ?? current;
    backend.setLoop({
      startSeg: Math.min(start, end),
      endSeg: Math.max(start, end),
    });
  };

  return {
    state,
    resolutionError,
    segments,
    isTts,
    hasError,
    activeIndex,
    loop,
    isPlaying,
    play,
    pause,
    toggle,
    stop,
    seek,
    seekSegment,
    playSegmentOnce,
    setRate,
    setLoop,
    setLoopPoint,
  };
}
