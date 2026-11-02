import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PassageRecord } from '../../db/types';
import {
  latestDictationAttempts,
  saveDictationAttempt,
} from '../../db/dictationRepo';
import type { AudioEngine } from '../../components/audio/useAudioEngine';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card } from '../../components/ui';
import {
  scoreDictation,
  type DictationScore,
} from '../../services/dictation/diff';
import { cn } from '../../lib/utils';
import rulesConfig from '../../../config/exam_rules.json';

const MAX_REPLAYS = rulesConfig.listening.dictation.max_replays;
const STORAGE_PREFIX = 'cetlab:dictation:';

interface StoredRun {
  runId: string;
  currentSegment: number;
  drafts: Record<string, string>;
  replays: Record<string, number>;
}

function createRunId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function loadStoredRun(passageId: string): StoredRun {
  const fallback: StoredRun = {
    runId: createRunId(),
    currentSegment: 0,
    drafts: {},
    replays: {},
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + passageId);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredRun>;
    if (typeof parsed.runId !== 'string') return fallback;
    return {
      runId: parsed.runId,
      currentSegment:
        typeof parsed.currentSegment === 'number' &&
        Number.isFinite(parsed.currentSegment)
          ? Math.max(0, Math.floor(parsed.currentSegment))
          : 0,
      drafts:
        parsed.drafts && typeof parsed.drafts === 'object'
          ? (parsed.drafts as Record<string, string>)
          : {},
      replays:
        parsed.replays && typeof parsed.replays === 'object'
          ? (parsed.replays as Record<string, number>)
          : {},
    };
  } catch {
    return fallback;
  }
}

function saveStoredRun(passageId: string, run: StoredRun): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + passageId,
      JSON.stringify(run),
    );
  } catch {
    // localStorage unavailable; drafts remain in memory
  }
}

