import { useEffect, useMemo, useState } from 'react';
import { getExamRecords } from '../../services/localProgress';
import {
  backfillDailyStats,
  getLast7Days,
  getOverallStats,
  useLocalStatsRevision,
} from '../../services/localStats';
import { Badge, Card, Progress } from '../../components/ui';
import { cn, percent } from '../../lib/utils';

export function WeeklyStats() {
  useLocalStatsRevision();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    backfillDailyStats(getExamRecords());
  }, []);

  const days = getLast7Days();
  const overall = getOverallStats();
  const total7 = days.reduce((sum, day) => sum + day.answered, 0);
  const max = Math.max(1, ...days.map((day) => day.answered));
  const maxIndex = useMemo(
    () =>
      days.reduce(
        (best, day, index) =>
          day.answered > days[best].answered ? index : best,
        0,
      ),
    [days],
  );
  const today = days[days.length - 1]?.date;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] tracking-wide text-faint">
            LOCAL STATS
          </div>
          <h2 className="mt-1 text-base font-semibold text-ink">数据统计</h2>
          <p className="mt-1 text-xs text-faint">
            最近 7 天刷题量与整体正确率，数据来自本地答题记录。
          </p>
        </div>
        <Badge tone="muted">仅本地</Badge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-faint">
            <span>最近 7 天刷题量</span>
            <span>{total7} 题</span>
          </div>

          {total7 === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-line-soft bg-panel-2/30 text-xs text-faint">
              最近 7 天还没有刷题记录，做几道题后这里会自动统计。
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1 pt-7">
              {days.map((day, index) => {
                const isToday = day.date === today;
                const height =
                  day.answered === 0
                    ? 0
                    : Math.max(2, (day.answered / max) * 100);
                const label = isToday
                  ? '今天'
                  : day.date.slice(5).replace('-', '/');

                return (
                  <button
                    key={day.date}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                    onClick={() =>
                      setActiveIndex((current) =>
                        current === index ? null : index,
                      )
                    }
                    aria-label={`${day.date}：${day.answered} 题，答对 ${day.correct} 题，正确率 ${
                      day.answered ? percent(day.correct, day.answered) : '—'
                    }`}
                    className="group relative flex flex-col items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <div className="relative flex h-28 w-full items-end justify-center border-b border-line-soft">
                      {index === maxIndex && day.answered > 0 ? (
                        <span
                          className="absolute left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-muted"
                          style={{ bottom: `calc(${height}% + 6px)` }}
                        >
                          {day.answered}
                        </span>
                      ) : null}
                      <div
                        className={cn(
                          'w-5 rounded-t-[4px] transition-colors sm:w-6',
                          isToday
                            ? 'bg-accent'
                            : 'bg-accent/60 group-hover:bg-accent/80',
                        )}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'mt-2 text-[10px]',
                        isToday ? 'font-medium text-ink' : 'text-faint',
                      )}
                    >
                      {label}
                    </span>

                    {activeIndex === index ? (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-[10px] text-ink shadow-xl">
                        {day.date} · {day.answered} 题 · 正确 {day.correct}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-faint hover:text-muted">
              查看数据表
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-faint">
                  <tr>
                    <th className="py-1 pr-3 font-medium">日期</th>
                    <th className="py-1 pr-3 font-medium">题量</th>
                    <th className="py-1 pr-3 font-medium">答对</th>
                    <th className="py-1 font-medium">正确率</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {days.map((day) => (
                    <tr key={day.date} className="border-t border-line-soft">
                      <td className="py-1 pr-3">{day.date}</td>
                      <td className="py-1 pr-3 tabular-nums">
                        {day.answered}
                      </td>
                      <td className="py-1 pr-3 tabular-nums">{day.correct}</td>
                      <td className="py-1 tabular-nums">
                        {day.answered
                          ? percent(day.correct, day.answered)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="rounded-xl border border-line-soft bg-panel-2/40 p-4">
          <div className="text-xs text-muted">整体平均正确率</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {overall.answered > 0
              ? percent(overall.correct, overall.answered)
              : '—'}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-faint">
            累计 {overall.answered} 题 · 答对 {overall.correct} 题
          </div>
          <Progress className="mt-3" value={overall.accuracy} />
          <div className="mt-2 text-[10px] leading-4 text-faint">
            最近 7 天共 {total7} 题
          </div>
        </div>
      </div>
    </Card>
  );
}
