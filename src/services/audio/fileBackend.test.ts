import { describe, expect, it } from 'vitest';
import type { AssetRecord, PassageRecord } from '../../db/types';
import { FileAudioBackend } from './fileBackend';
import type { AudioState } from './types';

class MockAudio {
  src = '';
  preload = '';
  currentTime = 0;
  duration = 10;
  playbackRate = 1;
  paused = true;
  preservesPitch = false;
  webkitPreservesPitch = false;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(name: string, handler: () => void): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(handler);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, handler: () => void): void {
    this.listeners.get(name)?.delete(handler);
  }

  play(): Promise<void> {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.emit('pause');
  }

  emit(name: string): void {
    for (const handler of this.listeners.get(name) ?? []) handler();
  }
}

const asset = {
  id: 'aud_test',
  kind: 'audio',
  backend: 'local',
  src: 'audio/test.mp3',
  synthetic: false,
  license: 'CC0',
  segments: [
    { index: 0, start: 0, end: 3, text: 'A' },
    { index: 1, start: 3, end: 6, text: 'B' },
    { index: 2, start: 6, end: 9, text: 'C' },
  ],
} as AssetRecord;

const passage = {
  id: 'psg_test',
  transcript: 'A B C',
} as PassageRecord;

function setup() {
  const audio = new MockAudio();
  const backend = new FileAudioBackend({
    audioFactory: () => audio as unknown as HTMLAudioElement,
    baseUrl: '/',
  });
  let latest: AudioState | undefined;
  backend.subscribe((state) => {
    latest = state;
  });
  return { backend, audio, state: () => latest as AudioState };
}

describe('FileAudioBackend', () => {
  it('loads the source and plays', async () => {
    const { backend, audio, state } = setup();
    await backend.load(asset, passage);

    expect(audio.src).toBe('/audio/test.mp3');
    expect(audio.preload).toBe('metadata');
    expect(audio.preservesPitch).toBe(true);
    expect(state().status).toBe('idle');

    await backend.play();
    expect(state().status).toBe('playing');
  });

  it('updates duration, seeks, and changes rate', async () => {
    const { backend, audio, state } = setup();
    await backend.load(asset, passage);

    audio.duration = 9;
    audio.emit('loadedmetadata');
    expect(state().duration).toBe(9);

    backend.seek(4.5);
    expect(audio.currentTime).toBe(4.5);
    expect(state().segmentIndex).toBe(1);

    backend.setRate(1.25);
    expect(audio.playbackRate).toBe(1.25);
    expect(state().rate).toBe(1.25);
  });

  it('loops back to the A segment when B ends', async () => {
    const { backend, audio, state } = setup();
    await backend.load(asset, passage);
    backend.setLoop({ startSeg: 1, endSeg: 1 });

    audio.currentTime = 6.2;
    audio.emit('timeupdate');

    expect(audio.currentTime).toBe(3);
    expect(state().segmentIndex).toBe(1);
  });

  it('plays one segment once and pauses at its end', async () => {
    const { backend, audio, state } = setup();
    await backend.load(asset, passage);
    await backend.playSegmentOnce(1);

    expect(audio.currentTime).toBe(3);
    expect(state().status).toBe('playing');
    expect(state().segmentOnce).toBe(1);

    audio.currentTime = 5.98;
    audio.emit('timeupdate');

    expect(audio.currentTime).toBe(6);
    expect(state().status).toBe('paused');
    expect(state().segmentIndex).toBe(1);
    expect(state().segmentOnce).toBe(1);
  });

  it('normal play clears the one-shot state', async () => {
    const { backend, audio, state } = setup();
    await backend.load(asset, passage);
    await backend.playSegmentOnce(1);
    await backend.play();

    expect(state().segmentOnce).toBeNull();
    expect(audio.paused).toBe(false);
  });

  it('cleans up on destroy', async () => {
    const { backend, audio } = setup();
    await backend.load(asset, passage);
    backend.destroy();

    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
  });
});
