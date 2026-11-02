import type { AssetRecord, PassageRecord } from '../../db/types';
import {
  clampRate,
  findSegmentAt,
  nextLoopTime,
  segmentsFromAsset,
} from './segments';
import type { AudioBackend, AudioSegment, AudioState } from './types';

export interface FileBackendOptions {
  audioFactory?: (src: string) => HTMLAudioElement;
  baseUrl?: string;
}

export class FileAudioBackend implements AudioBackend {
  readonly kind = 'file' as const;

  private audio: HTMLAudioElement | null = null;
  private segments: AudioSegment[] = [];
  private listeners = new Set<(state: AudioState) => void>();
  private state: AudioState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    rate: 1,
    segmentIndex: null,
    segmentOnce: null,
    loop: null,
  };

  constructor(private options: FileBackendOptions = {}) {}

  async load(asset: AssetRecord, passage: PassageRecord): Promise<void> {
    this.segments = segmentsFromAsset(asset, passage);
    const src = this.resolveSrc(asset);
    if (!src) {
      this.state = {
        ...this.state,
        status: 'error',
        error: '音頻缺少 src',
      };
      this.emit();
      return;
    }

    const audio =
      this.options.audioFactory?.(src) ??
      (typeof Audio !== 'undefined' ? new Audio(src) : null);

    if (!audio) {
      this.state = {
        ...this.state,
        status: 'error',
        error: '此瀏覽器不支援音頻播放',
      };
      this.emit();
      return;
    }

    this.audio = audio;
    audio.preload = 'metadata';
    (audio as unknown as { preservesPitch?: boolean }).preservesPitch = true;
    (audio as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
      true;

    audio.addEventListener('loadedmetadata', this.onLoadedMetadata);
    audio.addEventListener('timeupdate', this.onTimeUpdate);
    audio.addEventListener('play', this.onPlay);
    audio.addEventListener('pause', this.onPause);
    audio.addEventListener('ended', this.onEnded);
    audio.addEventListener('error', this.onError);

    if (!audio.src) audio.src = src;

    this.state = {
      ...this.state,
      status: 'idle',
      currentTime: 0,
      segmentIndex: this.segments[0]?.index ?? null,
      segmentOnce: null,
    };
    this.emit();
  }

  async play(): Promise<void> {
    if (!this.audio) return;
    this.state = { ...this.state, segmentOnce: null };
    try {
      await this.audio.play();
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : '播放失敗',
      };
      this.emit();
    }
  }

  pause(): void {
    this.state = { ...this.state, segmentOnce: null };
    this.audio?.pause();
    this.state = {
      ...this.state,
      status: this.state.status === 'ended' ? 'ended' : 'paused',
    };
    this.emit();
  }

  stop(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.state = {
      ...this.state,
      status: 'idle',
      currentTime: 0,
      segmentIndex: this.segments[0]?.index ?? null,
      segmentOnce: null,
    };
    this.emit();
  }

  seek(sec: number): void {
    if (!this.audio) return;
    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : 0;
    const next = Math.min(
      duration > 0 ? duration : Math.max(0, sec),
      Math.max(0, sec),
    );
    this.audio.currentTime = next;
    this.state = {
      ...this.state,
      currentTime: next,
      segmentIndex: findSegmentAt(this.segments, next),
      segmentOnce: null,
    };
    this.emit();
  }

  seekSegment(index: number): void {
    const segment = this.segments[index];
    if (segment?.start !== undefined) {
      this.seek(segment.start);
    }
  }

  async playSegmentOnce(index: number): Promise<void> {
    const segment = this.segments[index];
    if (
      !segment ||
      segment.start === undefined ||
      segment.end === undefined
    ) {
      this.state = {
        ...this.state,
        status: 'error',
        error: '此句缺少時間標記，無法單句播放',
      };
      this.emit();
      return;
    }
    if (!this.audio) return;

    this.audio.currentTime = segment.start;
    this.state = {
      ...this.state,
      status: 'playing',
      currentTime: segment.start,
      segmentIndex: segment.index,
      segmentOnce: index,
    };
    this.emit();

    try {
      await this.audio.play();
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : '播放失敗',
      };
      this.emit();
    }
  }

  setRate(rate: number): void {
    if (!this.audio) return;
    const next = clampRate(rate);
    this.audio.playbackRate = next;
    this.state = { ...this.state, rate: next };
    this.emit();
  }

  setLoop(range: { startSeg: number; endSeg: number } | null): void {
    this.state = { ...this.state, loop: range };
    this.emit();
  }

  subscribe(listener: (state: AudioState) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeEventListener('loadedmetadata', this.onLoadedMetadata);
      this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
      this.audio.removeEventListener('play', this.onPlay);
      this.audio.removeEventListener('pause', this.onPause);
      this.audio.removeEventListener('ended', this.onEnded);
      this.audio.removeEventListener('error', this.onError);
      this.audio.src = '';
    }
    this.audio = null;
    this.listeners.clear();
  }

  private onLoadedMetadata = () => {
    if (!this.audio) return;
    this.state = {
      ...this.state,
      duration: Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : 0,
    };
    this.emit();
  };

  private onTimeUpdate = () => {
    if (!this.audio) return;
    const currentTime = this.audio.currentTime;
    const segmentOnce = this.state.segmentOnce;

    if (segmentOnce !== null) {
      const segment = this.segments[segmentOnce];
      if (segment?.end !== undefined && currentTime >= segment.end - 0.02) {
        this.audio.pause();
        this.audio.currentTime = segment.end;
        this.state = {
          ...this.state,
          status: 'paused',
          currentTime: segment.end,
          segmentIndex: segmentOnce,
        };
        this.emit();
        return;
      }

      this.state = {
        ...this.state,
        currentTime,
        segmentIndex: segmentOnce,
      };
      this.emit();
      return;
    }

    const loopTarget = nextLoopTime(
      this.segments,
      this.state.loop,
      currentTime,
    );

    if (loopTarget !== null) {
      this.audio.currentTime = loopTarget;
    }

    this.state = {
      ...this.state,
      currentTime: loopTarget ?? currentTime,
      segmentIndex: findSegmentAt(
        this.segments,
        loopTarget ?? currentTime,
      ),
    };
    this.emit();
  };

  private onPlay = () => {
    this.state = { ...this.state, status: 'playing' };
    this.emit();
  };

  private onPause = () => {
    if (this.state.status === 'ended') return;
    this.state = { ...this.state, status: 'paused' };
    this.emit();
  };

  private onEnded = () => {
    this.state = { ...this.state, status: 'ended', segmentOnce: null };
    this.emit();
  };

  private onError = () => {
    this.state = {
      ...this.state,
      status: 'error',
      error: '音頻載入或播放失敗',
    };
    this.emit();
  };

  private resolveSrc(asset: AssetRecord): string {
    const src = asset.src?.trim() ?? '';
    if (!src) return '';
    if (/^(https?:|blob:|data:)/i.test(src)) return src;
    if (src.startsWith('/')) return src;

    const base =
      this.options.baseUrl ??
      (import.meta as unknown as { env?: { BASE_URL?: string } }).env
        ?.BASE_URL ??
      '/';

    return `${base.endsWith('/') ? base : `${base}/`}${src}`;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
  }
}
