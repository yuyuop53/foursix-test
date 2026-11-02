import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ExamRecord, PassageRecord, QuestionRecord } from '../../db/types';
import { logStudy, recordAnswer, startSession } from '../../db/repo';
import { WordModal } from '../../components/WordModal';
import {
  WordSelectionPopover,
  useWordSelection,
} from '../../components/WordSelectionPopover';
import {
  getExamRecord,
  recordExamAnswer,
  recordMistake,
  useLocalProgressRevision,
} from '../../services/localProgress';
import {
  Badge,
  Button,
  Card,
  Progress,
} from '../../components/ui';
import {
  HOT_TOPIC_LABELS,
  SECTION_LABELS,
  labelOf,
} from '../../lib/labels';
import { cn, formatDuration, percent } from '../../lib/utils';

interface BankedClozeProps {
  exam: ExamRecord;
  examId: string;
  current: PassageRecord;
  passages: PassageRecord[];
  questions: QuestionRecord[];
  examQuestionCount: number;
}

interface WordModalState {
  open: boolean;
  lemma: string;
  sentence: string;
}

const EMPTY_WORD_MODAL: WordModalState = {
  open: false,
  lemma: '',
  sentence: '',
};

export function BankedCloze({
  exam,
  examId,
  current,
  passages,
  questions,
  examQuestionCount,
}: BankedClozeProps) {
  const navigate = useNavigate();

  interface AnswerState {
    selected: string;
    correct: boolean;
  }

  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [wordModal, setWordModal] = useState<WordModalState>(EMPTY_WORD_MODAL);
  const sessionPromise = useRef<Promise<string> | null>(null);
  const passageLogged = useRef(false);

  useLocalProgressRevision();
  const examRecord = getExamRecord(examId, 'reading');
  const {
    selection: wordSelection,
    close: closeWordSelection,
    add: addWordSelection,
  } = useWordSelection({
    examId,
    passageId: current.id,
    examTitle: exam.title,
    passageTitle: current.title,
  });

  const sortedQuestions = useMemo(
    () =>
      [...questions].sort(
        (a, b) => (a.blankIndex ?? 0) - (b.blankIndex ?? 0),
      ),
    [questions],
  );

  const blankBank = current.wordBank ?? [];
  const questionByBlank = useMemo(
    () =>
      new Map(
        sortedQuestions
          .filter((question) => question.blankIndex != null)
          .map((question) => [question.blankIndex as number, question]),
      ),
    [sortedQuestions],
  );
  const bankText = useMemo(
    () =>
      new Map(
        blankBank.map((option) => [option.key, option.text]),
      ),
    [blankBank],
  );

  const answeredCount = sortedQuestions.filter(
    (question) => answers[question.id],
  ).length;
  const allAnswered =
    sortedQuestions.length > 0 && answeredCount === sortedQuestions.length;
  const correctCount = sortedQuestions.filter(
    (question) => answers[question.id]?.correct,
  ).length;
  const usedKeys = new Set(
    Object.values(answers)
      .map((answer) => answer.selected)
      .filter(Boolean),
  );

  useEffect(() => {
    setAnswers({});
    setElapsed(0);
    setStartedAt(Date.now());
    sessionPromise.current = null;
    passageLogged.current = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [current.id]);

  useEffect(() => {
    if (allAnswered) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [allAnswered, startedAt]);

  useEffect(() => {
    if (passageLogged.current) return;
    if (sortedQuestions.length === 0) return;
    if (!sortedQuestions.every((question) => answers[question.id])) return;

    passageLogged.current = true;
    void logStudy({
      questionsDone: sortedQuestions.length,
      correctCount,
      minutes: elapsed / 60,
    }).catch(() => {});
  }, [answers, sortedQuestions, correctCount, elapsed]);

  const persistAttempt = (question: QuestionRecord, selected: string) => {
    void (async () => {
      try {
        if (!sessionPromise.current) {
          sessionPromise.current = startSession(examId, 'practice');
        }
        const sessionId = await sessionPromise.current;
        await recordAnswer({
          sessionId,
          examId,
          question,
          selected,
          timeSpentSec: 0,
          mode: 'practice',
        });
      } catch {
        sessionPromise.current = null;
      }
    })();
  };

  const handleAnswer = (question: QuestionRecord, key: string) => {
    if (!key || answers[question.id]) return;
    const isCorrect = key === question.answer;

    setAnswers((previous) => ({
      ...previous,
      [question.id]: { selected: key, correct: isCorrect },
    }));
    recordExamAnswer({
      examId,
      examTitle: exam.title,
      module: 'reading',
      questionId: question.id,
      isCorrect,
      total: examQuestionCount,
    });
    if (!isCorrect) {
      recordMistake({ question, module: 'reading', selected: key });
    }
    persistAttempt(question, key);
  };

  const handleBankClick = (key: string) => {
    const target = sortedQuestions.find((question) => !answers[question.id]);
    if (target) handleAnswer(target, key);
  };

  const handleReset = () => {
    setAnswers({});
    sessionPromise.current = null;
    passageLogged.current = false;
    setElapsed(0);
    setStartedAt(Date.now());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openWord = (question: QuestionRecord) => {
    const correctWord = bankText.get(question.answer) ?? question.answer;
    setWordModal({
      open: true,
      lemma: correctWord,
      sentence: question.evidence[0]?.quote ?? '',
    });
  };

  const renderParagraph = (paragraph: string, paragraphIndex: number) => {
    const tokens = paragraph.split(/(\[\[\d+\]\])/g);
    return tokens.map((token, tokenIndex) => {
      const match = token.match(/^\[\[(\d+)\]\]$/);
      if (!match) {
        return <span key={`${paragraphIndex}-${tokenIndex}`}>{token}</span>;
      }

      const blankIndex = Number(match[1]);
      const question = questionByBlank.get(blankIndex);
      if (!question) {
        return (
          <span
            key={`${paragraphIndex}-${tokenIndex}`}
            className="mx-0.5 rounded bg-danger/20 px-1 text-danger"
            title={`第 ${blankIndex} 空沒有對應題目`}
          >
            ?
          </span>
        );
      }

      const answer = answers[question.id];
      const selected = answer?.selected ?? '';
      const isCorrect = answer?.correct ?? false;
      const isWrong = Boolean(answer) && !isCorrect;
      const selectedText = bankText.get(selected) ?? '';
      const correctText = bankText.get(question.answer) ?? question.answer;

      if (answer) {
        return (
          <span
            key={`${paragraphIndex}-${tokenIndex}`}
            className={cn(
              'mx-0.5 inline-flex min-w-[92px] flex-col items-center rounded-md border px-1.5 py-0.5 align-baseline text-xs leading-5',
              isCorrect
                ? 'border-ok/50 bg-ok/10 text-ok'
                : 'border-danger/50 bg-danger/10 text-danger',
            )}
            title={isCorrect ? '正確' : `正確答案：${correctText}`}
          >
            <span className="font-medium">
              {blankIndex}. {selectedText || '—'} {isCorrect ? '✓' : '✕'}
            </span>
            {isWrong ? (
              <span className="text-[10px] opacity-80">
                正確：{correctText}
              </span>
            ) : null}
          </span>
        );
      }

      return (
        <select
          key={`${paragraphIndex}-${tokenIndex}`}
          aria-label={`第 ${blankIndex} 空`}
          value={selected}
          onChange={(event) => handleAnswer(question, event.target.value)}
          className={cn(
            'mx-0.5 inline-block max-w-[150px] rounded-md border bg-surface px-1 py-0.5 align-baseline text-xs text-ink',
            selected
              ? 'border-accent/50 text-accent'
              : 'border-line text-faint',
          )}
        >
          <option value="">{blankIndex}. ____</option>
          {blankBank.map((option) => (
            <option
              key={option.key}
              value={option.key}
              disabled={usedKeys.has(option.key) && selected !== option.key}
            >
              {option.key}. {option.text}
            </option>
          ))}
        </select>
      );
    });
  };

  const paragraphs = current.bodyMd
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
            <Link to="/exams" className="hover:text-accent">
              閱讀題庫
            </Link>
            <span>/</span>
            <span className="text-muted">{exam.title}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {current.title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs tabular-nums text-muted">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
            {formatDuration(elapsed)}
          </div>
          <Badge tone="accent">{SECTION_LABELS[current.section]}</Badge>
          <Badge tone="violet">選詞填空</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge tone="muted">{current.wordCount} 詞</Badge>
        <Badge tone="muted">{blankBank.length} 個詞庫選項</Badge>
        {current.hotTopicTags.map((tag) => (
          <Badge key={tag} tone="violet">
            {labelOf(HOT_TOPIC_LABELS, tag)}
          </Badge>
        ))}
        {passages.length > 1 ? (
          <span className="ml-auto flex flex-wrap gap-1">
            {passages.map((passage, index) => (
              <button
                key={passage.id}
                type="button"
                onClick={() => navigate(`/practice/${examId}/${passage.id}`)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 transition-colors',
                  passage.id === current.id
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line text-muted hover:text-ink',
                )}
              >
                第 {index + 1} 篇
              </button>
            ))}
          </span>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <Card className="min-w-0 p-5 sm:p-6">
          <div className="reading-body">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{renderParagraph(paragraph, index)}</p>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          {allAnswered ? (
            <Card className="animate-rise border-accent/30 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs tracking-wide text-muted">本組結果</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums text-accent">
                      {correctCount} / {sortedQuestions.length}
                    </span>
                    <span className="text-sm text-muted">
                      {percent(correctCount, sortedQuestions.length)}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs leading-5 text-faint">
                  <div>用時 {formatDuration(elapsed)}</div>
                  <div>錯題已加入我的錯題</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  再練一次
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/my-mistakes')}
                >
                  查看我的錯題 →
                </Button>
              </div>
            </Card>
          ) : null}

          <Card className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between text-xs text-faint">
              <span>詞庫（每詞限用一次）</span>
              <span>{blankBank.length} 個</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {blankBank.map((option) => {
                const used = usedKeys.has(option.key);
                const isAnswer =
                  used && optionsUsedCorrectly(option.key, sortedQuestions, answers);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleBankClick(option.key)}
                    disabled={used}
                    className={cn(
                      'min-w-0 rounded-lg border px-2 py-1.5 text-left text-[11px] break-words transition-colors',
                      isAnswer
                        ? 'border-ok/40 bg-ok/10 text-ok'
                        : used
                          ? 'border-line-soft bg-panel-2/40 text-faint line-through'
                          : 'border-line bg-panel-2/40 text-muted hover:border-accent/40 hover:text-ink',
                      used && 'cursor-default',
                    )}
                  >
                    <span className="mr-1 text-faint">{option.key}.</span>
                    {option.text}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 mb-1.5 flex items-center justify-between text-xs text-faint">
              <span>
                已填 {answeredCount} / {sortedQuestions.length}
              </span>
              <span>{formatDuration(elapsed)}</span>
            </div>
            <Progress
              value={
                sortedQuestions.length
                  ? answeredCount / sortedQuestions.length
                  : 0
              }
            />

            {examRecord ? (
              <div className="mt-1.5 text-[11px] text-faint">
                本套题 {examRecord.completed ? '已完成' : '未完成'} · 正确率{' '}
                {percent(examRecord.correctIds.length, examRecord.answeredIds.length)}
              </div>
            ) : null}

            <div className="mt-4 space-y-1.5">
              {sortedQuestions.map((question) => {
                const answer = answers[question.id];
                const selected = answer?.selected ?? '';
                const isCorrect = answer?.correct ?? false;
                return (
                  <div
                    key={question.id}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
                      answer
                        ? isCorrect
                          ? 'border-ok/25 bg-ok/5 text-ok'
                          : 'border-danger/25 bg-danger/5 text-danger'
                        : 'border-line-soft text-muted',
                    )}
                  >
                    <span>第 {question.blankIndex} 空</span>
                    <span className="truncate">
                      {selected
                        ? `${selected}. ${bankText.get(selected) ?? ''}`
                        : '—'}
                    </span>
                    {answer ? <span>{isCorrect ? '✓' : '✕'}</span> : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-[11px] text-faint">
                {allAnswered
                  ? '本组已完成，答错题已加入我的错题。'
                  : `点击选项立即判定；还有 ${sortedQuestions.length - answeredCount} 空未填`}
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
        </div>
      </div>

      {answeredCount > 0 ? (
        <Card className="p-5">
          <div className="mb-3 text-sm font-medium text-ink">
            逐空解析（已作答 {answeredCount}）
          </div>
          <div className="space-y-2">
            {sortedQuestions
              .filter((question) => answers[question.id])
              .map((question) => {
                const answer = answers[question.id];
                if (!answer) return null;
                const selected = answer.selected;
                const isCorrect = answer.correct;
                return (
                <div
                  key={question.id}
                  className={cn(
                    'rounded-xl border p-3',
                    isCorrect
                      ? 'border-ok/25 bg-ok/[0.03]'
                      : 'border-danger/25 bg-danger/[0.03]',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="muted">第 {question.blankIndex} 空</Badge>
                    <span className={isCorrect ? 'text-ok' : 'text-danger'}>
                      {isCorrect
                        ? `正確：${bankText.get(selected) ?? selected}`
                        : `你選 ${(bankText.get(selected) ?? selected) || '—'}；正確 ${bankText.get(question.answer) ?? question.answer}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => openWord(question)}
                    >
                      ＋ 收藏生詞
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs leading-6 text-muted">
                    {question.explanation?.trim() || '暂无解析'}
                  </p>
                  {question.evidence.map((evidence, index) =>
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
                );
              })}
          </div>
        </Card>
      ) : null}

      <WordSelectionPopover
        selection={wordSelection}
        onClose={closeWordSelection}
        onAdd={addWordSelection}
      />

      <WordModal
        open={wordModal.open}
        onClose={() => setWordModal(EMPTY_WORD_MODAL)}
        initialLemma={wordModal.lemma}
        source={{
          examId,
          passageId: current.id,
          sentence: wordModal.sentence,
          hotTopicTags: current.hotTopicTags,
        }}
      />
    </div>
  );
}

function optionsUsedCorrectly(
  key: string,
  questions: QuestionRecord[],
  answers: Record<string, { selected: string; correct: boolean }>,
): boolean {
  const question = questions.find(
    (item) => answers[item.id]?.selected === key,
  );
  return Boolean(question && question.answer === key);
}
