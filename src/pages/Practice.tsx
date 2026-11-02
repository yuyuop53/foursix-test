import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import type { QuestionRecord } from '../db/types';
import { logStudy, recordAnswer, startSession } from '../db/repo';
import { WordModal } from '../components/WordModal';
import {
  WordSelectionPopover,
  useWordSelection,
} from '../components/WordSelectionPopover';
import { BankedCloze } from '../features/reading/BankedCloze';
import {
  getExamRecord,
  recordExamAnswer,
  recordMistake,
  useLocalProgressRevision,
} from '../services/localProgress';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
} from '../components/ui';
import {
  ACCENT_LABELS,
  HOT_TOPIC_LABELS,
  KNOWLEDGE_LABELS,
  QUESTION_TYPE_LABELS,
  SECTION_LABELS,
  labelOf,
} from '../lib/labels';
import { cn, formatDuration, percent } from '../lib/utils';

interface WordModalState {
  open: boolean;
  lemma: string;
  sentence: string;
  question?: QuestionRecord;
}

const EMPTY_WORD_MODAL: WordModalState = {
  open: false,
  lemma: '',
  sentence: '',
};

export default function Practice() {
  const { examId = '', passageId } = useParams();
  const navigate = useNavigate();

  const data = useLiveQuery(async () => {
    const exam = await db.exams.get(examId);
    if (!exam) {
      return {
        exam: null,
        passages: [],
        current: null,
        questions: [],
        examQuestionCount: 0,
      };
    }

    const allPassages = await db.passages
      .where('examId')
      .equals(examId)
      .sortBy('order');
    const passages = allPassages.filter(
      (passage) => passage.section === 'reading',
    );
    const current = passageId
      ? (passages.find((passage) => passage.id === passageId) ?? passages[0])
      : passages[0];

    const [questions, examQuestions] = await Promise.all([
      current
        ? db.questions.where('passageId').equals(current.id).sortBy('id')
        : Promise.resolve([]),
      db.questions.where('examId').equals(examId).toArray(),
    ]);

    return {
      exam,
      passages,
      current: current ?? null,
      questions,
      examQuestionCount: examQuestions.filter(
        (question) => question.section === 'reading',
      ).length,
    };
  }, [examId, passageId]);

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
  const {
    selection: wordSelection,
    close: closeWordSelection,
    add: addWordSelection,
  } = useWordSelection(
    {
      examId,
      passageId: data?.current?.id ?? null,
      examTitle: data?.exam?.title ?? null,
      passageTitle: data?.current?.title ?? null,
    },
    data?.current?.subtype !== 'banked_cloze',
  );

  const currentId = data?.current?.id;
  const currentQuestions = data?.questions ?? [];
  const answeredCount = currentQuestions.filter(
    (question) => answers[question.id],
  ).length;
  const allAnswered =
    currentQuestions.length > 0 && answeredCount === currentQuestions.length;
  const correctCount = currentQuestions.filter(
    (question) => answers[question.id]?.correct,
  ).length;

  useEffect(() => {
    setAnswers({});
    setElapsed(0);
    setStartedAt(Date.now());
    closeWordSelection();
    sessionPromise.current = null;
    passageLogged.current = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentId, closeWordSelection]);

  useEffect(() => {
    if (allAnswered) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [allAnswered, startedAt]);

  useEffect(() => {
    if (passageLogged.current) return;
    if (currentQuestions.length === 0) return;
    if (!currentQuestions.every((question) => answers[question.id])) return;

    passageLogged.current = true;
    void logStudy({
      questionsDone: currentQuestions.length,
      correctCount,
      minutes: elapsed / 60,
    }).catch(() => {});
  }, [answers, currentQuestions, correctCount, elapsed]);

  const paragraphs = useMemo(() => {
    if (!data?.current) return [];
    return data.current.bodyMd
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }, [data?.current]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在載入文章…
      </div>
    );
  }

  if (!data.exam) {
    return (
      <EmptyState
        icon="?"
        title="找不到這組題目"
        description="題目可能已被刪除，或內容尚未匯入。"
        action={<Button onClick={() => navigate('/exams')}>回到題庫</Button>}
      />
    );
  }

  if (!data.current) {
    return (
      <EmptyState
        icon="◇"
        title="這組題目還沒有文章"
        description="請先在匯入頁加入內容。"
        action={<Button onClick={() => navigate('/import')}>前往匯入</Button>}
      />
    );
  }

  const { exam, passages, current, questions, examQuestionCount } = data;
  const examRecord = getExamRecord(examId, 'reading');

  if (current.subtype === 'banked_cloze') {
    return (
      <BankedCloze
        exam={exam}
        examId={examId}
        current={current}
        passages={passages}
        questions={questions}
        examQuestionCount={examQuestionCount}
      />
    );
  }

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
    if (answers[question.id]) return;
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

  const handleReset = () => {
    setAnswers({});
    sessionPromise.current = null;
    passageLogged.current = false;
    setElapsed(0);
    setStartedAt(Date.now());
    closeWordSelection();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openWordForQuestion = (question: QuestionRecord) => {
    setWordModal({
      open: true,
      lemma: '',
      sentence: question.evidence[0]?.quote ?? '',
      question,
    });
  };

  const sourceQuestion = wordModal.question;

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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge tone="muted">{current.wordCount} 詞</Badge>
        {current.hotTopicTags.map((tag) => (
          <Badge key={tag} tone="violet">
            {labelOf(HOT_TOPIC_LABELS, tag)}
          </Badge>
        ))}
        {current.accent ? (
          <Badge tone="muted">
            {labelOf(ACCENT_LABELS, current.accent)}
            {current.wpm ? ` · ${current.wpm} wpm` : ''}
          </Badge>
        ) : null}
        {passages.length > 1 ? (
          <span className="ml-auto flex flex-wrap gap-1">
            {passages.map((passage, index) => (
              <button
                key={passage.id}
                type="button"
                onClick={() =>
                  navigate(`/practice/${examId}/${passage.id}`)
                }
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
          <div
            className="reading-body"
          >
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-line-soft bg-panel-2/50 px-3 py-2 text-[11px] leading-5 text-faint">
            選取文中單詞或片語，即可加入生詞本；作答後每題下方也能收藏。
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
                      {correctCount} / {questions.length}
                    </span>
                    <span className="text-sm text-muted">
                      {percent(correctCount, questions.length)}
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
            <div className="mb-3 flex items-center justify-between text-xs text-faint">
              <span>
                已作答 {answeredCount} / {questions.length}
              </span>
              <span>{formatDuration(elapsed)}</span>
            </div>
            <Progress value={questions.length ? answeredCount / questions.length : 0} />
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
                      'rounded-xl border p-4 transition-colors',
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
                            <span
                              className={cn(
                                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                                showCorrect
                                  ? 'border-ok/60'
                                  : showWrong
                                    ? 'border-danger/60'
                                    : isSelected
                                      ? 'border-accent/60 text-accent'
                                      : 'border-line',
                              )}
                            >
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
                            ? '答對'
                            : `答錯 · 正確答案 ${question.answer}`}
                        </div>
                        <p className="mt-1.5 text-xs leading-6 text-muted break-words">
                          {question.explanation?.trim() || '暂无解析'}
                        </p>
                        {question.evidence.map((evidence, evidenceIndex) =>
                          evidence.quote ? (
                            <blockquote
                              key={evidenceIndex}
                              className="mt-2 border-l-2 border-accent/40 pl-3 text-[11px] leading-5 text-faint break-words"
                            >
                              “{evidence.quote}”
                            </blockquote>
                          ) : null,
                        )}
                        <div className="mt-2 flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openWordForQuestion(question)}
                          >
                            ＋ 收藏生詞
                          </Button>
                        </div>
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
        </div>
      </div>

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
          questionId: sourceQuestion?.id,
          examId,
          passageId: current.id,
          sentence: wordModal.sentence,
          hotTopicTags: sourceQuestion?.hotTopicTags ?? current.hotTopicTags,
        }}
      />
    </div>
  );
}
