import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getLocalWords,
  markLocalWordReviewed,
  useLocalWordsRevision,
} from '../../services/localWords';
import { todayKey } from '../../services/time/countdown';
import { formatDateTime } from '../../lib/utils';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { useToast } from '../../components/Toast';

export function LocalWordsTab() {
  const toast = useToast();
  useLocalWordsRevision();
  const [search, setSearch] = useState('');
  const words = getLocalWords();
  const today = todayKey();

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return words;
    return words.filter(
      (word) =>
        word.word.toLowerCase().includes(keyword) ||
        (word.definition ?? '').toLowerCase().includes(keyword) ||
        word.sentence.toLowerCase().includes(keyword),
    );
  }, [search, words]);

  const dueCount = words.filter((word) => word.dueAt <= today).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-panel p-1 text-xs">
          <span className="rounded-lg bg-panel-2 px-3 py-1.5 text-accent">
            划词生词 {words.length}
          </span>
          <span className="px-3 py-1.5 text-muted">到期 {dueCount}</span>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索单词、释义或原句…"
          className="h-9 min-w-[220px] flex-1 rounded-xl border border-line bg-panel px-3 text-xs text-ink placeholder:text-faint focus:border-accent/60 sm:max-w-xs"
        />
      </div>

      {words.length === 0 ? (
        <EmptyState
          icon="◇"
          title="还没有划词生词"
          description="在阅读文章或题目解析中选中英文单词，点击浮窗里的“加入生词本”即可。"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="◇"
          title="没有匹配的生词"
          description="换一个关键词试试。"
        />
      ) : (
        <div className="space-y-3">
          {visible.map((word) => {
            const isDue = word.dueAt <= today;
            return (
              <Card key={word.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        {word.word}
                      </h3>
                      <Badge tone={isDue ? 'accent' : 'ok'}>
                        {isDue ? '待复习' : '已复习'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {word.definition?.trim() || '暂无本地释义，请手动校对'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-faint">
                    加入于 {formatDateTime(word.addedAt)}
                  </span>
                </div>

                <blockquote className="mt-3 line-clamp-3 border-l-2 border-accent/40 pl-3 text-xs leading-6 text-faint">
                  “{word.sentence || '暂无原句'}”
                </blockquote>

                <div className="mt-2 text-[11px] leading-5 text-faint">
                  {word.examTitle ? <span>{word.examTitle}</span> : null}
                  {word.passageTitle ? (
                    <span>
                      {word.examTitle ? ' · ' : ''}
                      {word.passageTitle}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    to={`/word/${encodeURIComponent(word.id)}`}
                    className="text-xs text-accent hover:underline"
                  >
                    查看词卡 →
                  </Link>
                  {isDue ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        markLocalWordReviewed(word.id);
                        toast.push('已标记复习，明天再见', 'ok');
                      }}
                    >
                      标记已复习
                    </Button>
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
