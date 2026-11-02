import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { ReviewGrade, ReviewRecord, WordRecord } from '../db/types';
import { advanceReviewGrade } from '../db/repo';
import {
  buildQueue,
  examClampDate,
  gradeCard,
  SRS_RULES,
  type SrsWord,
} from '../services/srs';
import { formatDate, todayKey } from '../services/time/countdown';
import { getStableOrder, resetStableOrder } from '../lib/stableOrder';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  SectionTitle,
} from '../components/ui';
import { cn } from '../lib/utils';

interface QueueCard {
  review: ReviewRecord;
  word: WordRecord;
}

interface Session {
  cards: QueueCard[];
  dueCount: number;
  remaining: number;
  completedAtStart: number;
}

type GradeCounts = Record<'again' | 'hard' | 'good' | 'easy', number>;

const EMPTY_COUNTS: GradeCounts = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
};

export default function Review() {
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [counts, setCounts] = useState<GradeCounts>(EMPTY_COUNTS);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const data = useLiveQuery(async () => {
    const [profile, reviews, words, reviewLogs, todayLog] = await Promise.all([
      db.profile.get('me'),
      db.reviews.toArray(),
      db.words.toArray(),
      db.reviewLogs.toArray(),
      db.dailyLogs.get(todayKey()),
    ]);
    const today = todayKey();
    const wordsById = new Map(words.map((word) => [word.id, word]));
    const wordLogs = reviewLogs.filter(
      (log) =>
        log.itemType === 'word' && todayKey(new Date(log.reviewedAt)) === today,
    );
    const reviewedTodayIds = new Set(wordLogs.map((log) => log.itemId));

    return {
      profile,
      reviews,
      wordsById,
      reviewedTodayIds,
      completedToday: wordLogs.length,
      todayLog,
      today,
    };
  }, []);

  useEffect(() => {
    if (!data || session) return;

    const srsWords = new Map<string, SrsWord>();
    for (const [id, word] of data.wordsById) {
      srsWords.set(id, { id, frequencyRank: word.frequencyRank });
    }

    const result = buildQueue({
      today: data.today,
      reviews: data.reviews,
      wordsById: srsWords,
      reviewedTodayIds: data.reviewedTodayIds,
      cap: SRS_RULES.daily_review_cap,
      completedToday: data.completedToday,
    });

    const cards = result.queue
      .map((review) => {
        const word = data.wordsById.get(review.itemId);
        return word ? { review, word } : null;
      })
      .filter((card): card is QueueCard => Boolean(card));

    const cardById = new Map(
      cards.map((card) => [card.review.itemId, card]),
    );
    const orderedIds = getStableOrder(
      'review:queue',
      cards.map((card) => card.review.itemId),
    );
    const orderedCards = orderedIds
      .map((id) => cardById.get(id))
      .filter((card): card is QueueCard => Boolean(card));

    setSession({
      cards: orderedCards,
      dueCount: result.dueCount,
      remaining: result.remaining,
      completedAtStart: data.completedToday,
    });
    setIndex(0);
    setRevealed(false);
    setFinished(false);
    setCounts(EMPTY_COUNTS);
  }, [data, session]);

  const today = data?.today ?? todayKey();
  const examClamp = examClampDate();
  const current = session?.cards[index];
  const preview = (grade: ReviewGrade) => {
    if (!current) return null;
    return gradeCard({
      stage: current.review.stage,
      lapses: current.review.lapses ?? 0,
      grade,
      today,
      examClamp,
    });
  };

  const handleReshuffle = () => {
    resetStableOrder('review:queue');
    setSession(null);
    setIndex(0);
    setRevealed(false);
    setFinished(false);
    setCounts(EMPTY_COUNTS);
    toast.push('已重新洗牌複習順序', 'ok');
  };

  const handleGrade = useCallback(
    async (grade: ReviewGrade) => {
      if (!current || !revealed || submitting || !session) return;
      setSubmitting(true);
      try {
        const next = gradeCard({
          stage: current.review.stage,
          lapses: current.review.lapses ?? 0,
          grade,
          today,
          examClamp,
        });
        await advanceReviewGrade('word', current.review.itemId, grade);
        setCounts((previous) => ({
          ...previous,
          [grade]: previous[grade] + 1,
        }));

        if (index + 1 >= session.cards.length) {
          setIndex(session.cards.length);
          setFinished(true);
          setRevealed(false);
        } else {
          setIndex((value) => value + 1);
          setRevealed(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        toast.push(`已排入 ${formatDate(next.dueAt)}`, 'ok');
      } catch (error) {
        toast.push(
          error instanceof Error ? error.message : '更新複習排程失敗',
          'error',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      current,
      revealed,
      submitting,
      session,
      today,
      examClamp,
      index,
      toast,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.code === 'Space' && !revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      if (event.key === '1') {
        event.preventDefault();
        void handleGrade('again');
      } else if (event.key === '2') {
        event.preventDefault();
        void handleGrade('hard');
      } else if (event.key === '3') {
        event.preventDefault();
        void handleGrade('good');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revealed, handleGrade]);

  if (!data || !session) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在建立今日複習佇列…
      </div>
    );
  }

  const backlogAssigned = data.todayLog?.backlogAssigned ?? 0;
  const backlogOverflow = data.todayLog?.backlogOverflow ?? 0;
  const pausedUntil = data.profile?.srs?.newWordsPausedUntil ?? null;
  const completed = session.completedAtStart + index;
  const progressValue =
    session.cards.length > 0 ? index / session.cards.length : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle
        eyebrow="Review"
        title="單詞複習"
        description="先回想再看答案；忘記／模糊／記得會決定下一次到期日。"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleReshuffle}>
              重新洗牌
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/words')}>
              回生詞本
            </Button>
          </div>
        }
      />

      {backlogAssigned > 0 || backlogOverflow > 0 || pausedUntil ? (
        <Card className="mb-4 border-warn/25 bg-warn/5 p-4">
          <div className="text-xs font-medium text-warn">回填／考期提醒</div>
          <div className="mt-1 text-[11px] leading-5 text-muted">
            {backlogAssigned > 0
              ? `已分配 ${backlogAssigned} 個逾期單詞；`
              : ''}
            {backlogOverflow > 0
              ? `另有 ${backlogOverflow} 個超額，留待後續；`
              : ''}
            {pausedUntil
              ? `新詞暫停至 ${formatDate(pausedUntil)}。`
              : ''}
          </div>
        </Card>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] text-faint">今日已複習</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {completed}
            <span className="text-xs font-normal text-faint">
              {' '}
              / {SRS_RULES.daily_review_cap}
            </span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-faint">本輪進度</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-accent">
            {index}
            <span className="text-xs font-normal text-faint">
              {' '}
              / {session.cards.length}
            </span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-faint">今日到期</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {session.dueCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-faint">超額留待</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {session.remaining}
          </div>
        </Card>
      </div>

      {session.cards.length === 0 ? (
        <EmptyState
          icon="✓"
          title={
            data.completedToday >= SRS_RULES.daily_review_cap
              ? '今日複習已達上限'
              : '今日沒有到期單詞'
          }
          description={
            data.completedToday >= SRS_RULES.daily_review_cap
              ? `今天已完成 ${data.completedToday} 個，剩下的留待明天。`
              : '可以去核心詞庫加入新詞，或回到閱讀與錯題練習。'
          }
          action={
            <div className="flex gap-2">
              <Button onClick={() => navigate('/words?tab=bank')}>
                瀏覽核心詞庫
              </Button>
              <Button variant="secondary" onClick={() => navigate('/')}>
                回首頁
              </Button>
            </div>
          }
        />
      ) : finished ? (
        <Card className="animate-rise p-6 text-center">
          <div className="text-4xl">✓</div>
          <h2 className="mt-3 text-xl font-semibold text-ink">
            本輪複習完成
          </h2>
          <p className="mt-1 text-sm text-muted">
            共 {session.cards.length} 個單詞；下一次到期日會依評分自動安排。
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-line bg-panel-2 p-3">
              <div className="text-lg font-semibold text-danger">
                {counts.again}
              </div>
              <div className="text-[10px] text-faint">忘記</div>
            </div>
            <div className="rounded-xl border border-line bg-panel-2 p-3">
              <div className="text-lg font-semibold text-warn">
                {counts.hard}
              </div>
              <div className="text-[10px] text-faint">模糊</div>
            </div>
            <div className="rounded-xl border border-line bg-panel-2 p-3">
              <div className="text-lg font-semibold text-ok">{counts.good}</div>
              <div className="text-[10px] text-faint">記得</div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate('/words')}>回生詞本</Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/words?tab=bank')}
            >
              再學新詞
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              回首頁
            </Button>
          </div>
        </Card>
      ) : current ? (
        <Card className="p-5 sm:p-6">
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
              <span>
                第 {index + 1} / {session.cards.length} 個
              </span>
              <span>今日已完成 {completed} / {SRS_RULES.daily_review_cap}</span>
            </div>
            <Progress value={progressValue} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {current.review.stage === 0 && !current.review.lastReviewedAt ? (
              <Badge tone="accent">新詞</Badge>
            ) : (
              <Badge tone="muted">階段 {current.review.stage}</Badge>
            )}
            {current.word.wordBankId ? (
              <Badge tone="violet">核心詞庫</Badge>
            ) : null}
            {(current.word.pos ?? []).map((item) => (
              <Badge key={item} tone="muted">
                {item}
              </Badge>
            ))}
            {typeof current.word.frequencyRank === 'number' ? (
              <Badge tone="muted">#{current.word.frequencyRank}</Badge>
            ) : null}
            {current.word.isHotTerm ? (
              <Badge tone="violet">熱點術語</Badge>
            ) : null}
          </div>

          <div className="mt-4">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">
              {current.word.lemma}
            </h2>
            {current.word.phonetics?.us || current.word.phonetics?.uk ? (
              <div className="mt-1 text-sm text-faint">
                {[current.word.phonetics?.us, current.word.phonetics?.uk]
                  .filter(Boolean)
                  .join(' / ')}
              </div>
            ) : null}
          </div>

          {!revealed ? (
            <div className="mt-6 rounded-xl border border-dashed border-line bg-panel-2/40 p-6 text-center">
              <p className="text-sm text-muted">先在心里回想意思，再揭曉答案。</p>
              <Button className="mt-4" onClick={() => setRevealed(true)}>
                顯示答案（Space）
              </Button>
            </div>
          ) : (
            <div className="animate-rise mt-5 space-y-3">
              <div className="rounded-xl border border-line-soft bg-panel-2/50 p-4">
                <div className="text-sm leading-6 text-ink">
                  {current.word.meaningZh}
                </div>
                {current.word.meaningEn ? (
                  <div className="mt-1 text-xs leading-5 text-muted">
                    {current.word.meaningEn}
                  </div>
                ) : null}
              </div>

              {current.word.example ? (
                <div className="rounded-xl border border-line-soft bg-panel-2/30 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-faint">
                    Example
                  </div>
                  <p className="mt-1 text-sm leading-6 text-ink">
                    {current.word.example}
                  </p>
                  {current.word.exampleZh ? (
                    <p className="mt-1 text-xs leading-5 text-faint">
                      {current.word.exampleZh}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {(current.word.collocations ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(current.word.collocations ?? []).map((item) => (
                    <span
                      key={item}
                      className="rounded-md border border-line px-2 py-0.5 text-[11px] text-faint"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}

              {(current.word.wordFamily ?? []).length > 0 ? (
                <div className="text-[11px] text-faint">
                  詞族：
                  {(current.word.wordFamily ?? [])
                    .map((item) => `${item.lemma}（${item.pos}）`)
                    .join('、')}
                </div>
              ) : null}

              {current.word.sourceExamId && current.word.sourcePassageId ? (
                <div className="text-[11px]">
                  <Link
                    to={`/practice/${current.word.sourceExamId}/${current.word.sourcePassageId}`}
                    className="text-accent hover:underline"
                  >
                    回到來源文章 →
                  </Link>
                </div>
              ) : null}

              <div className="grid gap-2 pt-2 sm:grid-cols-3">
                {(
                  [
                    {
                      grade: 'again' as const,
                      label: '忘記',
                      tone: 'danger' as const,
                    },
                    {
                      grade: 'hard' as const,
                      label: '模糊',
                      tone: 'secondary' as const,
                    },
                    {
                      grade: 'good' as const,
                      label: '記得',
                      tone: 'primary' as const,
                    },
                  ] as const
                ).map((item) => {
                  const next = preview(item.grade);
                  return (
                    <Button
                      key={item.grade}
                      variant={item.tone}
                      disabled={submitting}
                      onClick={() => void handleGrade(item.grade)}
                      className="h-auto flex-col gap-0.5 py-2.5"
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] font-normal opacity-70">
                        {next ? `下次 ${formatDate(next.dueAt)}` : ''}
                      </span>
                    </Button>
                  );
                })}
              </div>

              <div className="text-center text-[10px] text-faint">
                鍵盤：Space 顯示答案、1 忘記、2 模糊、3 記得
              </div>
            </div>
          )}
        </Card>
      ) : (
        <EmptyState
          icon="✓"
          title="這一輪已結束"
          description="重新整理頁面會依最新到期狀態建立新佇列。"
          action={<Button onClick={() => navigate('/words')}>回生詞本</Button>}
        />
      )}
    </div>
  );
}
