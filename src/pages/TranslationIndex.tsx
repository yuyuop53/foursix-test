import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import {
  getExamRecord,
  useLocalProgressRevision,
} from '../services/localProgress';
import { examLevelOf, useExamLevel } from '../services/examLevel';
import { Badge, Card, EmptyState, SectionTitle } from '../components/ui';
import { percent } from '../lib/utils';

export default function TranslationIndex() {
  useLocalProgressRevision();
  const [level] = useExamLevel();

  const data = useLiveQuery(async () => {
    const [exams, passages] = await Promise.all([
      db.exams.toArray(),
      db.passages.toArray(),
    ]);

    return exams
      .filter(
        (exam) =>
          exam.sections.includes('translation') &&
          examLevelOf(exam) === level,
      )
      .map((exam) => {
        const passage = passages.find(
          (item) =>
            item.examId === exam.id && item.section === 'translation',
        );
        const paragraphs = passage?.bodyMd
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean) ?? [];
        const source =
          paragraphs[0]?.startsWith('Translate the following passage')
            ? paragraphs.slice(1)
            : paragraphs;
        return { exam, passage, source };
      })
      .sort(
        (a, b) =>
          b.exam.year - a.exam.year ||
          b.exam.month - a.exam.month ||
          a.exam.id.localeCompare(b.exam.id),
      );
  }, [level]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在加载翻译题库…
      </div>
    );
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Translation"
        title="翻译题库"
        description="先独立翻译，提交后用本地规则批改，并对照参考译文与译点提示。"
      />

      {data.length === 0 ? (
        <EmptyState
          icon="◇"
          title="还没有翻译内容"
          description="在 content/exams 中加入含 translation 板块的 exam.md。"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map(({ exam, passage, source }) => {
            const record = getExamRecord(exam.id, 'translation');
            return (
              <Card key={exam.id} className="flex flex-col p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold leading-6 text-ink">
                      {exam.title}
                    </h3>
                    <div className="mt-1 text-xs text-faint">
                      {exam.year}/{String(exam.month).padStart(2, '0')} · 1 篇
                    </div>
                  </div>
                  <Badge tone="accent">翻译</Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <Badge tone={record?.completed ? 'ok' : 'muted'}>
                    {record?.completed ? '已完成' : '未完成'}
                  </Badge>
                  <span>
                    批改正确率{' '}
                    {record
                      ? percent(
                          record.correctIds.length,
                          record.answeredIds.length,
                        )
                      : '—'}
                  </span>
                </div>

                <p className="mt-3 line-clamp-4 flex-1 text-[11px] leading-5 text-faint">
                  {source.join(' ') || passage?.title || '内容缺失'}
                </p>

                <div className="mt-4 flex justify-end">
                  <Link
                    to={`/translation/${exam.id}`}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-surface hover:bg-accent/90"
                  >
                    {record?.answeredIds.length ? '继续练习' : '开始翻译'}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