export function DictationPanel({
  engine,
  passage,
  examId,
}: {
  engine: AudioEngine;
  passage: PassageRecord;
  examId: string;
}) {
  const toast = useToast();
  const segments = engine.segments;
  const initial = useMemo(() => loadStoredRun(passage.id), [passage.id]);

  const [runId, setRunId] = useState(initial.runId);
  const [segmentIndex, setSegmentIndex] = useState(() =>
    Math.min(initial.currentSegment, Math.max(0, segments.length - 1)),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(initial.drafts);
  const [replays, setReplays] = useState<Record<string, number>>(initial.replays);
  const [localScores, setLocalScores] = useState<
    Record<string, DictationScore>
  >({});
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);

  const latest = useLiveQuery(
    () => latestDictationAttempts(passage.id, runId),
    [passage.id, runId],
  );
  const latestBySegment = useMemo(
    () => new Map((latest ?? []).map((record) => [record.segmentIndex, record])),
    [latest],
  );

  useEffect(() => {
    saveStoredRun(passage.id, {
      runId,
      currentSegment: segmentIndex,
      drafts,
      replays,
    });
  }, [passage.id, runId, segmentIndex, drafts, replays]);

  const reference = segments[segmentIndex]?.text ?? '';
  const draftKey = String(segmentIndex);
  const draft = drafts[draftKey] ?? '';
  const replayCount = replays[draftKey] ?? 0;
  const currentScore = localScores[draftKey] ?? null;
  const latestForSegment = latestBySegment.get(segmentIndex);

  const summary = useMemo(() => {
    const scores = new Map<number, number>();
    for (const record of latest ?? []) {
      scores.set(record.segmentIndex, record.accuracy);
    }
    for (const [key, score] of Object.entries(localScores)) {
      scores.set(Number(key), score.accuracy);
    }
    return [...scores.entries()]
      .map(([segment, accuracy]) => ({ segment, accuracy }))
      .sort((a, b) => a.segment - b.segment);
  }, [latest, localScores]);

  const updateDraft = (value: string) => {
    setDrafts((previous) => ({ ...previous, [draftKey]: value }));
    setLocalScores((previous) => {
      const next = { ...previous };
      delete next[draftKey];
      return next;
    });
  };

  const handlePlay = () => {
    if (segments.length === 0) return;
    if (replayCount >= MAX_REPLAYS) {
      toast.push(`本句最多播放 ${MAX_REPLAYS} 次`, 'error');
      return;
    }
    setReplays((previous) => ({
      ...previous,
      [draftKey]: replayCount + 1,
    }));
    void engine.playSegmentOnce(segmentIndex);
  };

  const handleCheck = async () => {
    if (saving || segments.length === 0) return;
    setSaving(true);
    try {
      const score = scoreDictation(reference, draft);
      setLocalScores((previous) => ({ ...previous, [draftKey]: score }));
      await saveDictationAttempt({
        passageId: passage.id,
        examId,
        assetId: passage.audioAssetId ?? '',
        segmentIndex,
        runId,
        inputText: draft,
        referenceText: reference,
        normalizedInput: score.normalizedInput,
        normalizedReference: score.normalizedReference,
        correctWords: score.correctWords,
        referenceWords: score.referenceWords,
        actualWords: score.actualWords,
        accuracy: score.accuracy,
        playbackCount: replayCount,
      });
    } catch (error) {
      toast.push(
        error instanceof Error ? error.message : '聽寫紀錄儲存失敗',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePrev = () => {
    setSegmentIndex((value) => Math.max(0, value - 1));
    setFinished(false);
  };

  const handleNext = () => {
    if (segmentIndex + 1 >= segments.length) {
      setFinished(true);
      return;
    }
    setSegmentIndex((value) => value + 1);
    setFinished(false);
  };

  const handleSelect = (value: number) => {
    setSegmentIndex(value);
    setFinished(false);
  };

  const handleResetSegment = () => {
    if (!window.confirm('重設本句的輸入與播放次數？')) return;
    setDrafts((previous) => ({ ...previous, [draftKey]: '' }));
    setReplays((previous) => ({ ...previous, [draftKey]: 0 }));
    setLocalScores((previous) => {
      const next = { ...previous };
      delete next[draftKey];
      return next;
    });
  };

  const handleRestart = () => {
    setRunId(createRunId());
    setSegmentIndex(0);
    setDrafts({});
    setReplays({});
    setLocalScores({});
    setFinished(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleCheck();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      handlePlay();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      handleNext();
    }
  };

  if (segments.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">
          這段音頻沒有可用的逐句內容，無法進行聽寫。
        </p>
      </Card>
    );
  }

  if (finished) {
    const attempted = summary.length;
    const average =
      attempted > 0
        ? Math.round(
            (summary.reduce((total, item) => total + item.accuracy, 0) /
              attempted) *
              100,
          )
        : 0;
    const exact = summary.filter((item) => item.accuracy === 1).length;
    const sorted = [...summary].sort((a, b) => a.accuracy - b.accuracy);

    return (
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">本輪聽寫摘要</h2>
            <p className="mt-1 text-xs text-faint">
              共 {segments.length} 句，已檢查 {attempted} 句。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleRestart}>
            再練一次
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="text-lg font-semibold text-accent">{average}%</div>
            <div className="text-[10px] text-faint">平均準確率</div>
          </div>
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="text-lg font-semibold text-ok">{exact}</div>
            <div className="text-[10px] text-faint">完全正確</div>
          </div>
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="text-lg font-semibold text-ink">{attempted}</div>
            <div className="text-[10px] text-faint">已檢查句數</div>
          </div>
        </div>

        {attempted === 0 ? (
          <p className="mt-4 text-sm text-muted">
            本輪尚未檢查任何句子。可以按「再練一次」重新開始。
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-1.5">
              {summary.map((item) => (
                <div
                  key={item.segment}
                  className="flex items-center justify-between rounded-lg border border-line-soft px-3 py-2 text-xs"
                >
                  <span className="text-muted">第 {item.segment + 1} 句</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      item.accuracy >= 0.8
                        ? 'text-ok'
                        : item.accuracy >= 0.5
                          ? 'text-warn'
                          : 'text-danger',
                    )}
                  >
                    {Math.round(item.accuracy * 100)}%
                  </span>
                </div>
              ))}
            </div>
            {sorted.length > 0 ? (
              <p className="mt-3 text-[11px] leading-5 text-faint">
                最需要加強：第 {sorted[0].segment + 1} 句（
                {Math.round(sorted[0].accuracy * 100)}%）；最佳：第{' '}
                {sorted[sorted.length - 1].segment + 1} 句（
                {Math.round(sorted[sorted.length - 1].accuracy * 100)}%）。
              </p>
            ) : null}
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={handleRestart}>
            再練一次
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFinished(false);
              setSegmentIndex(0);
            }}
          >
            繼續練習
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-faint">逐句聽寫</div>
          <div className="mt-1 text-sm font-medium text-ink">
            第 {segmentIndex + 1} / {segments.length} 句
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {latestForSegment ? (
            <Badge tone="muted">
              上次 {Math.round(latestForSegment.accuracy * 100)}%
            </Badge>
          ) : null}
          <Badge tone={replayCount >= MAX_REPLAYS ? 'warn' : 'muted'}>
            播放 {replayCount} / {MAX_REPLAYS}
          </Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={segmentIndex}
          onChange={(event) => handleSelect(Number(event.target.value))}
          className="h-9 rounded-xl border border-line bg-surface px-3 text-xs text-ink"
          aria-label="選擇句子"
        >
          {segments.map((segment) => {
            const latestRecord = latestBySegment.get(segment.index);
            return (
              <option key={segment.index} value={segment.index}>
                第 {segment.index + 1} 句
                {latestRecord
                  ? ` · ${Math.round(latestRecord.accuracy * 100)}%`
                  : ''}
              </option>
            );
          })}
        </select>

        <Button
          variant="secondary"
          size="sm"
          onClick={handlePlay}
          disabled={replayCount >= MAX_REPLAYS}
        >
          播放本句
        </Button>
        <Button variant="ghost" size="sm" onClick={handleResetSegment}>
          重設本句
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrev}
          disabled={segmentIndex === 0}
        >
          上一句
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNext}
        >
          {segmentIndex + 1 >= segments.length ? '完成本輪' : '下一句'}
        </Button>
      </div>

      <div className="mt-4">
        <label className="mb-1.5 block text-xs text-muted" htmlFor="dictation-input">
          寫下你聽到的句子
        </label>
        <textarea
          id="dictation-input"
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink placeholder:text-faint focus:border-accent/60"
          placeholder="輸入你聽到的句子…（Enter 檢查、Shift+Enter 換行）"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] text-faint">
            Enter 檢查 · Shift+Enter 換行 · Alt+R 重播 · Alt+N 下一句
          </div>
          <Button onClick={() => void handleCheck()} disabled={saving}>
            {saving ? '檢查中…' : '檢查'}
          </Button>
        </div>
      </div>

      {currentScore ? (
        <div className="animate-rise mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-ink">
              準確率{' '}
              <span
                className={cn(
                  'tabular-nums',
                  currentScore.accuracy >= 0.8
                    ? 'text-ok'
                    : currentScore.accuracy >= 0.5
                      ? 'text-warn'
                      : 'text-danger',
                )}
              >
                {Math.round(currentScore.accuracy * 100)}%
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="text-ok">正確</span>
              <span className="text-danger">漏寫</span>
              <span className="text-warn">多寫</span>
              <span className="text-muted">替換</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 rounded-xl border border-line-soft bg-panel-2/30 p-3">
            {currentScore.diff.map((op, index) => {
              if (op.type === 'equal') {
                return (
                  <span
                    key={index}
                    className="rounded bg-ok/10 px-1.5 py-0.5 text-xs text-ok"
                  >
                    {op.reference}
                  </span>
                );
              }
              if (op.type === 'missing') {
                return (
                  <span
                    key={index}
                    className="rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger line-through"
                  >
                    {op.reference}
                  </span>
                );
              }
              if (op.type === 'extra') {
                return (
                  <span
                    key={index}
                    className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn line-through"
                  >
                    {op.actual}
                  </span>
                );
              }
              return (
                <span
                  key={index}
                  className="rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger"
                >
                  {op.reference} → <span className="text-warn">{op.actual}</span>
                </span>
              );
            })}
          </div>

          <div className="rounded-xl border border-line-soft bg-surface/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-faint">
              正確句子
            </div>
            <p className="mt-1 text-sm leading-6 text-ink">{reference}</p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
