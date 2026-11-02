import type { AssetRecord, PassageRecord } from '../../db/types';
import { clampRate, segmentsFromAsset } from './segments';
import type { AudioBackend, AudioSegment, AudioState } from './types';

export interface TtsBackendOptions {
  speech?: SpeechSynthesis | null;
  utteranceFactory?: (text: string) => SpeechSynthesisUtterance;
  voices?: SpeechSynthesisVoice[];
}

export class TTSAudioBackend implements AudioBackend {
  readonly kind = 'tts' as const;

  private speech: SpeechSynthesis | null;
  private utteranceFactory: (text: string) => SpeechSynthesisUtterance;
  private segments: AudioSegment[] = [];
  private listeners = new Set<(state: AudioState) => void>();
  private voice: SpeechSynthesisVoice | null = null;
  private accentLang = 'en-US';
  private currentIndex = 0;
  private token = 0;

  private state: AudioState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    rate: 1,
    segmentIndex: null,
    segmentOnce: null,
    loop: null,
  };

  constructor(private options: TtsBackendOptions = {}) {
    this.speech =
      options.speech ??
      (typeof window !== 'undefined' ? window.speechSynthesis : null);
    this.utteranceFactory =
      options.utteranceFactory ??
      ((text) => {
        if (typeof SpeechSynthesisUtterance === 'undefined') {
          throw new Error('此瀏覽器不支援語音合成');
        }
        return new SpeechSynthesisUtterance(text);
      });
  }

  async load(asset: AssetRecord, passage: PassageRecord): Promise<void> {
    this.segments = segmentsFromAsset(asset, passage);
    this.accentLang = accentToLang(asset.accent);
    this.currentIndex = 0;

    const voices = this.getVoices();
    const englishVoices = voices.filter((voice) =>
      voice.lang.toLowerCase().startsWith('en'),
    );
    this.voice = pickVoice(englishVoices, this.accentLang) ?? voices[0] ?? null;

    const missingSpeech = !this.speech;
    const missingEnglish = englishVoices.length === 0;

    this.state = {
      ...this.state,
      status: missingSpeech ? 'error' : 'idle',
      currentTime: 0,
      duration: this.segments.length,
      segmentIndex: this.segments.length > 0 ? 0 : null,
      segmentOnce: null,
      warning: missingEnglish
        ? '此瀏覽器沒有英語語音；將使用預設語音，或改用音頻檔。'
        : undefined,
      voiceAvailable: !missingEnglish,
      error: missingSpeech ? '此瀏覽器不支援語音合成' : undefined,
    };
    this.emit();
  }

  async play(): Promise<void> {
    if (!this.speech || this.segments.length === 0) return;
    if (this.state.status === 'playing') return;

    if (
      this.state.status === 'ended' ||
      this.currentIndex >= this.segments.length
    ) {
      this.currentIndex = 0;
    }

    this.state = {
      ...this.state,
      status: 'playing',
      segmentIndex: this.currentIndex,
      currentTime: this.currentIndex,
      segmentOnce: null,
    };
    this.emit();
    this.speakCurrent();
  }

  pause(): void {
    this.token += 1;
    this.speech?.cancel();
    this.state = {
      ...this.state,
      status: 'paused',
      segmentIndex: this.currentIndex,
      currentTime: this.currentIndex,
      segmentOnce: null,
    };
    this.emit();
  }

  stop(): void {
    this.token += 1;
    this.speech?.cancel();
    this.currentIndex = 0;
    this.state = {
      ...this.state,
      status: 'idle',
      currentTime: 0,
      segmentIndex: this.segments.length > 0 ? 0 : null,
      segmentOnce: null,
    };
    this.emit();
  }

  seek(sec: number): void {
    this.seekSegment(Math.floor(sec));
  }

  seekSegment(index: number): void {
    if (this.segments.length === 0) return;
    const target = Math.max(
      0,
      Math.min(this.segments.length - 1, index),
    );
    const wasPlaying = this.state.status === 'playing';
    this.token += 1;
    this.speech?.cancel();
    this.currentIndex = target;
    this.state = {
      ...this.state,
      segmentIndex: target,
      currentTime: target,
      segmentOnce: null,
    };

    if (wasPlaying) {
      this.state = { ...this.state, status: 'playing' };
      this.emit();
      this.speakCurrent();
    } else {
      this.emit();
    }
  }

  async playSegmentOnce(index: number): Promise<void> {
    if (!this.speech || this.segments.length === 0) return;
    const target = Math.max(
      0,
      Math.min(this.segments.length - 1, index),
    );
    this.token += 1;
    this.speech.cancel();
    this.currentIndex = target;
    this.state = {
      ...this.state,
      status: 'playing',
      segmentIndex: target,
      currentTime: target,
      segmentOnce: target,
    };
    this.emit();
    this.speakCurrent();
  }

  setRate(rate: number): void {
    const next = clampRate(rate);
    const wasPlaying = this.state.status === 'playing';
    this.state = { ...this.state, rate: next };

    if (wasPlaying) {
      this.token += 1;
      this.speech?.cancel();
      this.speakCurrent();
    } else {
      this.emit();
    }
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
    this.token += 1;
    this.speech?.cancel();
    this.speech = null;
    this.listeners.clear();
  }

  private speakCurrent(): void {
    if (!this.speech) return;
    if (this.currentIndex >= this.segments.length) {
      this.state = {
        ...this.state,
        status: 'ended',
        currentTime: this.segments.length,
        segmentIndex: this.segments.length - 1,
      };
      this.emit();
      return;
    }

    const token = ++this.token;
    const segment = this.segments[this.currentIndex];

    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = this.utteranceFactory(segment.text);
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : '語音合成失敗',
      };
      this.emit();
      return;
    }

    utterance.rate = clampRate(this.state.rate, 0.5, 2);
    utterance.lang = this.accentLang;
    if (this.voice) utterance.voice = this.voice;

    utterance.onstart = () => {
      if (token !== this.token) return;
      this.state = { ...this.state, status: 'playing' };
      this.emit();
    };

    utterance.onend = () => {
      if (token !== this.token) return;
      this.advance();
    };

    utterance.onerror = (event) => {
      if (token !== this.token) return;
      this.state = {
        ...this.state,
        status: 'error',
        error: event.error || '語音播放失敗',
      };
      this.emit();
    };

    utterance.onboundary = (event) => {
      if (token !== this.token) return;
      const length = Math.max(1, segment.text.length);
      this.state = {
        ...this.state,
        currentTime:
          this.currentIndex + Math.min(0.99, event.charIndex / length),
      };
      this.emit();
    };

    this.state = {
      ...this.state,
      segmentIndex: this.currentIndex,
      currentTime: this.currentIndex,
    };
    this.emit();
    this.speech.speak(utterance);
  }

  private advance(): void {
    if (this.state.segmentOnce !== null) {
      this.state = {
        ...this.state,
        status: 'paused',
        segmentIndex: this.currentIndex,
        currentTime: this.currentIndex,
      };
      this.emit();
      return;
    }

    const loop = this.state.loop;
    if (loop && this.currentIndex >= loop.endSeg) {
      this.currentIndex = loop.startSeg;
      this.state = {
        ...this.state,
        segmentIndex: this.currentIndex,
        currentTime: this.currentIndex,
      };
      this.emit();
      this.speakCurrent();
      return;
    }

    if (this.currentIndex + 1 >= this.segments.length) {
      this.state = {
        ...this.state,
        status: 'ended',
        currentTime: this.segments.length,
        segmentIndex: this.segments.length - 1,
      };
      this.emit();
      return;
    }

    this.currentIndex += 1;
    this.state = {
      ...this.state,
      segmentIndex: this.currentIndex,
      currentTime: this.currentIndex,
    };
    this.emit();
    this.speakCurrent();
  }

  private getVoices(): SpeechSynthesisVoice[] {
    if (this.options.voices) return this.options.voices;
    try {
      return this.speech?.getVoices() ?? [];
    } catch {
      return [];
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
  }
}

function accentToLang(accent: string | null | undefined): string {
  switch (accent) {
    case 'british':
      return 'en-GB';
    case 'australian':
      return 'en-AU';
    case 'canadian':
      return 'en-CA';
    default:
      return 'en-US';
  }
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((voice) =>
      voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()),
    ) ??
    voices[0]
  );
}
