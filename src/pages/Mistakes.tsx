import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type {
  MistakeRecord,
  PassageRecord,
  QuestionRecord,
} from '../db/types';
import { recordAnswer, startSession } from '../db/repo';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  SectionTitle,
} from '../components/ui';
import {
  ERROR_CAUSE_LABELS,
  HOT_TOPIC_LABELS,
  KNOWLEDGE_LABELS,
  QUESTION_TYPE_LABELS,
  labelOf,
} from '../lib/labels';
import { cn, formatDateTime } from '../lib/utils';

interface ReviewTarget {
  mistake: MistakeRecord;
  question: QuestionRecord;
  passage: PassageRecord | undefined;
}

export default function Mistakes() {
  const toast = useToast();
  const [tab, setTab] = useState<'open' | 'mastered'>('open');
  const [cause, setCause] = useState('all');
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [selected, setSelected] = useState('');
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    mastered: boolean;
    answer: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const data = useLiveQuery(async () => {
    const [mistakes, questions, passages] = await Promise.all([
      db.mistakes.toArray(),
      db.questions.toArray(),
      db.passages.toArray(),
    ]);
    const questionById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const passageById = new Map(
      passages.map((passage) => [passage.id, passage]),
    );
    const rows = mistakes
      .map((mistake) => {
        const question = questionById.get(mistake.questionId);
        if (!question) return null;
        return {
          mistake,
          question,
          passage: passageById.get(question.passageId),
        };
      })
      .filter((row): row is ReviewTarget => Boolean(row));

    const open = rows
      .filter((row) => row.mistake.status === 'open')
      .sort((a, b) => b.mistake.lastWrongAt.localeCompare(a.mistake.lastWrongAt));
    const mastered = rows
      .filter((row) => row.mistake.status === 'mastered')
      .sort((a, b) =>
        (b.mistake.lastCorrectAt ?? '').localeCompare(
          a.mistake.lastCorrectAt ?? '',
        ),
      );

    const causes = Array.from(
      new Set(open.flatMap((row) => row.mistake.errorCauseTags)),
    );

    return { open, mastered, causes };
  }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    const rows = tab === 'open' ? data.open : data.mastered;
    if (cause === 'all') return rows;
    return rows.filter((row) => row.mistake.errorCauseTags.includes(cause));
  }, [data, tab, cause]);

  const openReview = (row: ReviewTarget) => {
    setTarget(row);
    setSelected('');
    setFeedback(null);
  };

  const closeReview = () => {
    setTarget(null);
    setSelected('');
    setFeedback(null);
  };

  const submitReview = async () => {
    if (!target || !selected || submitting) return;
    setSubmitting(true);
    try {
      const sessionId = await startSession(target.mistake.examId, 'review');
      const outcome = await recordAnswer({
        sessionId,
        examId: target.mistake.examId,
        question: target.question,
        selected,
        timeSpentSec: 0,
        mode: 'review',
      });
      setFeedback({
        correct: outcome.isCorrect,
        mastered: outcome.mastered,
        answer: target.question.answer,
      });
      if (outcome.mastered) {
        toast.push('已掌握，這題從待重練移除', 'ok');
      } else if (outcome.isCorrect) {
        toast.push('答對，再答對一次即可掌握', 'ok');
      } else {
        toast.push('答錯，已更新錯題紀錄', 'error');
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '提交失敗', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在載入錯題…
      </div>
    );
  }

  const openCount = data.open.length;
  const masteredCount = data.mastered.length;

  return (
    <div>
      <SectionTitle
        eyebrow="Mistakes"
        title="錯題本"
        description="錯題會記錄考點與錯因；重練時先做原題，Phase 5 會改成同考點變式。"
        action={
          <div className="text-right text-xs leading-5 text-faint">
            <div>待重練 {openCount}</div>
            <div>已掌握 {masteredCount}</div>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-panel p-1">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs transition-colors',
              tab === 'open' ? 'bg-panel-2 text-accent' : 'text-muted hover:text-ink',
            )}
          >
            待重練 {openCount}
          </button>
          <button
            type="button"
            onClick={() => setTab('mastered')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs transition-colors',
              tab === 'mastered'
                ? 'bg-panel-2 text-accent'
                : 'text-muted hover:text-ink',
            )}
          >
            已掌握 {masteredCount}
          </button>
        </div>

        <select
          value={cause}
          onChange={(event) => setCause(event.target.value)}
          className="h-9 rounded-xl border border-line bg-panel px-3 text-xs text-muted"
          aria-label="依錯因篩選"
        >
          <option value="all">全部錯因</option>
          {data.causes.map((causeId) => (
            <option key={causeId} value={causeId}>
              {labelOf(ERROR_CAUSE_LABELS, causeId)}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={tab === 'open' ? '✓' : '◇'}
          title={tab === 'open' ? '目前沒有待重練錯題' : '還沒有已掌握的錯題'}
          description={
            tab === 'open'
              ? '答錯的題目會自動出現在這裡；每題連續答對兩次即視為掌握。'
              : '重練同一題並連續答對兩次，就會移到這裡。'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map(({ mistake, question, passage }) => (
            <Card key={question.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="danger">錯 {mistake.wrongCount} 次</Badge>
                    <Badge tone="muted">
                      {labelOf(QUESTION_TYPE_LABELS, question.type)}
                    </Badge>
                    {mistake.errorCauseTags.map((tag) => (
                      <Badge key={tag} tone="warn">
                        {labelOf(ERROR_CAUSE_LABELS, tag)}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-ink">
                    {question.stem}
                  </p>
                  {question.evidence[0]?.quote ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-faint">
                      “{question.evidence[0].quote}”
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {mistake.knowledgeTags.map((tag) => (
                      <Badge key={tag} tone="muted">
                        {labelOf(KNOWLEDGE_LABELS, tag)}
                      </Badge>
                    ))}
                    {mistake.hotTopicTags.slice(0, 2).map((tag) => (
                      <Badge key={tag} tone="violet">
                        {labelOf(HOT_TOPIC_LABELS, tag)}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-faint">
                    <span>
                      最近錯誤 {formatDateTime(mistake.lastWrongAt)}
                    </span>
                    <span>連續答對 {mistake.correctStreak} / 2</span>
                    <Link
                      to={`/practice/${question.examId}/${question.passageId}`}
                      className="hover:text-accent"
                    >
                      回到原文 →
                    </Link>
                  </div>
                </div>

                {tab === 'open' ? (
                  <Button
                    size="sm"
                    onClick={() => openReview({ mistake, question, passage })}
                  >
                    重練
                  </Button>
                ) : (
                  <Badge tone="ok">已掌握</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(target)}
        onClose={closeReview}
        title="重練錯題"
        footer={
          feedback ? (
            <Button onClick={closeReview}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeReview} disabled={submitting}>
                取消
              </Button>
              <Button
                onClick={submitReview}
                disabled={!selected || submitting}
              >
                {submitting ? '提交中…' : '提交答案'}
              </Button>
            </>
          )
        }
      >
        {target ? (
          <div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="muted">
                {labelOf(QUESTION_TYPE_LABELS, target.question.type)}
              </Badge>
              {target.mistake.errorCauseTags.map((tag) => (
                <Badge key={tag} tone="warn">
                  {labelOf(ERROR_CAUSE_LABELS, tag)}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-sm font-medium leading-6 text-ink">
              {target.question.stem}
            </p>

            {target.question.evidence[0]?.quote ? (
              <p className="mt-2 text-[11px] leading-5 text-faint">
                “{target.question.evidence[0].quote}”
              </p>
            ) : null}

            {target.question.type === 'banked_cloze' ? (
              <div className="mt-3">
                <label
                  className="mb-1.5 block text-xs text-muted"
                  htmlFor="mistake-cloze-answer"
                >
                  從詞庫選擇答案
                </label>
                <select
                  id="mistake-cloze-answer"
                  value={selected}
                  disabled={Boolean(feedback)}
                  onChange={(event) => setSelected(event.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                >
                  <option value="">請選擇</option>
                  {(target.passage?.wordBank ?? []).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.key}. {option.text}
                    </option>
                  ))}
                </select>
                {(target.passage?.wordBank ?? []).length === 0 ? (
                  <p className="mt-1 text-[11px] text-danger">
                    找不到這篇的詞庫選項，請回到原文重練。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {target.question.options?.map((option) => {
                  const isSelected = selected === option.key;
                  const showCorrect =
                    Boolean(feedback) && option.key === target.question.answer;
                  const showWrong =
                    Boolean(feedback) &&
                    isSelected &&
                    option.key !== target.question.answer;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={Boolean(feedback)}
                      onClick={() => setSelected(option.key)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        showCorrect
                          ? 'border-ok/50 bg-ok/10 text-ok'
                          : showWrong
                            ? 'border-danger/50 bg-danger/10 text-danger'
                            : isSelected
                              ? 'border-accent/50 bg-accent/10 text-ink'
                              : 'border-line-soft text-muted hover:border-line hover:text-ink',
                      )}
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px]">
                        {option.key}
                      </span>
                      <span className="leading-5">{option.text}</span>
                      {showCorrect ? (
                        <span className="ml-auto text-xs">✓</span>
                      ) : null}
                      {showWrong ? (
                        <span className="ml-auto text-xs">✕</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            {feedback ? (
              <div className="mt-4 rounded-lg border border-line-soft bg-surface/60 p-3">
                <div
                  className={cn(
                    'text-xs font-medium',
                    feedback.correct ? 'text-ok' : 'text-danger',
                  )}
                >
                  {feedback.correct
                    ? feedback.mastered
                      ? '答對！已掌握這道題'
                      : '答對！再答對一次即可掌握'
                    : `答錯 · 正確答案 ${feedback.answer}`}
                </div>
                <p className="mt-1.5 text-xs leading-6 text-muted">
                  {target.question.explanation}
                </p>
                {target.question.evidence.map((evidence, index) =>
                  evidence.quote ? (
                    <blockquote
                      key={index}
                      className="mt-2 border-l-2 border-accent/40 pl-3 text-[11px] leading-5 text-faint"
                    >
                      “{evidence.quote}”
                    </blockquote>
                  ) : null,
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
