import type { AssetRecord, PassageRecord } from '../../db/types';
import { FileAudioBackend, type FileBackendOptions } from './fileBackend';
import { TTSAudioBackend, type TtsBackendOptions } from './ttsBackend';
import type { AudioResolution } from './types';

export interface AudioResolveOptions {
  file?: FileBackendOptions;
  tts?: TtsBackendOptions;
}

export function createAudioBackend(
  asset: AssetRecord,
  passage: PassageRecord,
  options: AudioResolveOptions = {},
): AudioResolution {
  void passage;

  if (asset.kind !== 'audio') {
    return {
      kind: 'file',
      backend: new FileAudioBackend(options.file),
      error: '此資源不是音頻',
    };
  }

  if (asset.backend === 'tts') {
    const speech =
      options.tts?.speech ??
      (typeof window !== 'undefined' ? window.speechSynthesis : null);

    const backend = new TTSAudioBackend({
      ...options.tts,
      speech,
    });

    return {
      kind: 'tts',
      backend,
      error: speech ? undefined : '此瀏覽器不支援語音合成',
    };
  }

  return {
    kind: 'file',
    backend: new FileAudioBackend(options.file),
  };
}
