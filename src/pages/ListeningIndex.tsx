import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import {
  getExamRecord,
  useLocalProgressRevision,
} from '../services/localProgress';
import { examLevelOf, useExamLevel } from '../services/examLevel';
import {
  EmptyState,
  Badge,
  Card,
  Progress,
  SectionTitle,
} from '../components/ui';
import { ACCENT_LABELS, HOT_TOPIC_LABELS, labelOf } from '../lib/labels';
import { percent } from '../lib/utils';

export default function ListeningIndex() {
  useLocalProgressRevision();
  const [level] = useExamLevel();

  const data = useLiveQuery(async () => {
    const [passages, exams, assets, questions] = await Promise.all([
      db.passages.toArray(),
      db.exams.toArray(),
      db.assets.toArray(),
      db.questions.toArray(),
    ]);
    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const questionIdsByPassage = new Map<string, string[]>();
    const questionCountByExam = new Map<string, number>();
    for (const question of questions) {
      const ids = questionIdsByPassage.get(question.passageId) ?? [];
      ids.push(question.id);
      questionIdsByPassage.set(question.passageId, ids);
      if (question.section === 'listening') {
        questionCountByExam.set(
          question.examId,
          (questionCountByExam.get(question.examId) ?? 0) + 1,
        );
      }
    }

    const groups = new Map<
      string,
      {
        exam: (typeof exams)[number];
        passages: {
          passage: (typeof passages)[number];
          asset: (typeof assets)[number] | undefined;
          questionIds: string[];
        }[];
        questionCount: number;
      }
    >();

    for (const passage of passages) {
      if (passage.section !== 'listening') continue;
      const exam = examById.get(passage.examId);
      if (!exam || examLevelOf(exam) !== level) continue;
      const group = groups.get(exam.id) ?? {
        exam,
        passages: [],
        questionCount: questionCountByExam.get(exam.id) ?? 0,
      };
      group.passages.push({
        passage,
        asset: passage.audioAssetId
          ? assetById.get(passage.audioAssetId)
          : undefined,
        questionIds: questionIdsByPassage.get(passage.id) ?? [],
      });
      groups.set(exam.id, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        passages: group.passages.sort(
          (a, b) => a.passage.order - b.passage.order,
        ),
      }))
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
        正在載入聽力題庫…
      </div>
    );
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Listening"
        title="聽力題庫"
        description="以套題為單位訓練：先選一套，再按 Part 順序完成全部聽力。TTS 為訓練替代，非官方原聲。"
      />

      {data.length === 0 ? (
        <EmptyState
          icon="◇"
          title="這個級別還沒有聽力內容"
          description="切換到另一個級別，或在 content/exams 加入含 listening 板塊的試卷。"
        />
      ) : (
        <div className="grid gap-4">
          {data.map(({ exam, passages, questionCount }) => {
            const record = getExamRecord(exam.id, 'listening');
            const answered = record?.answeredIds.length ?? 0;
            const correct = record?.correctIds.length ?? 0;
            const firstPassage = passages[0]?.passage;
            const hasTts = passages.some(
              (item) => item.asset?.backend === 'tts',
            );
            const hasFile = passages.some(
              (item) =>
                item.asset?.backend === 'local' ||
                item.asset?.backend === 'url',
            );

            return (
              <Card key={exam.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold leading-6 text-ink">
                      {exam.title}
                    </h3>
                    <div className="mt-1 text-xs text-faint">
                      {exam.year}/{String(exam.month).padStart(2, '0')} ·{' '}
                      {passages.length} 段 · {questionCount} 題
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hasTts ? <Badge tone="warn">TTS</Badge> : null}
                    {hasFile ? <Badge tone="accent">音頻檔</Badge> : null}
                    <Badge tone={record?.completed ? 'ok' : 'muted'}>
                      {record?.completed ? '已完成' : '未完成'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
                    <span>
                      已答 {answered} / {questionCount} 題
                    </span>
                    <span>
                      正確率 {record ? percent(correct, answered) : '—'}
                    </span>
                  </div>
                  <Progress
                    value={questionCount > 0 ? answered / questionCount : 0}
                  />
                </div>

                <div className="mt-4 divide-y divide-line-soft rounded-xl border border-line-soft">
                  {passages.map(({ passage, asset, questionIds }, index) => {
                    const answeredInPassage = record
                      ? questionIds.filter((id) =>
                          record.answeredIds.includes(id),
                        ).length
                      : 0;
                    return (
                      <div
                        key={passage.id}
                        className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink">
                            {passage.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-faint">
                            <span>{questionIds.length} 題</span>
                            <span>
                              已答 {answeredInPassage} / {questionIds.length}
                            </span>
                            {passage.wpm ? <span>{passage.wpm} wpm</span> : null}
                            {passage.accent
                              ? labelOf(ACCENT_LABELS, passage.accent)
                              : null}
                          </div>
                        </div>
                        {asset?.synthetic ? (
                          <Badge tone="warn">合成</Badge>
                        ) : null}
                        <Link
                          to={`/listening/${passage.id}`}
                          className="inline-flex h-8 items-center justify-center rounded-lg border border-line bg-panel-2 px-3 text-xs text-ink transition-colors hover:border-accent/50 hover:text-accent"
                        >
                          開始
                        </Link>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {passages
                      .flatMap((item) => item.passage.hotTopicTags)
                      .filter((tag, index, all) => all.indexOf(tag) === index)
                      .slice(0, 4)
                      .map((tag) => (
                        <Badge key={tag} tone="violet">
                          {labelOf(HOT_TOPIC_LABELS, tag)}
                        </Badge>
                      ))}
                  </div>
                  {firstPassage ? (
                    <Link
                      to={`/listening/${firstPassage.id}`}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-surface hover:bg-accent/90"
                    >
                      開始整套訓練
                    </Link>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
