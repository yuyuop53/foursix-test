import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import {
  getExamRecord,
  useLocalProgressRevision,
} from '../services/localProgress';
import { examLevelOf, useExamLevel } from '../services/examLevel';
import { SECTION_LABELS, HOT_TOPIC_LABELS } from '../lib/labels';
import { percent } from '../lib/utils';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  SectionTitle,
} from '../components/ui';

export default function Exams() {
  const navigate = useNavigate();
  const [level] = useExamLevel();
  useLocalProgressRevision();

  const cards = useLiveQuery(async () => {
    const [exams, passages, questions, attempts] = await Promise.all([
      db.exams.toArray(),
      db.passages.toArray(),
      db.questions.toArray(),
      db.attempts.toArray(),
    ]);

    return exams
      .filter(
        (exam) =>
          exam.sections.includes('reading') &&
          examLevelOf(exam) === level,
      )
      .map((exam) => {
        const examPassages = passages
          .filter(
            (passage) =>
              passage.examId === exam.id && passage.section === 'reading',
          )
          .sort((a, b) => a.order - b.order);
        const examQuestions = questions.filter(
          (question) =>
            question.examId === exam.id && question.section === 'reading',
        );
        const questionIds = new Set(examQuestions.map((question) => question.id));
        const attempted = new Set(
          attempts
            .filter(
              (attempt) =>
                attempt.examId === exam.id &&
                questionIds.has(attempt.questionId),
            )
            .map((attempt) => attempt.questionId),
        );
        const tags = Array.from(
          new Set(examPassages.flatMap((passage) => passage.hotTopicTags)),
        );
        return {
          exam,
          passages: examPassages,
          questionCount: examQuestions.length,
          attempted: attempted.size,
          progress:
            examQuestions.length > 0
              ? attempted.size / examQuestions.length
              : 0,
          tags,
        };
      })
      .sort(
        (a, b) =>
          b.exam.year - a.exam.year ||
          b.exam.month - a.exam.month ||
          a.exam.id.localeCompare(b.exam.id),
      );
  }, [level]);

  if (!cards) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在載入題庫…
      </div>
    );
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Reading"
        title="閱讀題庫"
        description="先把手上的內容練熟，再追求數量。每組閱讀都會記錄作答、錯題與生詞。"
        action={
          <Button variant="secondary" size="sm" onClick={() => navigate('/import')}>
            ＋ 匯入內容
          </Button>
        }
      />

      {cards.length === 0 ? (
        <EmptyState
          icon="＋"
          title="題庫是空的"
          description="把 exam.md 貼進匯入頁，或使用內建的範例文章開始。"
          action={<Button onClick={() => navigate('/import')}>前往匯入</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => {
            const record = getExamRecord(card.exam.id, 'reading');
            const attempted = record?.answeredIds.length ?? card.attempted;
            const progress =
              card.questionCount > 0 ? attempted / card.questionCount : 0;
            const accuracy = record
              ? percent(record.correctIds.length, record.answeredIds.length)
              : '—';

            return (
              <Card key={card.exam.id} className="flex flex-col p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold leading-6 text-ink">
                      {card.exam.title}
                    </h3>
                    <div className="mt-1 text-xs text-faint">
                      {card.exam.year}/{String(card.exam.month).padStart(2, '0')} ·
                      {" "}
                      {card.passages.length} 篇 · {card.questionCount} 題
                    </div>
                  </div>
                  <Badge tone={card.exam.source === 'original' ? 'violet' : 'muted'}>
                    {card.exam.source === 'original'
                      ? '原創範例'
                      : card.exam.source === 'user-entered'
                        ? '自行鍵入'
                        : card.exam.source}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {card.exam.sections.map((section) => (
                    <Badge key={section} tone="accent">
                      {SECTION_LABELS[section] ?? section}
                    </Badge>
                  ))}
                  <Badge tone={record?.completed ? 'ok' : 'muted'}>
                    {record?.completed ? '已完成' : '未完成'}
                  </Badge>
                  {card.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} tone="muted">
                      {HOT_TOPIC_LABELS[tag] ?? tag}
                    </Badge>
                  ))}
                </div>

                <div className="mt-4 flex-1">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
                    <span>
                      已作答 {attempted} / {card.questionCount} 题
                    </span>
                    <span>正确率 {accuracy}</span>
                  </div>
                  <Progress value={progress} />
                </div>

                {card.exam.sections.includes('listening') ||
                card.exam.sections.includes('translation') ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {card.exam.sections.includes('listening') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/listening')}
                      >
                        听力训练
                      </Button>
                    ) : null}
                    {card.exam.sections.includes('translation') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/translation/${card.exam.id}`)}
                      >
                        翻译练习
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-faint">
                    {card.passages[0]?.wordCount ?? 0} 詞 · 預估{' '}
                    {Math.max(5, Math.round((card.passages[0]?.wordCount ?? 0) / 30))}{' '}
                    分鐘
                  </span>
                  <Button
                    onClick={() => navigate(`/practice/${card.exam.id}`)}
                  >
                    {attempted > 0 ? '继续练习' : '开始阅读'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
