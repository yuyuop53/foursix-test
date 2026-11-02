import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  AssetRecord,
  ExamRecord,
  PassageRecord,
  QuestionRecord,
} from '../../db/types';
import { logStudy, recordAnswer, startSession } from '../../db/repo';
import { useAudioEngine } from '../../components/audio/useAudioEngine';
import { AudioPlayer } from '../../components/audio/Player';
import { DictationPanel } from './DictationPanel';
import {
  getExamRecord,
  recordExamAnswer,
  recordMistake,
  useLocalProgressRevision,
} from '../../services/localProgress';
import { Badge, Button, Card, Progress } from '../../components/ui';
import {
  ACCENT_LABELS,
  HOT_TOPIC_LABELS,
  KNOWLEDGE_LABELS,
  QUESTION_TYPE_LABELS,
  labelOf,
} from '../../lib/labels';
import { cn, percent } from '../../lib/utils';

interface ListeningSessionProps {
  exam: ExamRecord;
  passage: PassageRecord;
  asset: AssetRecord;
  questions: QuestionRecord[];
  examQuestionCount: number;
  prevPassage?: PassageRecord | null;
  nextPassage?: PassageRecord | null;
}

export function ListeningSession({
  exam,
  passage,
  asset,
  questions,
  examQuestionCount,
  prevPassage = null,
  nextPassage = null,
}: ListeningSessionProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const engine = useAudioEngine(asset, passage);
  const segments = engine.segments;
  const mode = params.get('mode') === 'dictation' ? 'dictation' : 'quiz';

  interface AnswerState {
    selected: string;
    correct: boolean;
  }

  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const sessionPromise = useRef<Promise<string> | null>(null);
  const passageLogged = useRef(false);

  useLocalProgressRevision();
  const examRecord = getExamRecord(exam.id, 'listening');

  const answeredCount = questions.filter(
    (question) => answers[question.id],
  ).length;
  const allAnswered =
    questions.length > 0 && answeredCount === questions.length;
  const correctCount = questions.filter(
    (question) => answers[question.id]?.correct,
  ).length;

  useEffect(() => {
    if (passageLogged.current) return;
    if (questions.length === 0) return;
    if (!questions.every((question) => answers[question.id])) return;

    passageLogged.current = true;
    void logStudy({
      questionsDone: questions.length,
      correctCount,
    }).catch(() => {});
  }, [answers, questions, correctCount]);

  const persistAttempt = (question: QuestionRecord, selected: string) => {
    void (async () => {
      try {
        if (!sessionPromise.current) {
          sessionPromise.current = startSession(exam.id, 'practice');
        }
        const sessionId = await sessionPromise.current;
        await recordAnswer({
          sessionId,
          examId: exam.id,
          question,
          selected,
          mode: 'practice',
        });
      } catch {
        sessionPromise.current = null;
      }
    })();
  };

  const handleAnswer = (question: QuestionRecord, key: string) => {
    if (answers[question.id]) return;
    const isCorrect = key === question.answer;

    setAnswers((previous) => ({
      ...previous,
      [question.id]: { selected: key, correct: isCorrect },
    }));
    recordExamAnswer({
      examId: exam.id,
      examTitle: exam.title,
      module: 'listening',
      questionId: question.id,
      isCorrect,
      total: examQuestionCount,
    });
    if (!isCorrect) {
      recordMistake({ question, module: 'listening', selected: key });
    }
    persistAttempt(question, key);
  };

  const handleReset = () => {
    setAnswers({});
    sessionPromise.current = null;
    passageLogged.current = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const evidenceText = (question: QuestionRecord): string | null => {
    const evidence = question.evidence[0];
    if (!evidence) return null;
    if (evidence.segment !== undefined) {
      return segments[evidence.segment]?.text ?? null;
    }
    return evidence.quote ?? null;
  };

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
            <Link to="/listening" className="hover:text-accent">
              聽力題庫
            </Link>
            <span>/</span>
            <span className="text-muted">{exam.title}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {passage.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {passage.accent ? (
            <Badge tone="muted">
              {labelOf(ACCENT_LABELS, passage.accent)}
            </Badge>
          ) : null}
          {passage.wpm ? (
            <Badge tone="muted">{passage.wpm} wpm</Badge>
          ) : null}
          {asset.synthetic ? <Badge tone="warn">非原聲</Badge> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft bg-panel-2/30 px-3 py-2 text-xs">
        <span className="text-faint">同一套聽力</span>
        <div className="flex flex-wrap items-center gap-2">
          {prevPassage ? (
            <Link
              to={`/listening/${prevPassage.id}`}
              className="rounded-lg border border-line px-2.5 py-1 text-muted transition-colors hover:text-ink"
            >
              ← 上一段
            </Link>
          ) : (
            <span className="text-faint">已是第一段</span>
          )}
          {nextPassage ? (
            <Link
              to={`/listening/${nextPassage.id}`}
              className="rounded-lg border border-line px-2.5 py-1 text-muted transition-colors hover:text-ink"
            >
              下一段 →
            </Link>
          ) : (
            <span className="text-faint">已是最後一段</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="accent">聽力</Badge>
        {passage.hotTopicTags.map((tag) => (
          <Badge key={tag} tone="violet">
            {labelOf(HOT_TOPIC_LABELS, tag)}
          </Badge>
        ))}
      </div>

      <div className="flex w-fit rounded-xl border border-line bg-panel p-1">
        <button
          type="button"
          onClick={() => setParams({})}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs transition-colors',
            mode === 'quiz'
              ? 'bg-panel-2 text-accent'
              : 'text-muted hover:text-ink',
          )}
        >
          測驗
        </button>
        <button
          type="button"
          onClick={() => setParams({ mode: 'dictation' })}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs transition-colors',
            mode === 'dictation'
              ? 'bg-panel-2 text-accent'
              : 'text-muted hover:text-ink',
          )}
        >
          聽寫
        </button>
      </div>

      <AudioPlayer
        engine={engine}
        asset={asset}
        hideTranscript={mode === 'dictation'}
      />

      {mode === 'quiz' ? (
        <Card className="p-5">
          {allAnswered ? (
          <div className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted">本組結果</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-accent">
                    {correctCount} / {questions.length}
                  </span>
                  <span className="text-sm text-muted">
                    {percent(correctCount, questions.length)}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  再练一次
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/my-mistakes')}
                >
                  查看我的错题 →
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mb-3 flex items-center justify-between text-xs text-faint">
          <span>
            已作答 {answeredCount} / {questions.length}
          </span>
          <span>{allAnswered ? `答对 ${correctCount}` : '听完后作答'}</span>
        </div>
        <Progress
          value={questions.length ? answeredCount / questions.length : 0}
        />
        {examRecord ? (
          <div className="mt-1.5 text-[11px] text-faint">
            本套题 {examRecord.completed ? '已完成' : '未完成'} · 正确率{' '}
            {percent(examRecord.correctIds.length, examRecord.answeredIds.length)}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {questions.map((question, index) => {
            const answer = answers[question.id];
            const isCorrect = answer?.correct ?? false;

            return (
              <div
                key={question.id}
                className={cn(
                  'rounded-xl border p-4',
                  answer
                    ? isCorrect
                      ? 'border-ok/25 bg-ok/[0.03]'
                      : 'border-danger/25 bg-danger/[0.03]'
                    : 'border-line bg-panel-2/35',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="question-text text-sm font-medium leading-6 text-ink break-words">
                      {question.stem}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="muted">
                        {labelOf(QUESTION_TYPE_LABELS, question.type)}
                      </Badge>
                      {question.knowledgeTags.map((tag) => (
                        <Badge key={tag} tone="muted">
                          {labelOf(KNOWLEDGE_LABELS, tag)}
                        </Badge>
                      ))}
                      <Badge tone="muted">難度 {question.difficulty}</Badge>
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {question.options?.map((option) => {
                    const isSelected = answer?.selected === option.key;
                    const showCorrect =
                      Boolean(answer) && option.key === question.answer;
                    const showWrong =
                      Boolean(answer) &&
                      isSelected &&
                      option.key !== question.answer;

                    return (
                      <button
                        key={option.key}
                        type="button"
                        disabled={Boolean(answer)}
                        onClick={() => handleAnswer(question, option.key)}
                        className={cn(
                          'flex w-full min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                          showCorrect
                            ? 'border-ok/50 bg-ok/10 text-ok'
                            : showWrong
                              ? 'border-danger/50 bg-danger/10 text-danger'
                              : isSelected
                                ? 'border-accent/50 bg-accent/10 text-ink'
                                : 'border-line-soft text-muted hover:border-line hover:text-ink',
                          answer && 'cursor-default',
                        )}
                      >
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px]">
                          {option.key}
                        </span>
                        <span className="option-text min-w-0 flex-1 break-words leading-5">
                          {option.text}
                        </span>
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

                {answer ? (
                  <div className="mt-3 rounded-lg border border-line-soft bg-surface/60 p-3">
                    <div
                      className={cn(
                        'text-xs font-medium',
                        isCorrect ? 'text-ok' : 'text-danger',
                      )}
                    >
                      {isCorrect
                        ? '答对'
                        : `答错 · 正确答案 ${question.answer}`}
                    </div>
                    <p className="mt-1.5 text-xs leading-6 text-muted break-words">
                      {question.explanation?.trim() || '暂无解析'}
                    </p>
                    {evidenceText(question) ? (
                      <blockquote className="mt-2 border-l-2 border-accent/40 pl-3 text-[11px] leading-5 text-faint">
                        “{evidenceText(question)}”
                      </blockquote>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-[11px] text-faint">
            {allAnswered
              ? '本组已完成，答错题已加入我的错题。'
              : `点击选项立即判定；还有 ${questions.length - answeredCount} 题未作答`}
          </div>
          {allAnswered ? (
            <Button variant="secondary" size="sm" onClick={handleReset}>
              再练一次
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              重做本组
            </Button>
          )}
        </div>
        </Card>
      ) : (
        <DictationPanel
          engine={engine}
          passage={passage}
          examId={exam.id}
        />
      )}
    </div>
  );
}
