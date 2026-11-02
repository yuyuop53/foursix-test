import { useEffect, useRef, useState } from 'react';
import type { AssetRecord } from '../../db/types';
import type { AudioEngine } from './useAudioEngine';
import { Badge, Button, Card } from '../ui';
import { cn, formatDuration } from '../../lib/utils';

const RATES = [0.75, 1, 1.1, 1.2, 1.25, 1.5];

export function AudioPlayer({
  engine,
  asset,
  hideTranscript = false,
}: {
  engine: AudioEngine;
  asset: AssetRecord;
  hideTranscript?: boolean;
}) {
  const [showChinese, setShowChinese] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const {
    state,
    segments,
    isTts,
    hasError,
    activeIndex,
    loop,
    isPlaying,
  } = engine;

  useEffect(() => {
    if (hideTranscript) return;
    const container = transcriptRef.current;
    const active = segmentRefs.current[activeIndex];
    if (!container || !active) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const fullyVisible =
      activeRect.top >= containerRect.top &&
      activeRect.bottom <= containerRect.bottom;
    if (fullyVisible) return;

    const target =
      container.scrollTop +
      (activeRect.top - containerRect.top) -
      container.clientHeight / 2 +
      activeRect.height / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex, hideTranscript]);

  const hasChinese = segments.some((segment) => Boolean(segment.textZh));
  const warning =
    state?.warning ?? engine.resolutionError ?? state?.error ?? null;

  const handleSeek = (value: number) => {
    if (isTts) engine.seekSegment(Math.round(value));
    else engine.seek(value);
  };

  const handleRate = (value: number) => {
    engine.setRate(value);
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isTts ? 'warn' : 'accent'}>
            {isTts ? 'TTS 非原聲' : '音頻檔'}
          </Badge>
          {asset.synthetic ? <Badge tone="warn">合成音頻</Badge> : null}
          {asset.accent ? <Badge tone="muted">{asset.accent.toUpperCase()}</Badge> : null}
          {asset.wpm ? <Badge tone="muted">{asset.wpm} wpm</Badge> : null}
        </div>
        <div className="text-[11px] text-faint">
          {isTts
            ? `第 ${Math.min(activeIndex + 1, Math.max(1, segments.length))} / ${segments.length} 句`
            : `${formatDuration(state?.currentTime ?? 0)} / ${formatDuration(state?.duration ?? 0)}`}
        </div>
      </div>

      {warning ? (
        <div className="mt-3 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-[11px] leading-5 text-warn">
          {warning}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={engine.toggle} disabled={hasError || segments.length === 0}>
          {isPlaying ? '暫停' : '播放'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={engine.stop}
          disabled={hasError}
        >
          回到開頭
        </Button>

        <label className="flex items-center gap-2 text-[11px] text-muted">
          速度
          <select
            value={state?.rate ?? 1}
            onChange={(event) => handleRate(Number(event.target.value))}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
          >
            {RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>

        {!hideTranscript && hasChinese ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowChinese((value) => !value)}
          >
            {showChinese ? '隱藏中文' : '顯示中文'}
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {isTts ? (
          <input
            type="range"
            min={0}
            max={Math.max(0, segments.length - 1)}
            step={1}
            value={Math.min(activeIndex, Math.max(0, segments.length - 1))}
            onChange={(event) => handleSeek(Number(event.target.value))}
            className="w-full accent-[#5eead4]"
            aria-label="逐句進度"
          />
        ) : (
          <input
            type="range"
            min={0}
            max={Math.max(0.1, state?.duration ?? 0)}
            step={0.1}
            value={Math.min(state?.currentTime ?? 0, state?.duration ?? 0)}
            onChange={(event) => handleSeek(Number(event.target.value))}
            className="w-full accent-[#5eead4]"
            aria-label="音頻進度"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-panel-2/40 px-3 py-2">
        <span className="text-[11px] text-faint">AB 循環</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => engine.setLoopPoint('a')}
          disabled={segments.length === 0}
        >
          A
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => engine.setLoopPoint('b')}
          disabled={segments.length === 0}
        >
          B
        </Button>
        {loop ? (
          <>
            <span className="text-[11px] text-accent">
              第 {loop.startSeg + 1} 句 → 第 {loop.endSeg + 1} 句
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => engine.setLoop(null)}
            >
              清除
            </Button>
          </>
        ) : (
          <span className="text-[11px] text-faint">
            在目前句按 A / B 設定循環範圍
          </span>
        )}
      </div>

      {hideTranscript ? (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-panel-2/30 px-3 py-3 text-[11px] leading-5 text-faint">
          聽寫模式已隱藏逐字稿；請用「播放本句」與輸入框作答。
        </div>
      ) : (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[11px] text-faint">
            <span>字幕（点击句子跳转）</span>
            <span>{isPlaying ? '自动跟随播放' : '跟随播放进度'}</span>
          </div>
          <div
            ref={transcriptRef}
            className="max-h-[420px] space-y-1.5 overflow-y-auto rounded-xl border border-line-soft bg-panel-2/20 p-1.5 pr-1"
          >
            {segments.map((segment) => {
              const active = segment.index === activeIndex;
              return (
                <button
                  key={segment.index}
                  ref={(node) => {
                    segmentRefs.current[segment.index] = node;
                  }}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => engine.seekSegment(segment.index)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    active
                      ? 'border-accent/50 bg-accent/10 shadow-[inset_3px_0_0_0_var(--color-accent)]'
                      : 'border-line-soft hover:border-line hover:bg-panel-2/40',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                      active
                        ? 'border-accent/50 text-accent'
                        : 'border-line text-faint',
                    )}
                  >
                    {segment.index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm leading-6',
                        active ? 'text-ink' : 'text-muted',
                      )}
                    >
                      {segment.text}
                    </span>
                    {showChinese && segment.textZh ? (
                      <span className="mt-0.5 block text-[11px] leading-5 text-faint">
                        {segment.textZh}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
