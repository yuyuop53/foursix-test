import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import {
  getExamRecord,
  recordExamAnswer,
  recordMistake,
  useLocalProgressRevision,
} from '../services/localProgress';
import {
  extractReference,
  gradeTranslation,
  type TranslationGrade,
} from '../services/translationGrader';
import { Badge, Button, Card, EmptyState, Progress } from '../components/ui';

export default function TranslationPractice() {
  const { examId = '' } = useParams();
  const navigate = useNavigate();
  useLocalProgressRevision();

  const data = useLiveQuery(async () => {
    const exam = await db.exams.get(examId);
    if (!exam) return { exam: null, passage: null, question: null };
    const passages = await db.passages
      .where('examId')
      .equals(examId)
      .sortBy('order');
    const passage =
      passages.find((item) => item.section === 'translation') ?? passages[0];
    if (!passage) return { exam, passage: null, question: null };
    const questions = await db.questions
      .where('passageId')
      .equals(passage.id)
      .sortBy('id');
    const question =
      questions.find((item) => item.type === 'translation') ?? questions[0];
    return { exam, passage, question: question ?? null };
  }, [examId]);

  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [grade, setGrade] = useState<TranslationGrade | null>(null);

  useEffect(() => {
    setText('');
    setSubmitted(false);
    setGrade(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [examId]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在加载翻译内容…
      </div>
    );
  }

  if (!data.exam || !data.passage || !data.question) {
    return (
      <EmptyState
        icon="?"
        title="找不到这组翻译"
        description="内容可能已被删除，或尚未导入。"
        action={<Button onClick={() => navigate('/translation')}>回翻译题库</Button>}
      />
    );
  }

  const { exam, passage, question } = data;
  const paragraphs = passage.bodyMd
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const source =
    paragraphs[0]?.startsWith('Translate the following passage')
      ? paragraphs.slice(1)
      : paragraphs;
  const wordCount =
    text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0;
  const examRecord = getExamRecord(exam.id, 'translation');

  const submit = () => {
    if (!text.trim()) return;
    const reference = extractReference(question.explanation);
    const result = gradeTranslation(text, reference);
    setGrade(result);
    setSubmitted(true);

    recordExamAnswer({
      examId: exam.id,
      examTitle: exam.title,
      module: 'translation',
      questionId: question.id,
      isCorrect: result.isPass,
      total: 1,
    });
    if (!result.isPass) {
      recordMistake({
        question,
        module: 'translation',
        selected: text.trim(),
      });
    }
  };

  const reset = () => {
    setText('');
    setSubmitted(false);
    setGrade(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
            <Link to="/translation" className="hover:text-accent">
              翻译题库
            </Link>
            <span>/</span>
            <span className="text-muted">{exam.title}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {passage.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">翻译</Badge>
          {examRecord ? (
            <Badge tone={examRecord.completed ? 'ok' : 'muted'}>
              {examRecord.completed ? '已完成' : '未完成'}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <Card className="min-w-0 p-5 sm:p-6">
          <div className="mb-3 text-xs font-medium tracking-wide text-muted">
            原文
          </div>
          <div className="reading-body">
            {source.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <Card className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between text-xs text-faint">
              <span>你的译文</span>
              <span>{wordCount} words</span>
            </div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={submitted}
              rows={9}
              placeholder="在这里写下你的英文翻译…"
              className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-80"
            />
            <p className="mt-2 text-[11px] leading-5 text-faint">
              提交后会使用本地规则批改（关键词覆盖 + 句子结构），仅供参考。
            </p>
            <div className="mt-3 flex justify-end">
              {submitted ? (
                <Button variant="ghost" size="sm" onClick={reset}>
                  再练一次
                </Button>
              ) : (
                <Button onClick={submit} disabled={!text.trim()}>
                  提交批改
                </Button>
              )}
            </div>
          </Card>

          {submitted && grade ? (
            <Card className="animate-rise border-accent/30 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted">本地批改结果</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-3xl font-semibold tracking-tight text-ink">
                      {grade.total} / 15
                    </span>
                    <Badge tone={grade.isPass ? 'ok' : 'danger'}>
                      {grade.band}
                    </Badge>
                  </div>
                </div>
                <Badge tone="muted">本地规则 · 仅供参考</Badge>
              </div>

              <div className="mt-4 space-y-2">
                {grade.dimensions.map((dimension) => (
                  <div key={dimension.key}>
                    <div className="flex items-center justify-between text-[11px] text-faint">
                      <span>{dimension.label}</span>
                      <span>{dimension.score} / 5</span>
                    </div>
                    <Progress className="mt-1" value={dimension.score / 5} />
                  </div>
                ))}
              </div>

              <div className="mt-4 text-[11px] leading-5 text-faint">
                关键词命中 {grade.keywordMatched.length} /{' '}
                {grade.keywordTotal} · 你写了 {grade.wordCount} 词 / 参考{' '}
                {grade.referenceWordCount} 词 · 句子 {grade.sentenceCount} /{' '}
                {grade.referenceSentenceCount}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {grade.keywordMatched.slice(0, 8).map((keyword) => (
                  <Badge key={`matched-${keyword}`} tone="ok">
                    {keyword}
                  </Badge>
                ))}
                {grade.keywordMissing.slice(0, 8).map((keyword) => (
                  <Badge key={`missing-${keyword}`} tone="danger">
                    {keyword}
                  </Badge>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-faint">
                绿色为已覆盖关键词，红色为建议补上
              </div>

              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium text-ink">
                  修改建议
                </div>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-6 text-muted">
                  {grade.suggestions.map((suggestion, index) => (
                    <li key={index}>{suggestion}</li>
                  ))}
                </ul>
              </div>

              {!grade.isPass ? (
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/my-mistakes')}
                  >
                    查看我的错题 →
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {submitted ? (
            <Card className="p-5">
              <div className="mb-2 text-sm font-medium text-ink">
                参考译文与译点
              </div>
              <div className="whitespace-pre-wrap text-xs leading-6 text-muted">
                {question.explanation?.trim() || '暂无解析'}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-faint">
                本地批改为规则估算，最终请以参考译文和人工判断为准。
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
