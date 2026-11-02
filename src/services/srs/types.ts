import type { ReviewGrade, ReviewItemType } from '../../db/types';

export type SrsGrade = ReviewGrade;

export interface SrsRules {
  ladder_days: number[];
  daily_new_words: number;
  daily_review_cap: number;
  baseline_window_days: number;
  baseline_floor: number;
  backlog_trigger_days: number;
  backlog_spread_days: number;
  backlog_allocation: number[];
  backlog_overload_factor: number;
  pause_new_words_backlog_factor: number;
  pause_new_words_days_after_backlog: number;
  stop_new_words_days_before_exam: number;
  core_only_days_before_exam: number;
  core_frequency_rank_max: number;
  core_lapses_min: number;
  clamp_days_before_exam: number;
}

export interface SrsReview {
  id?: number;
  itemType: ReviewItemType;
  itemId: string;
  stage: number;
  dueAt: string;
  suspended: boolean;
  backlog: boolean;
  lapses?: number;
  lastReviewedAt?: string | null;
  introducedAt?: string;
}

export interface SrsWord {
  id: string;
  frequencyRank?: number | null;
}

export interface GradeInput {
  stage: number;
  lapses?: number;
  grade: SrsGrade;
  today: string;
  examClamp: string;
}

export interface GradeResult {
  stage: number;
  intervalDays: number;
  dueAt: string;
  lapses: number;
}

export interface QueueInput {
  today: string;
  reviews: SrsReview[];
  wordsById: Map<string, SrsWord>;
  reviewedTodayIds: Set<string>;
  cap: number;
  completedToday: number;
}

export interface QueueResult {
  queue: SrsReview[];
  dueCount: number;
  remaining: number;
}

export interface BackfillInput {
  today: string;
  examClamp: string;
  reviews: SrsReview[];
  wordsById: Map<string, SrsWord>;
  reviewedTodayIds: Set<string>;
  dailyReviewCounts: number[];
  rules: SrsRules;
  daysUntilExam: number;
}

export interface BackfillAssignment {
  review: SrsReview;
  dueAt: string;
  backlog: boolean;
}

export interface BackfillPlan {
  assignments: BackfillAssignment[];
  pausedUntil: string;
  scheduled: number;
  overflow: number;
  spread: boolean;
}

export interface PolicyInput {
  today: string;
  examClamp: string;
  daysUntilExam: number;
  reviews: SrsReview[];
  wordsById: Map<string, SrsWord>;
  rules: SrsRules;
}

export interface PolicyPlan {
  suspensions: { review: SrsReview; reason: 'exam_core_only' }[];
  dueAtClamps: { review: SrsReview; dueAt: string }[];
  newWordsPausedUntil: string | null;
}
