import { describe, expect, it } from 'vitest';
import type { AssetRecord, PassageRecord } from '../../db/types';
import { TTSAudioBackend } from './ttsBackend';
import type { AudioState } from './types';

class MockUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onboundary: ((event: { charIndex: number }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class MockSpeech {
  voices: SpeechSynthesisVoice[];
  spoken: MockUtterance[] = [];
  cancelCount = 0;

  constructor(voices: SpeechSynthesisVoice[]) {
    this.voices = voices;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  speak(utterance: MockUtterance): void {
    this.spoken.push(utterance);
  }

  cancel(): void {
    this.cancelCount += 1;
  }
}

const englishVoice = {
  name: 'Test US',
  lang: 'en-US',
} as SpeechSynthesisVoice;

const chineseVoice = {
  name: 'Test CN',
  lang: 'zh-CN',
} as SpeechSynthesisVoice;

const asset = {
  id: 'aud_test',
  kind: 'audio',
  backend: 'tts',
  src: '',
  synthetic: true,
  license: 'TTS',
  segments: [
    { index: 0, text: 'First sentence.' },
    { index: 1, text: 'Second sentence.' },
  ],
} as AssetRecord;

const passage = {
  id: 'psg_test',
  transcript: 'First sentence. Second sentence.',
} as PassageRecord;

function setup(voices = [englishVoice]) {
  const speech = new MockSpeech(voices);
  const backend = new TTSAudioBackend({
    speech: speech as unknown as SpeechSynthesis,
    voices,
    utteranceFactory: (text) =>
      new MockUtterance(text) as unknown as SpeechSynthesisUtterance,
  });
  let latest: AudioState | undefined;
  backend.subscribe((state) => {
    latest = state;
  });
  return {
    backend,
    speech,
    state: () => latest as AudioState,
  };
}

describe('TTSAudioBackend', () => {
  it('speaks segments in order and ends after the last one', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    await backend.play();

    expect(state().status).toBe('playing');
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0].text).toBe('First sentence.');

    speech.spoken[0].onstart?.();
    speech.spoken[0].onend?.();
    expect(state().segmentIndex).toBe(1);
    expect(speech.spoken).toHaveLength(2);

    speech.spoken[1].onend?.();
    expect(state().status).toBe('ended');
    expect(state().duration).toBe(2);
  });

  it('repeats a configured AB loop', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    backend.setLoop({ startSeg: 0, endSeg: 1 });
    await backend.play();

    speech.spoken[0].onend?.();
    expect(state().segmentIndex).toBe(1);
    speech.spoken[1].onend?.();
    expect(state().segmentIndex).toBe(0);
    expect(speech.spoken).toHaveLength(3);
  });

  it('pauses by cancelling the current utterance', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    await backend.play();
    backend.pause();

    expect(speech.cancelCount).toBeGreaterThan(0);
    expect(state().status).toBe('paused');
  });

  it('seeks to a segment and resumes from it', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    backend.seekSegment(1);
    expect(state().segmentIndex).toBe(1);

    await backend.play();
    expect(speech.spoken[0].text).toBe('Second sentence.');
  });

  it('plays a single segment once and pauses without advancing', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    await backend.playSegmentOnce(1);

    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0].text).toBe('Second sentence.');
    expect(state().segmentOnce).toBe(1);

    speech.spoken[0].onend?.();

    expect(state().status).toBe('paused');
    expect(state().segmentIndex).toBe(1);
    expect(speech.spoken).toHaveLength(1);
  });

  it('normal play clears the one-shot state', async () => {
    const { backend, speech, state } = setup();
    await backend.load(asset, passage);
    await backend.playSegmentOnce(0);
    speech.spoken[0].onend?.();

    expect(state().status).toBe('paused');
    expect(state().segmentOnce).toBe(0);

    await backend.play();
    expect(state().segmentOnce).toBeNull();
    expect(speech.spoken).toHaveLength(2);
  });

  it('warns when no English voice is available', async () => {
    const { backend, state } = setup([chineseVoice]);
    await backend.load(asset, passage);

    expect(state().voiceAvailable).toBe(false);
    expect(state().warning).toMatch(/沒有英語語音/);
  });
});
