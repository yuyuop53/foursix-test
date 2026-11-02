import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { addWordFromBank } from '../../db/repo';
import type { WordBankEntry } from '../../content/wordBankSchema';
import { WORD_BANK_POS } from '../../content/wordBankSchema';
import { useToast } from '../../components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
} from '../../components/ui';
import { getCountdown, todayKey } from '../../services/time/countdown';
import { SRS_RULES } from '../../services/srs';
import { getStableOrder, resetStableOrder } from '../../lib/stableOrder';
import { cn } from '../../lib/utils';

const PAGE_SIZE = 25;

const RANK_BANDS = [
  { id: 'all', label: '全部', min: 0, max: Infinity },
  { id: '1-500', label: '1–500', min: 1, max: 500 },
  { id: '501-1000', label: '501–1000', min: 501, max: 1000 },
  { id: '1001-2000', label: '1001–2000', min: 1001, max: 2000 },
  { id: '2001+', label: '2001+', min: 2001, max: Infinity },
];

export function CoreBankTab() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [band, setBand] = useState('all');
  const [pos, setPos] = useState('all');
  const [tag, setTag] = useState('all');
  const [page, setPage] = useState(0);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  const data = useLiveQuery(async () => {
    const [bank, words, profile, reviewLogs] = await Promise.all([
      db.wordBank.toArray(),
      db.words.toArray(),
      db.profile.get('me'),
      db.reviewLogs.toArray(),
    ]);
    const today = todayKey();
    const addedIds = new Set(
      words
        .map((word) => word.wordBankId)
        .filter((id): id is string => Boolean(id)),
    );
    const newWords = words.filter(
      (word) => todayKey(new Date(word.createdAt)) === today,
    ).length;
    const reviews = reviewLogs.filter(
      (log) =>
        log.itemType === 'word' && todayKey(new Date(log.reviewedAt)) === today,
    ).length;

    return {
      bank: [...bank].sort((a, b) => a.frequencyRank - b.frequencyRank),
      addedIds,
      newWords,
      reviews,
      profile,
      today,
    };
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, band, pos, tag]);

  const allTags = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.bank.flatMap((entry) => entry.tags ?? [])))
      .filter(Boolean)
      .sort();
  }, [data]);

  const orderedBank = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.bank.map((entry) => [entry.id, entry]));
    const order = getStableOrder(
      'wordbank:core_500',
      data.bank.map((entry) => entry.id),
    );
    return order
      .map((id) => byId.get(id))
      .filter((entry): entry is WordBankEntry => Boolean(entry));
  }, [data, shuffleKey]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const keyword = search.trim().toLowerCase();
    const rankBand = RANK_BANDS.find((item) => item.id === band) ?? RANK_BANDS[0];

    return orderedBank.filter((entry) => {
      if (entry.frequencyRank < rankBand.min || entry.frequencyRank > rankBand.max) {
        return false;
      }
      if (pos !== 'all' && !entry.pos.includes(pos as (typeof WORD_BANK_POS)[number])) {
        return false;
      }
      if (tag !== 'all' && !(entry.tags ?? []).includes(tag)) {
        return false;
      }
      if (!keyword) return true;
      return (
        entry.lemma.toLowerCase().includes(keyword) ||
        entry.meanings.zh.some((meaning) => meaning.includes(keyword)) ||
        entry.meanings.en.some((meaning) =>
          meaning.toLowerCase().includes(keyword),
        )
      );
    });
  }, [data, orderedBank, search, band, pos, tag]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageEntries = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  if (!data) {
    return (
      <div className="animate-pulse-soft py-16 text-center text-sm text-muted">
        正在載入核心詞庫…
      </div>
    );
  }

  if (data.bank.length === 0) {
    return (
      <EmptyState
        icon="◇"
        title="核心詞庫尚未載入"
        description="請重新整理頁面；若問題持續，檢查 content/words 的 JSON 是否通過驗證。"
      />
    );
  }

  const countdown = getCountdown();
  const pausedUntil = data.profile?.srs?.newWordsPausedUntil ?? null;
  const paused = Boolean(pausedUntil && pausedUntil >= data.today);
  const examWindow =
    countdown.daysToExam <= SRS_RULES.stop_new_words_days_before_exam;
  const capReached = data.newWords >= SRS_RULES.daily_new_words;
  const blockedReason = paused
    ? `新詞暫停至 ${pausedUntil}`
    : examWindow
      ? `距考試只剩 ${Math.max(0, countdown.daysToExam)} 天，已停止新增單詞`
      : capReached
        ? `今日新詞已達 ${SRS_RULES.daily_new_words} 個上限`
        : null;

  const handleShuffle = () => {
    resetStableOrder('wordbank:core_500');
    setShuffleKey((value) => value + 1);
    setPage(0);
    toast.push('已重新洗牌，新的順序已儲存', 'ok');
  };

  const handleAdd = async (entry: WordBankEntry) => {
    setAddingId(entry.id);
    try {
      const result = await addWordFromBank(entry.id);
      toast.push(
        result.created
          ? `已加入「${entry.lemma}」`
          : `「${entry.lemma}」已在生詞本`,
        'ok',
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '加入失敗', 'error');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[180px] flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
              <span>今日新詞</span>
              <span>
                {data.newWords} / {SRS_RULES.daily_new_words}
              </span>
            </div>
            <Progress
              value={data.newWords / SRS_RULES.daily_new_words}
              tone={capReached ? 'warn' : 'accent'}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
              <span>今日複習</span>
              <span>
                {data.reviews} / {SRS_RULES.daily_review_cap}
              </span>
            </div>
            <Progress
              value={data.reviews / SRS_RULES.daily_review_cap}
              tone={data.reviews >= SRS_RULES.daily_review_cap ? 'warn' : 'ok'}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/review')}>
            前往複習
          </Button>
        </div>

        {blockedReason ? (
          <div className="mt-3 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] leading-5 text-warn">
            {blockedReason}
          </div>
        ) : null}
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋單詞、中文或英文意思…"
          className="h-9 min-w-[220px] flex-1 rounded-xl border border-line bg-panel px-3 text-xs text-ink placeholder:text-faint focus:border-accent/60 sm:max-w-sm"
        />
        <select
          value={band}
          onChange={(event) => setBand(event.target.value)}
          className="h-9 rounded-xl border border-line bg-panel px-3 text-xs text-muted"
          aria-label="頻率區間"
        >
          {RANK_BANDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={pos}
          onChange={(event) => setPos(event.target.value)}
          className="h-9 rounded-xl border border-line bg-panel px-3 text-xs text-muted"
          aria-label="詞性"
        >
          <option value="all">全部詞性</option>
          {WORD_BANK_POS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          className="h-9 rounded-xl border border-line bg-panel px-3 text-xs text-muted"
          aria-label="標籤"
        >
          <option value="all">全部標籤</option>
          {allTags.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={handleShuffle}>
          重新洗牌
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
        <span>共 {filtered.length} 詞</span>
        <span>
          第 {safePage + 1} / {pageCount} 頁
        </span>
      </div>

      {pageEntries.length === 0 ? (
        <EmptyState
          icon="◇"
          title="找不到符合的單詞"
          description="換個搜尋字，或放寬頻率／詞性／標籤篩選。"
        />
      ) : (
        <div className="space-y-2">
          {pageEntries.map((entry) => {
            const added = data.addedIds.has(entry.id);
            const disabled = added || Boolean(blockedReason) || addingId === entry.id;

            return (
              <Card key={entry.id} className="p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-faint">
                        #{entry.frequencyRank}
                      </span>
                      <h3 className="text-sm font-semibold text-ink">
                        {entry.lemma}
                      </h3>
                      {entry.phonetics?.us || entry.phonetics?.uk ? (
                        <span className="text-[11px] text-faint">
                          {[entry.phonetics?.us, entry.phonetics?.uk]
                            .filter(Boolean)
                            .join(' / ')}
                        </span>
                      ) : null}
                      {entry.pos.map((item) => (
                        <Badge key={item} tone="muted">
                          {item}
                        </Badge>
                      ))}
                      {(entry.tags ?? []).slice(0, 3).map((item) => (
                        <Badge key={item} tone="muted">
                          {item}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {entry.meanings.zh.join('；')}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-faint">
                      {entry.example.sentence}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {added ? (
                      <Badge tone="ok">已加入</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        title={blockedReason ?? undefined}
                        onClick={() => void handleAdd(entry)}
                      >
                        {addingId === entry.id ? '加入中…' : '加入學習'}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={safePage === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
        >
          上一頁
        </Button>
        <span className="text-[11px] text-faint">
          {safePage + 1} / {pageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
        >
          下一頁
        </Button>
      </div>
    </div>
  );
}
