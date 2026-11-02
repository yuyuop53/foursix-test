import type {
  AudioSpan,
  Evidence,
  Option,
  Section,
} from '../content/schema';
import type { WordBankEntry } from '../content/wordBankSchema';

export type WordBankRecord = WordBankEntry;

export type SessionMode = 'practice' | 'exam' | 'review';
export type MistakeStatus = 'open' | 'mastered';
export type ReviewItemType = 'word' | 'mistake' | 'culture_term';
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface ProfileSrsState {
  lastActiveAt: string | null;
  lastBackfillAt: string | null;
  newWordsPausedUntil: string | null;
  lastPlanDate: string | null;
}

export interface ProfilePreferences {
  ttsVoiceUri?: string | null;
  listeningRate?: number;
  hideChinese?: boolean;
}

export interface ProfileRecord {
  id: 'me';
  targetScore: number;
  dailyMinutes: number;
  registered: boolean;
  createdAt: string;
  srs: ProfileSrsState;
  preferences: ProfilePreferences;
}

export interface ExamRecord {
  id: string;
  title: string;
  year: number;
  month: number;
  set: string;
  source: string;
  license: string;
  contentVersion: string;
  sections: Section[];
}

export interface PassageRecord {
  id: string;
  examId: string;
  section: Section;
  subtype?: 'careful_reading' | 'banked_cloze';
  order: number;
  title: string;
  bodyMd: string;
  wordCount: number;
  hotTopicTags: string[];
  wordBank?: Option[] | null;
  audioAssetId: string | null;
  accent: string | null;
  wpm: number | null;
  transcript: string | null;
  transcriptZh?: string | null;
}

export interface QuestionRecord {
  id: string;
  examId: string;
  passageId: string;
  section: Section;
  type: string;
  stem: string;
  options?: Option[];
  answer: string;
  explanation: string;
  evidence: Evidence[];
  knowledgeTags: string[];
  errorCauseTags: string[];
  hotTopicTags: string[];
  difficulty: number;
  blankIndex?: number | null;
  audioSpan?: AudioSpan | null;
  generated: boolean;
}

export interface AssetRecord {
  id: string;
  kind: 'audio' | 'image';
  backend: 'local' | 'url' | 'tts';
  src: string;
  accent?: string | null;
  wpm?: number | null;
  synthetic: boolean;
  license: string;
  durationSec?: number;
  segments?: {
    index: number;
    start?: number;
    end?: number;
    text: string;
    textZh?: string;
  }[];
}

export interface SessionRecord {
  id: string;
  examId: string;
  mode: SessionMode;
  startedAt: string;
  finishedAt?: string | null;
  correct?: number;
  total?: number;
}

export interface AttemptRecord {
  id?: number;
  sessionId: string;
  examId: string;
  questionId: string;
  mode: SessionMode;
  selected: string;
  isCorrect: boolean;
  createdAt: string;
  timeSpentSec: number;
  phase: string;
}

export interface MistakeRecord {
  id?: number;
  questionId: string;
  examId: string;
  errorCauseTags: string[];
  knowledgeTags: string[];
  hotTopicTags: string[];
  wrongCount: number;
  correctStreak: number;
  status: MistakeStatus;
  firstWrongAt: string;
  lastWrongAt: string;
  lastCorrectAt?: string | null;
  nextReviewAt: string | null;
  note?: string;
}

export interface WordRecord {
  id: string;
  lemma: string;
  meaningZh: string;
  meaningEn?: string | null;
  example?: string | null;
  exampleZh?: string | null;
  sourceQuestionId?: string | null;
  sourceExamId?: string | null;
  sourcePassageId?: string | null;
  sourceSentence?: string | null;
  wordBankId?: string | null;
  origin?: 'bank' | 'user' | 'reading';
  pos?: string[];
  phonetics?: { us?: string; uk?: string } | null;
  collocations?: string[];
  wordFamily?: { lemma: string; pos: string }[];
  tags: string[];
  isHotTerm: boolean;
  frequencyRank?: number | null;
  createdAt: string;
}

export interface ReviewRecord {
  id?: number;
  itemType: ReviewItemType;
  itemId: string;
  stage: number;
  dueAt: string;
  suspended: boolean;
  backlog: boolean;
  updatedAt: string;
  lapses?: number;
  introducedAt?: string;
  lastReviewedAt?: string | null;
  lastGrade?: ReviewGrade | null;
  adjustedAt?: string | null;
  suspendedReason?: 'exam_core_only' | 'backlog_pause' | null;
}

export interface ReviewLogRecord {
  id?: number;
  reviewId: number;
  itemType: ReviewItemType;
  itemId: string;
  reviewedAt: string;
  grade: ReviewGrade;
  prevStage: number;
  newStage: number;
  scheduledFor: string;
  context?: 'review' | 'backfill';
}

export interface GradingRecord {
  id?: number;
  taskType: string;
  attemptGroupId?: string | null;
  createdAt: string;
  band?: number | null;
  templateRatio?: number | null;
  result: unknown;
  engine: string;
  engineVersion: string;
}

export interface SpeakingRecord {
  id?: number;
  promptId: string;
  audioAssetId?: string | null;
  transcript?: string | null;
  scores?: unknown;
  createdAt: string;
}

export interface DictationRecord {
  id?: number;
  passageId: string;
  examId: string;
  assetId: string;
  segmentIndex: number;
  runId: string;
  inputText: string;
  referenceText: string;
  normalizedInput: string;
  normalizedReference: string;
  correctWords: number;
  referenceWords: number;
  actualWords: number;
  accuracy: number;
  playbackCount: number;
  createdAt: string;
}

export interface DailyLogRecord {
  date: string;
  phase: string;
  minutes: number;
  questionsDone: number;
  correctCount: number;
  newWords: number;
  reviewsDone?: number;
  backlogAssigned?: number;
  backlogOverflow?: number;
  note?: string;
}

export interface ContentMetaRecord {
  key: string;
  value: string;
  updatedAt: string;
}

export interface TemplateAllowlistRecord {
  id?: number;
  normPhrase: string;
  detector: string;
  reason?: string;
  createdAt: string;
}

export interface ConfigRecord {
  key: string;
  value: unknown;
}

export interface BlobRecord {
  assetId: string;
  blob: Blob;
}
