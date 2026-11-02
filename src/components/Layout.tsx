import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getCountdown } from '../services/time/countdown';
import {
  useExamLevel,
  type ExamLevel,
} from '../services/examLevel';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', label: '首頁', end: true },
  { to: '/exams', label: '閱讀' },
  { to: '/listening', label: '聽力' },
  { to: '/translation', label: '翻譯' },
  { to: '/review', label: '複習' },
  { to: '/mistakes', label: '錯題' },
  { to: '/words', label: '生詞' },
  { to: '/import', label: '匯入' },
  { to: '/preview', label: '預覽' },
];

export default function Layout() {
  const profile = useLiveQuery(() => db.profile.get('me'), []);
  const countdown = getCountdown(new Date(), profile?.registered ?? false);
  const [level, setLevel] = useExamLevel();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.examLevel = level;
    if (level === 'CET6') {
      root.style.setProperty('--color-accent', '#fb923c');
      root.style.setProperty('--color-accent-2', '#f97316');
    } else {
      root.style.setProperty('--color-accent', '#5eead4');
      root.style.setProperty('--color-accent-2', '#38bdf8');
    }
  }, [level]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-[0.22em] text-ink">
              CET<span className="text-accent">·</span>LAB
            </span>
            <span className="hidden text-[10px] tracking-widest text-faint sm:inline">
              {level === 'CET6' ? '六級備考' : '四級備考'}
            </span>
          </NavLink>

          <div
            className="flex rounded-full border border-line bg-panel p-0.5 text-[11px]"
            role="group"
            aria-label="考試級別"
          >
            {(['CET4', 'CET6'] as const).map((item: ExamLevel) => (
              <button
                key={item}
                type="button"
                onClick={() => setLevel(item)}
                className={cn(
                  'rounded-full px-2.5 py-1 transition-colors',
                  level === item
                    ? 'bg-accent text-surface'
                    : 'text-muted hover:text-ink',
                )}
                aria-pressed={level === item}
              >
                {item === 'CET4' ? 'CET-4' : 'CET-6'}
              </button>
            ))}
          </div>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-ink',
                    isActive && 'bg-panel-2 text-accent',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] tabular-nums',
              countdown.daysToExam < 0
                ? 'border-line text-muted'
                : countdown.daysToExam <= 7
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : countdown.daysToExam <= 30
                    ? 'border-warn/40 bg-warn/10 text-warn'
                    : 'border-accent/30 bg-accent/10 text-accent',
            )}
            title={
              level === 'CET6'
                ? 'CET-6 考試日期尚未設定'
                : '距 CET-4 考試'
            }
          >
            {level === 'CET6'
              ? 'CET-6'
              : countdown.daysToExam < 0
                ? '已封存'
                : `D-${countdown.daysToExam}`}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-line-soft px-4 py-5 text-center text-[11px] leading-5 text-faint">
        <p>
          CET-Lab · 本地優先、資料留在你的瀏覽器。考試日期與考情參數皆為預估，非官方公告。
        </p>
        <p className="mt-1">
          內容僅供個人學習；請使用自行鍵入或合法持有的素材。
        </p>
      </footer>
    </div>
  );
}
