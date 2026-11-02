import { useCallback, useEffect, useRef, useState } from 'react';
import { lookupWordDefinition } from '../services/wordLookup';
import { addLocalWord } from '../services/localWords';
import { cn } from '../lib/utils';
import { Button } from './ui';
import { useToast } from './Toast';

export interface WordSelectionContext {
  examId?: string | null;
  passageId?: string | null;
  examTitle?: string | null;
  passageTitle?: string | null;
}

export interface WordSelectionState {
  text: string;
  definition: string | null;
  phonetic: string | null;
  sentence: string;
  x: number;
  y: number;
  placement: 'above' | 'below';
  loading: boolean;
  lookupFailed: boolean;
}

export function useWordSelection(
  context: WordSelectionContext,
  enabled = true,
) {
  const toast = useToast();
  const [selection, setSelection] = useState<WordSelectionState | null>(null);
  const requestRef = useRef(0);

  const processSelection = useCallback((event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element) {
      if (
        target.closest(
          'button, input, textarea, select, a, [data-word-popover]',
        )
      ) {
        return;
      }
    }

    const nativeSelection = window.getSelection();
    const raw =
      nativeSelection?.toString().replace(/\s+/g, ' ').trim() ?? '';

    if (
      !raw ||
      raw.length > 40 ||
      (nativeSelection?.rangeCount ?? 0) === 0
    ) {
      setSelection(null);
      return;
    }

    const text = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!text) {
      setSelection(null);
      return;
    }

    const range = nativeSelection!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const block = range.startContainer.parentElement?.closest(
      'p, li, blockquote',
    );
    const sentence = (block?.textContent ?? text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    let sentenceInitial = true;
    if (block) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const before = beforeRange
        .toString()
        .replace(/\s+/g, ' ')
        .replace(/^["'“”‘’()\s]+/, '')
        .trim();
      sentenceInitial =
        before === '' || /[.!?]["'”’)]?\s*$/.test(before);
    }

    const placement: 'above' | 'below' = rect.top < 140 ? 'below' : 'above';
    const center = rect.left + rect.width / 2;

    // Show the popover immediately, then fill in the definition. This keeps
    // selection usable even if the local dictionary lookup is slow or fails.
    setSelection({
      text,
      definition: null,
      phonetic: null,
      sentence,
      x: Math.min(window.innerWidth - 150, Math.max(150, center)),
      y: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      placement,
      loading: true,
      lookupFailed: false,
    });

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    void lookupWordDefinition(text, { sentenceInitial })
      .then((lookup) => {
        if (requestRef.current !== requestId) return;
        setSelection((previous) =>
          previous
            ? {
                ...previous,
                definition: lookup?.definition ?? null,
                phonetic: lookup?.phonetic ?? null,
                loading: false,
                lookupFailed: false,
              }
            : previous,
        );
      })
      .catch(() => {
        if (requestRef.current !== requestId) return;
        setSelection((previous) =>
          previous
            ? { ...previous, loading: false, lookupFailed: true }
            : previous,
        );
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onMouseUp = (event: MouseEvent) => {
      processSelection(event);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [enabled, processSelection]);

  const close = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const add = useCallback(() => {
    if (!selection) return;
    addLocalWord({
      word: selection.text,
      definition: selection.definition,
      sentence: selection.sentence,
      examId: context.examId,
      passageId: context.passageId,
      examTitle: context.examTitle,
      passageTitle: context.passageTitle,
    });
    toast.push('已加入生词本', 'ok');
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, [context, selection, toast]);

  return { selection, close, add };
}

export function WordSelectionPopover({
  selection,
  onClose,
  onAdd,
}: {
  selection: WordSelectionState | null;
  onClose: () => void;
  onAdd: () => void;
}) {
  if (!selection) return null;

  const definitionText = selection.loading
    ? '查询中…'
    : selection.lookupFailed
      ? '本地词典加载失败，请手动校对'
      : selection.definition || '暂无本地释义，请手动校对';

  return (
    <>
      <div className="fixed inset-0 z-20" onMouseDown={onClose} />
      <div
        data-word-popover
        style={{ left: selection.x, top: selection.y }}
        className={cn(
          'fixed z-30 w-64 -translate-x-1/2 rounded-xl border border-line bg-panel p-3 shadow-2xl',
          selection.placement === 'above' && '-translate-y-full',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-ink">
            {selection.text}
          </span>
          {selection.phonetic ? (
            <span className="shrink-0 text-[10px] text-faint">
              {selection.phonetic}
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            'mt-1 text-xs leading-5',
            selection.loading ? 'text-faint' : 'text-muted',
          )}
        >
          {definitionText}
        </p>
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={onAdd}>
            加入生词本
          </Button>
        </div>
      </div>
    </>
  );
}
