import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { PassageRecord, QuestionRecord } from '../db/types';
import {
  clearMistakes,
  getMistakes,
  useLocalProgressRevision,
} from '../services/localProgress';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionTitle,
} from '../components/ui';
import {
  HOT_TOPIC_LABELS,
  QUESTION_TYPE_LABELS,
  labelOf,
} from '../lib/labels';
import { formatDateTime } from '../lib/utils';

const MODULE_LABELS: Record<string, string> = {
  reading: '阅读',
  listening: '听力',
  translation: '翻译',
};

function answerText(
  question: QuestionRecord,
  passage: PassageRecord | undefined,
  key: string,
): string {
  if (!key) return '—';
  return (
    question.options?.find((option) => option.key === key)?.text ??
    passage?.wordBank?.find((option) => option.key === key)?.text ??
    key
  );
}

export default function MyMistakes() {
  const navigate = useNavigate();
  useLocalProgressRevision();

  const data = useLiveQuery(async () => {
    const [questions, passages, exams] = await Promise.all([
      db.questions.toArray(),
      db.passages.toArray(),
      db.exams.toArray(),
    ]);
    return {
      questionById: new Map(questions.map((question) => [question.id, question])),
      passageById: new Map(passages.map((passage) => [passage.id, passage])),
      examById: new Map(exams.map((exam) => [exam.id, exam])),
    };
  }, []);

  const mistakes = getMistakes();

  const rows = useMemo(
    () =>
      mistakes
        .map((mistake) => {
          const question = data?.questionById.get(mistake.questionId);
          if (!question) return null;
          return {
            mistake,
            question,
            passage: data?.passageById.get(mistake.passageId),
            exam: data?.examById.get(mistake.examId),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    [mistakes, data],
  );

  const handleClear = () => {
    if (mistakes.length === 0) return;
    if (!window.confirm('确定清空所有错题吗？此操作不可撤销。')) return;
    clearMistakes();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        eyebrow="Mistakes"
        title="我的错题"
        description="答错或自评需要再练的题会自动收进这里，按时间倒序排列。"
        action={
          mistakes.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={handleClear}>
              清空错题
            </Button>
          ) : undefined
        }
      />

      {!data ? (
        <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
          正在加载错题…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="✓"
          title="还没有错题"
          description="做阅读、听力或翻译时，答错或自评需要再练的内容会自动出现在这里。"
          action={<Button onClick={() => navigate('/exams')}>去阅读题库</Button>}
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ mistake, question, passage, exam }) => (
            <Card key={mistake.questionId} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] leading-5 text-faint">
                    {exam?.title ?? mistake.examId} ·{' '}
                    {passage?.title ?? mistake.passageId} ·{' '}
                    {formatDateTime(mistake.wrongAt)}
                  </div>
                  <p className="mt-1 text-sm font-medium leading-6 text-ink">
                    {question.stem}
                  </p>
                </div>
                <Badge tone="danger">错 {mistake.wrongCount} 次</Badge>
              </div>

              {mistake.module === 'translation' ? (
                <div className="mt-2 space-y-1 text-xs leading-6">
                  <p className="line-clamp-4 whitespace-pre-wrap text-danger">
                    你的译文：{mistake.selected}
                  </p>
                  <p className="text-ok">参考译文与译点见下方解析。</p>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-danger">
                    你的答案：{mistake.selected}.{' '}
                    {answerText(question, passage, mistake.selected)}
                  </span>
                  <span className="text-ok">
                    正确答案：{question.answer}.{' '}
                    {answerText(question, passage, question.answer)}
                  </span>
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="muted">
                  {MODULE_LABELS[mistake.module] ?? mistake.module}
                </Badge>
                {mistake.module !== 'translation' ? (
                  <Badge tone="muted">
                    {labelOf(QUESTION_TYPE_LABELS, question.type)}
                  </Badge>
                ) : null}
                {question.hotTopicTags.map((tag) => (
                  <Badge key={tag} tone="violet">
                    {labelOf(HOT_TOPIC_LABELS, tag)}
                  </Badge>
                ))}
              </div>

              <p className="mt-2 text-xs leading-6 text-muted">
                {question.explanation?.trim() || '暂无解析'}
              </p>

              <div className="mt-3">
                <Link
                  to={
                    mistake.module === 'listening'
                      ? `/listening/${mistake.passageId}`
                      : mistake.module === 'translation'
                        ? `/translation/${mistake.examId}`
                        : `/practice/${mistake.examId}/${mistake.passageId}`
                  }
                  className="text-xs text-accent hover:underline"
                >
                  去重练 →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
