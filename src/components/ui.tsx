import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-surface hover:bg-accent/90 active:bg-accent/80 shadow-[0_8px_24px_-12px_rgba(94,234,212,0.6)]',
  secondary:
    'border border-line bg-panel-2 text-ink hover:border-accent/50 hover:text-accent',
  ghost: 'text-muted hover:bg-panel-2 hover:text-ink',
  danger:
    'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-panel shadow-[0_18px_60px_-38px_rgba(0,0,0,0.95)]',
        className,
      )}
      {...props}
    />
  );
}

type BadgeTone = 'accent' | 'muted' | 'warn' | 'danger' | 'ok' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  accent: 'border-accent/30 bg-accent/10 text-accent',
  muted: 'border-line bg-panel-2 text-muted',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  violet: 'border-violet/30 bg-violet/10 text-violet',
};

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tones: Record<string, string> = {
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
  };
  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-panel-2', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="關閉">
            ✕
          </Button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = '◇',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-panel/50 px-6 py-14 text-center">
      <div className="text-3xl text-faint">{icon}</div>
      <div className="text-base font-medium text-ink">{title}</div>
      {description ? (
        <p className="max-w-md text-sm leading-6 text-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'danger';
}) {
  const valueTone =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'danger'
        ? 'text-danger'
        : 'text-ink';
  return (
    <Card className="p-4">
      <div className="text-xs tracking-wide text-muted">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', valueTone)}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
    </Card>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.22em] text-accent/80">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Tag({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px]',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}
