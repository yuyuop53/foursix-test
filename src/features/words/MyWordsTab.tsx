import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import type { WordRecord } from '../../db/types';
import { deleteWord } from '../../db/repo';
import { useToast } from '../../components/Toast';
import { WordModal } from '../../components/WordModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
} from '../../components/ui';
import { formatDate, todayKey } from '../../services/time/countdown';
import { cn, formatShortDate } from '../../lib/utils';

export function MyWordsTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'due'>('all');
  const [deleteTarget, setDeleteTarget] = useState<WordRecord | null>(null);

  const data = useLiveQuery(async () => {
    const [words, reviews] = await Promise.all([
      db.words.toArray(),
      db.reviews.toArray(),
    ]);
    const reviewByWord = new Map(
      reviews
        .filter((review) => review.itemType === 'word')
        .map((review) => [review.itemId, review]),
    );
    return {
      words: words.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reviewByWord,
    };
  }, []);

  const today = todayKey();

  const visible = useMemo(() => {
    if (!data) return [];
    const keyword = search.trim().toLowerCase();
    return data.words.filter((word) => {
      const review = data.reviewByWord.get(word.id);
      const isDue = Boolean(review && !review.suspended && review.dueAt <= today);
      if (filter === 'due' && !isDue) return false;
      if (!keyword) return true;
      return (
        word.lemma.toLowerCase().includes(keyword) ||
        word.meaningZh.includes(keyword) ||
        (word.meaningEn ?? '').toLowerCase().includes(keyword)
      );
    });
  }, [data, search, filter, today]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-16 text-center text-sm text-muted">
        正在載入生詞本…
      </div>
    );
  }

  const dueCount = data.words.filter((word) => {
    const review = data.reviewByWord.get(word.id);
    return Boolean(review && !review.suspended && review.dueAt <= today);
  }).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteWord(deleteTarget.id);
      toast.push('已刪除生詞', 'ok');
      setDeleteTarget(null);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '刪除失敗', 'error');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-panel p-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs transition-colors',
              filter === 'all'
                ? 'bg-panel-2 text-accent'
                : 'text-muted hover:text-ink',
            )}
          >
            全部 {data.words.length}
          </button>
          <button
            type="button"
            onClick={() => setFilter('due')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs transition-colors',
              filter === 'due'
                ? 'bg-panel-2 text-accent'
                : 'text-muted hover:text-ink',
            )}
          >
            到期 {dueCount}
          </button>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋單詞、中文或英文意思…"
          className="h-9 min-w-[220px] flex-1 rounded-xl border border-line bg-panel px-3 text-xs text-ink placeholder:text-faint focus:border-accent/60 sm:max-w-xs"
        />

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/review')}>
            開始複習
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            ＋ 新增生詞
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="◇"
          title={
            data.words.length === 0
              ? '生詞本還是空的'
              : filter === 'due'
                ? '目前沒有到期生詞'
                : '找不到符合的單詞'
          }
          description={
            data.words.length === 0
              ? '閱讀時選取文中單詞，或從核心詞庫加入第一批單詞。'
              : '換個關鍵字，或切回「全部」。'
          }
          action={
            data.words.length === 0 ? (
              <div className="flex gap-2">
                <Button onClick={() => setAddOpen(true)}>手動新增</Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate('/words?tab=bank')}
                >
                  瀏覽核心詞庫
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((word) => {
            const review = data.reviewByWord.get(word.id);
            const due = Boolean(review && !review.suspended && review.dueAt <= today);
            const phonetics = word.phonetics
              ? [word.phonetics.us, word.phonetics.uk]
                  .filter(Boolean)
                  .join(' / ')
              : '';

            return (
              <Card key={word.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        {word.lemma}
                      </h3>
                      {phonetics ? (
                        <span className="text-xs text-faint">{phonetics}</span>
                      ) : null}
                      {due ? <Badge tone="warn">到期</Badge> : null}
                      {word.isHotTerm ? (
                        <Badge tone="violet">熱點術語</Badge>
                      ) : null}
                      {word.wordBankId ? (
                        <Badge tone="accent">核心詞庫</Badge>
                      ) : null}
                      {(word.pos ?? []).map((pos) => (
                        <Badge key={pos} tone="muted">
                          {pos}
                        </Badge>
                      ))}
                      {(word.tags ?? []).map((tag) => (
                        <Badge key={tag} tone="muted">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {word.meaningZh}
                    </p>
                    {word.meaningEn ? (
                      <p className="mt-0.5 text-xs leading-5 text-faint">
                        {word.meaningEn}
                      </p>
                    ) : null}
                    {word.example ? (
                      <div className="mt-1.5 border-l-2 border-line pl-3">
                        <p className="text-xs leading-5 text-faint">
                          {word.example}
                        </p>
                        {word.exampleZh ? (
                          <p className="text-[11px] leading-5 text-faint/80">
                            {word.exampleZh}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {(word.collocations ?? []).length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(word.collocations ?? []).slice(0, 4).map((item) => (
                          <span
                            key={item}
                            className="rounded-md border border-line-soft px-1.5 py-0.5 text-[10px] text-faint"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-faint">
                      <span>加入 {formatShortDate(word.createdAt)}</span>
                      {review ? (
                        <>
                          <span>下次複習 {formatDate(review.dueAt)}</span>
                          <span>階段 {review.stage}</span>
                          {(review.lapses ?? 0) > 0 ? (
                            <span>遺忘 {review.lapses} 次</span>
                          ) : null}
                        </>
                      ) : (
                        <span>尚未建立複習排程</span>
                      )}
                      {word.sourceExamId && word.sourcePassageId ? (
                        <Link
                          to={`/practice/${word.sourceExamId}/${word.sourcePassageId}`}
                          className="hover:text-accent"
                        >
                          來源文章 →
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate('/review')}
                    >
                      複習
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(word)}
                      aria-label={`刪除 ${word.lemma}`}
                    >
                      刪除
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <WordModal open={addOpen} onClose={() => setAddOpen(false)} />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="刪除生詞"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              刪除
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-muted">
          確定要刪除「{deleteTarget?.lemma}」嗎？相關複習紀錄也會一併移除。
        </p>
      </Modal>
    </div>
  );
}
