import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { setRegistered } from '../db/repo';
import {
  getExamRecord,
  getMistakes,
  useLocalProgressRevision,
} from '../services/localProgress';
import {
  getDueLocalWords,
  getLocalWords,
  useLocalWordsRevision,
} from '../services/localWords';
import { examLevelOf, useExamLevel } from '../services/examLevel';
import {
  formatDate,
  getCountdown,
  phaseFocus,
  todayKey,
  weekdayLabel,
} from '../services/time/countdown';
import { useToast } from '../components/Toast';
import { WeeklyStats } from '../features/stats/WeeklyStats';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  SectionTitle,
  Stat,
} from '../components/ui';
import { percent } from '../lib/utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [level] = useExamLevel();
  useLocalProgressRevision();
  useLocalWordsRevision();

  const data = useLiveQuery(async () => {
    const [
      profile,
      exams,
      questions,
      attempts,
      mistakes,
      words,
      reviews,
      reviewLogs,
    ] = await Promise.all([
      db.profile.get('me'),
      db.exams.toArray(),
      db.questions.toArray(),
      db.attempts.toArray(),
      db.mistakes.toArray(),
      db.words.toArray(),
      db.reviews.toArray(),
      db.reviewLogs.toArray(),
    ]);

    const today = todayKey();
    const isToday = (iso: string) => todayKey(new Date(iso)) === today;
    const todayAttempts = attempts.filter((attempt) => isToday(attempt.createdAt));
    const openMistakes = mistakes.filter((mistake) => mistake.status === 'open');
    const dueWords = reviews.filter(
      (review) =>
        review.itemType === 'word' && !review.suspended && review.dueAt <= today,
    );
    const dueMistakes = reviews.filter(
      (review) => review.itemType === 'mistake' && review.dueAt <= today,
    );
    const correct = attempts.filter((attempt) => attempt.isCorrect).length;
    const todayWordReviews = reviewLogs.filter(
      (log) => log.itemType === 'word' && isToday(log.reviewedAt),
    ).length;
    const todayMistakeReviews = todayAttempts.filter(
      (attempt) => attempt.mode === 'review',
    ).length;

    const examCards = exams
      .filter(
        (exam) =>
          exam.sections.includes('reading') &&
          examLevelOf(exam) === level,
      )
      .map((exam) => {
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
        return {
          exam,
          questionCount: examQuestions.length,
          attempted: attempted.size,
          progress:
            examQuestions.length > 0
              ? attempted.size / examQuestions.length
              : 0,
        };
      })
      .sort(
        (a, b) =>
          b.exam.year - a.exam.year ||
          b.exam.month - a.exam.month ||
          a.exam.id.localeCompare(b.exam.id),
      );

    return {
      profile,
      examCards,
      totalAttempts: attempts.length,
      correct,
      todayAttempts: todayAttempts.length,
      todayCorrect: todayAttempts.filter((attempt) => attempt.isCorrect).length,
      openMistakes,
      dueWords,
      dueMistakes,
      wordsCount: words.length,
      todayWords: words.filter((word) => isToday(word.createdAt)).length,
      todayWordReviews,
      todayMistakeReviews,
    };
  }, [level]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在載入本地資料…
      </div>
    );
  }

  const registered = data.profile?.registered ?? false;
  const localMistakeCount = getMistakes().length;
  const localWords = getLocalWords();
  const localDueWords = getDueLocalWords();
  const localTodayAdded = localWords.filter(
    (word) => todayKey(new Date(word.addedAt)) === todayKey(),
  ).length;
  const dueWordCount = data.dueWords.length + localDueWords.length;
  const countdown = getCountdown(new Date(), registered);
  const days = countdown.daysToExam;
  const registration = registrationCopy(countdown);
  const todayAccuracy = percent(data.todayCorrect, data.todayAttempts);
  const overallAccuracy = percent(data.correct, data.totalAttempts);
  const wordTaskActive =
    data.dueWords.length > 0 || data.todayWordReviews > 0;
  const mistakeTaskActive =
    data.openMistakes.length > 0 || data.todayMistakeReviews > 0;
  const taskTotal =
    1 + (wordTaskActive ? 1 : 0) + (mistakeTaskActive ? 1 : 0);
  const doneTasks =
    (data.todayAttempts > 0 ? 1 : 0) +
    (data.todayWordReviews > 0 ? 1 : 0) +
    (data.todayMistakeReviews > 0 ? 1 : 0);

  const toggleRegistered = async () => {
    await setRegistered(!registered);
    toast.push(registered ? '已取消報名標記' : '已標記為已報名', 'ok');
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden p-5 sm:p-7 lg:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge tone="accent">
                {level === 'CET6' ? 'CET-6 · 六級考試' : 'CET-4 · 四級考試'}
              </Badge>
              <span className="text-xs text-muted">
                {level === 'CET6'
                  ? '六級考試日期尚未設定'
                  : `${countdown.phase.label} · 預估日期`}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
              {days > 0 ? (
                <>
                  <span className="text-6xl font-semibold leading-none tracking-tight tabular-nums text-ink sm:text-7xl">
                    {days}
                  </span>
                  <span className="pb-1 text-lg text-muted">天後考試</span>
                </>
              ) : days === 0 ? (
                <span className="text-4xl font-semibold tracking-tight text-accent sm:text-5xl">
                  今天考試
                </span>
              ) : (
                <span className="text-4xl font-semibold tracking-tight text-muted sm:text-5xl">
                  已封存
                </span>
              )}
            </div>

            <div className="mt-2 text-sm text-muted">
              {formatDate(countdown.examDate)}（{weekdayLabel(countdown.examDate)}）· 以{' '}
              {countdown.today} 計算
              {level === 'CET6' ? '（以上為 CET-4 參考；六級日期請在 config/dates.json 設定）' : ''}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs text-faint">
                <span>
                  {level === 'CET6' ? 'CET-4 參考進度' : '備考進度'}
                </span>
                <span>{Math.round(countdown.planProgress * 100)}%</span>
              </div>
              <Progress value={countdown.planProgress} />
              <div className="mt-2 flex justify-between text-[11px] text-faint">
                <span>起點 {formatDate(countdown.planStartDate)}</span>
                <span>考試 {formatDate(countdown.examDate)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => navigate('/exams')}>開始閱讀</Button>
              <Button
                variant="secondary"
                onClick={() => navigate('/translation')}
              >
                翻譯練習
              </Button>
              <Button variant="secondary" onClick={() => navigate('/review')}>
                複習生詞
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate('/my-mistakes')}
              >
                我的错题
                {localMistakeCount > 0 ? ` (${localMistakeCount})` : ''}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs tracking-wide text-muted">
                  {registration.title}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold leading-none tabular-nums text-ink">
                    {registration.value}
                  </span>
                  {registration.suffix ? (
                    <span className="text-sm text-muted">{registration.suffix}</span>
                  ) : null}
                </div>
                <div className="mt-2 text-xs leading-5 text-faint">
                  {registration.note}
                </div>
              </div>
              <Badge
                tone={
                  countdown.registrationStatus === 'registered'
                    ? 'ok'
                    : countdown.registrationStatus === 'open'
                      ? 'warn'
                      : countdown.registrationStatus === 'missed'
                        ? 'danger'
                        : 'muted'
                }
              >
                {registrationStatusLabel(countdown.registrationStatus)}
              </Badge>
            </div>

            {countdown.registrationStatus !== 'missed' ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-4 w-full"
                onClick={toggleRegistered}
              >
                {registered ? '取消報名標記' : '標記已報名'}
              </Button>
            ) : (
              <div className="mt-4 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-xs leading-5 text-warn">
                下一場預估：{formatDate(countdown.backupExamDate)}。可先依原計畫繼續累積。
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs tracking-wide text-muted">目前階段</div>
              <Badge tone="violet">{countdown.phase.label}</Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink">
              {phaseFocus(countdown.phase.id)}
            </p>
            <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
              <span>目標 {data.profile?.targetScore ?? 425} 分（及格線）</span>
              <span>累積量導向</span>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="累計作答"
          value={data.totalAttempts}
          hint={`今日 ${data.todayAttempts} 題`}
        />
        <Stat
          label="總正確率"
          value={overallAccuracy}
          hint={`今日 ${todayAccuracy}`}
          tone="accent"
        />
        <Stat
          label="待重練錯題"
          value={data.openMistakes.length}
          hint={`今日到期 ${data.dueMistakes.length}`}
          tone={data.openMistakes.length > 0 ? 'danger' : 'default'}
        />
        <Stat
          label="生詞本"
          value={data.wordsCount + localWords.length}
          hint={`今日新增 ${data.todayWords + localTodayAdded} · 到期 ${dueWordCount}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionTitle
            eyebrow="Today"
            title="今日三件事"
            description="不用一次做完所有事；先讓今天有推進。"
            action={
              <Badge tone={doneTasks === taskTotal ? 'ok' : 'muted'}>
                {doneTasks} / {taskTotal}
              </Badge>
            }
          />

          <div className="space-y-2">
            <TaskRow
              index={1}
              title="完成一組閱讀"
              detail={
                data.todayAttempts > 0
                  ? `今日已作答 ${data.todayAttempts} 題（${todayAccuracy}）`
                  : '從範例文章開始，先跑通一次完整流程'
              }
              state={data.todayAttempts > 0 ? 'done' : 'pending'}
              onOpen={() => navigate('/exams')}
            />
            <TaskRow
              index={2}
              title="複習到期生詞"
              detail={
                data.todayWordReviews > 0
                  ? `今日已複習 ${data.todayWordReviews} 個`
                  : dueWordCount === 0
                    ? '今日沒有到期單詞'
                    : `${dueWordCount} 個單詞到期`
              }
              state={
                data.todayWordReviews > 0
                  ? 'done'
                  : dueWordCount === 0
                    ? 'neutral'
                    : 'pending'
              }
              onOpen={() => navigate('/review')}
            />
            <TaskRow
              index={3}
              title="重練錯題"
              detail={
                data.todayMistakeReviews > 0
                  ? `今日已重練 ${data.todayMistakeReviews} 題`
                  : data.openMistakes.length === 0
                    ? '目前沒有未掌握錯題'
                    : `${data.openMistakes.length} 題尚未掌握`
              }
              state={
                data.todayMistakeReviews > 0
                  ? 'done'
                  : data.openMistakes.length === 0
                    ? 'neutral'
                    : 'pending'
              }
              onOpen={() => navigate('/mistakes')}
            />
          </div>

          {localDueWords.length > 0 ? (
            <div className="mt-3 rounded-xl border border-line-soft bg-panel-2/40 p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] text-faint">
                <span>复习到期生词 · 本地</span>
                <span>{localDueWords.length} 个</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {localDueWords.slice(0, 8).map((word) => (
                  <button
                    key={word.id}
                    type="button"
                    onClick={() =>
                      navigate(`/word/${encodeURIComponent(word.id)}`)
                    }
                    className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
                  >
                    {word.word}
                  </button>
                ))}
              </div>
              {localDueWords.length > 8 ? (
                <div className="mt-1.5 text-[11px] text-faint">
                  还有 {localDueWords.length - 8} 个
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <SectionTitle
            eyebrow="Library"
            title="閱讀題庫"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/exams')}>
                全部 →
              </Button>
            }
          />

          {data.examCards.length === 0 ? (
            <EmptyState
              icon="＋"
              title="尚無題庫"
              description="把 exam.md 貼進匯入頁，或使用內建的範例文章。"
              action={
                <Button size="sm" onClick={() => navigate('/import')}>
                  前往匯入
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {data.examCards.slice(0, 3).map((card) => {
                const record = getExamRecord(card.exam.id, 'reading');
                const attempted = record?.answeredIds.length ?? card.attempted;
                const progress =
                  card.questionCount > 0 ? attempted / card.questionCount : 0;
                return (
                  <button
                    key={card.exam.id}
                    type="button"
                    onClick={() => navigate(`/practice/${card.exam.id}`)}
                    className="w-full rounded-xl border border-line bg-panel-2 p-3 text-left transition-colors hover:border-accent/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-5 text-ink">
                        {card.exam.title}
                      </div>
                      <span className="shrink-0 text-[11px] text-faint">
                        {card.exam.year}/{String(card.exam.month).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                      <span>
                        {attempted} / {card.questionCount} 题
                      </span>
                      <span>
                        {record
                          ? `${record.completed ? '已完成' : '未完成'} · ${percent(record.correctIds.length, record.answeredIds.length)}`
                          : '未开始'}
                      </span>
                    </div>
                    <Progress className="mt-1.5" value={progress} />
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <WeeklyStats />
    </div>
  );
}

function TaskRow({
  index,
  title,
  detail,
  state,
  onOpen,
}: {
  index: number;
  title: string;
  detail: string;
  state: 'done' | 'pending' | 'neutral';
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line-soft bg-panel-2/60 px-3 py-3">
      <div
        className={
          state === 'done'
            ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ok/15 text-sm text-ok'
            : state === 'neutral'
              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-soft text-xs text-faint'
              : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs text-muted'
        }
      >
        {state === 'done' ? '✓' : state === 'neutral' ? '—' : index}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="truncate text-xs text-faint">{detail}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        前往
      </Button>
    </div>
  );
}

function registrationStatusLabel(status: string): string {
  switch (status) {
    case 'registered':
      return '已報名';
    case 'open':
      return '報名中';
    case 'missed':
      return '已截止';
    default:
      return '未開放';
  }
}

function registrationCopy(countdown: ReturnType<typeof getCountdown>) {
  switch (countdown.registrationStatus) {
    case 'not_open':
      return {
        title: '距報名開放',
        value: Math.max(0, countdown.daysToRegistrationStart),
        suffix: '天',
        note: `${formatDate(countdown.registrationStart)} 開放 · 預估`,
      };
    case 'open':
      return {
        title: '報名窗口剩',
        value: Math.max(0, countdown.daysToRegistrationEnd),
        suffix: '天',
        note: `至 ${formatDate(countdown.registrationEnd)} 23:59 · 預估`,
      };
    case 'registered':
      return {
        title: '已完成報名',
        value: '✓',
        suffix: '',
        note: `考試 ${formatDate(countdown.examDate)} · 預估`,
      };
    default:
      return {
        title: '已錯過報名',
        value: '—',
        suffix: '',
        note: `備用場次 ${formatDate(countdown.backupExamDate)}`,
      };
  }
}
