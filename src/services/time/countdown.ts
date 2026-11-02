import { formatInTimeZone } from 'date-fns-tz';
import datesConfig from '../../../config/dates.json';
import rulesConfig from '../../../config/exam_rules.json';

export type RegistrationStatus = 'not_open' | 'open' | 'registered' | 'missed';

export interface PhaseRule {
  id: string;
  label: string;
  min_days_exclusive?: number;
  min_days_inclusive?: number;
  max_days_inclusive?: number;
  ui?: {
    show_score_estimate?: boolean;
    show_only_cumulative?: boolean;
    hide_full_mock?: boolean;
    weekly_timed_mock?: boolean;
    exam_mode?: boolean;
    hide_explanations?: boolean;
    allow_pause?: boolean;
    mock_every_n_days?: number;
    new_content?: boolean;
    read_only?: boolean;
    focus?: string[];
  };
}

const phaseRules = rulesConfig.phases.rules as unknown as PhaseRule[];

export function todayKey(now: Date = new Date()): string {
  return formatInTimeZone(now, datesConfig.timezone, 'yyyy-MM-dd');
}

export function calendarDaysBetween(from: string, to: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function resolvePhase(daysUntilExam: number): PhaseRule {
  const found = phaseRules.find((rule) => {
    const aboveExclusive =
      rule.min_days_exclusive === undefined ||
      daysUntilExam > rule.min_days_exclusive;
    const aboveInclusive =
      rule.min_days_inclusive === undefined ||
      daysUntilExam >= rule.min_days_inclusive;
    const belowMax =
      rule.max_days_inclusive === undefined ||
      daysUntilExam <= rule.max_days_inclusive;
    return aboveExclusive && aboveInclusive && belowMax;
  });

  return found ?? phaseRules[phaseRules.length - 1];
}

export function resolveRegistrationStatus(
  today: string,
  registered: boolean,
): RegistrationStatus {
  if (registered) return 'registered';
  if (today < datesConfig.registration_start) return 'not_open';
  if (today <= datesConfig.registration_end) return 'open';
  return 'missed';
}

export interface Countdown {
  today: string;
  daysToExam: number;
  daysToRegistrationStart: number;
  daysToRegistrationEnd: number;
  registrationStatus: RegistrationStatus;
  phase: PhaseRule;
  planProgress: number;
  planStartDate: string;
  examDate: string;
  registrationStart: string;
  registrationEnd: string;
  backupExamDate: string;
}

export function getCountdown(
  now: Date = new Date(),
  registered = false,
): Countdown {
  const today = todayKey(now);
  const daysToExam = calendarDaysBetween(today, datesConfig.exam_date);
  const planStart = datesConfig.plan_start_date;
  const totalDays = Math.max(
    1,
    calendarDaysBetween(planStart, datesConfig.exam_date),
  );
  const elapsedDays = calendarDaysBetween(planStart, today);
  const planProgress = Math.min(1, Math.max(0, elapsedDays / totalDays));

  return {
    today,
    daysToExam,
    daysToRegistrationStart: calendarDaysBetween(
      today,
      datesConfig.registration_start,
    ),
    daysToRegistrationEnd: calendarDaysBetween(
      today,
      datesConfig.registration_end,
    ),
    registrationStatus: resolveRegistrationStatus(today, registered),
    phase: resolvePhase(daysToExam),
    planProgress,
    planStartDate: planStart,
    examDate: datesConfig.exam_date,
    registrationStart: datesConfig.registration_start,
    registrationEnd: datesConfig.registration_end,
    backupExamDate: datesConfig.backup_exam_date,
  };
}

const PHASE_FOCUS: Record<string, string> = {
  foundation: '累積詞彙與輸入量，先把「每天打開」變成習慣。',
  intensive: '按錯因分配訓練量，每週一次計時模擬。',
  mock: '每兩天一套完整題，練習板塊時間分配與考試節奏。',
  sprint: '只做錯題、高頻詞與個人語料，不開新題。',
  archived: '資料已封存，可回顧與匯出。',
};

export function phaseFocus(phaseId: string): string {
  return PHASE_FOCUS[phaseId] ?? '';
}

export function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${year}/${month}/${day}`;
}

export function weekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('zh-TW', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}
