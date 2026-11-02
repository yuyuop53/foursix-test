import { z } from 'zod';

export const SECTIONS = [
  'reading',
  'listening',
  'writing',
  'translation',
  'speaking',
] as const;

export const HOT_TOPICS = [
  'ai_ethics',
  'climate_change',
  'remote_work',
  'mental_health',
  'new_energy',
  'tech_ethics',
  'aging_population',
  'urbanization',
  'digital_economy',
  'biodiversity',
  'education_technology',
  'public_health',
  'unclassified',
] as const;

export const KNOWLEDGE_TAGS = [
  'main_idea',
  'detail',
  'inference',
  'attitude',
  'vocabulary_in_context',
  'text_structure',
  'signposting',
  'paraphrase',
  'listening_detail',
  'listening_inference',
  'listening_attitude',
  'logic_gap',
  'cohesion',
] as const;

export const ERROR_CAUSES = [
  'lexical',
  'grammar',
  'locating',
  'inference',
  'time_pressure',
  'carelessness',
] as const;

export const QUESTION_TYPES = [
  'detail',
  'inference',
  'attitude',
  'main_idea',
  'vocabulary_in_context',
  'text_structure',
  'listening_detail',
  'listening_inference',
  'listening_attitude',
  'signposting',
  'paraphrase',
  'banked_cloze',
  'translation',
  'writing_task',
] as const;

export const SectionSchema = z.enum(SECTIONS);
export const HotTopicSchema = z.enum(HOT_TOPICS);
export const KnowledgeTagSchema = z.enum(KNOWLEDGE_TAGS);
export const ErrorCauseSchema = z.enum(ERROR_CAUSES);
export const QuestionTypeSchema = z.enum(QUESTION_TYPES);

export const ExamSchema = z.object({
  id: z.string().regex(/^exam_[a-z0-9_-]+$/),
  title: z.string().min(1).max(200),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  set: z.string().regex(/^[a-z0-9_-]+$/),
  source: z.enum(['user-entered', 'original', 'licensed', 'public-domain']),
  license: z.string().min(1).max(100),
  content_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sections: z.array(SectionSchema).min(1),
});

export const OptionSchema = z.object({
  key: z.string().regex(/^[A-O]$/),
  text: z.string().min(1).max(1000),
});

export const EvidenceSchema = z
  .object({
    paragraph: z.number().int().min(1).optional(),
    sentence: z.number().int().min(1).optional(),
    segment: z.number().int().min(0).optional(),
    quote: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (e) =>
      (e.paragraph !== undefined && e.sentence !== undefined) ||
      e.segment !== undefined,
    { message: 'evidence 需要 paragraph+sentence 或 segment' },
  );

export const AudioSpanSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
});

export const PassageSchema = z.object({
  id: z.string().regex(/^psg_[a-z0-9_-]+$/),
  exam_id: z.string().regex(/^exam_[a-z0-9_-]+$/),
  section: SectionSchema,
  subtype: z.enum(['careful_reading', 'banked_cloze']).default('careful_reading'),
  order: z.number().int().min(1),
  title: z.string().min(1).max(200),
  body_md: z.string().min(1),
  word_count: z.number().int().min(1),
  hot_topic_tags: z.array(HotTopicSchema),
  word_bank: z.array(OptionSchema).optional(),
  audio_asset_id: z.string().regex(/^aud_[a-z0-9_-]+$/).nullable().optional(),
  accent: z
    .enum(['us', 'british', 'australian', 'canadian', 'other'])
    .nullable()
    .optional(),
  wpm: z.number().min(80).max(220).nullable().optional(),
  transcript: z.string().min(1).nullable().optional(),
  transcript_zh: z.string().min(1).nullable().optional(),
});

export const QuestionSchema = z.object({
  id: z.string().regex(/^q_[a-z0-9_-]+$/),
  exam_id: z.string().regex(/^exam_[a-z0-9_-]+$/),
  passage_id: z.string().regex(/^psg_[a-z0-9_-]+$/),
  section: SectionSchema,
  type: QuestionTypeSchema,
  stem: z.string().min(1).max(2000),
  // 15 covers paragraph-matching questions (A–O) as well as standard MCQ.
  options: z.array(OptionSchema).min(2).max(15).optional(),
  answer: z.string().min(1).max(200),
  explanation: z.string().min(1).max(5000),
  evidence: z.array(EvidenceSchema).min(1),
  knowledge_tags: z.array(KnowledgeTagSchema).min(1),
  error_cause_tags: z.array(ErrorCauseSchema).min(1),
  hot_topic_tags: z.array(HotTopicSchema),
  difficulty: z.number().int().min(1).max(5),
  blank_index: z.number().int().min(1).optional(),
  audio_span: AudioSpanSchema.nullable().optional(),
  generated: z.boolean().optional(),
});

export const SegmentSchema = z.object({
  index: z.number().int().min(0),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  text: z.string().min(1).max(2000),
  textZh: z.string().min(1).max(2000).optional(),
});

export const AssetSchema = z
  .object({
    id: z.string().regex(/^(aud|img)_[a-z0-9_-]+$/),
    kind: z.enum(['audio', 'image']),
    backend: z.enum(['local', 'url', 'tts']),
    src: z.string().min(1).max(2000).optional().default(''),
    accent: z
      .enum(['us', 'british', 'australian', 'canadian', 'other'])
      .nullable()
      .optional(),
    wpm: z.number().min(80).max(220).nullable().optional(),
    synthetic: z.boolean().optional(),
    license: z.string().min(1).max(200),
    duration_sec: z.number().min(0).optional(),
    segments: z.array(SegmentSchema).optional(),
  })
  .superRefine((asset, ctx) => {
    if (asset.backend !== 'tts' && !asset.src) {
      ctx.addIssue({
        code: 'custom',
        message: '非 TTS 音頻必須提供 src',
        path: ['src'],
      });
    }

    if (asset.backend !== 'tts' && asset.segments) {
      let previousEnd = -1;
      asset.segments.forEach((segment, index) => {
        if (segment.start === undefined || segment.end === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `segment ${index} 需要 start/end`,
            path: ['segments', index],
          });
          return;
        }
        if (segment.end <= segment.start || segment.start < previousEnd) {
          ctx.addIssue({
            code: 'custom',
            message: `segment ${index} 的時間不正確`,
            path: ['segments', index],
          });
        }
        previousEnd = segment.end;
      });
    }
  });

export const ExamBundleSchema = z.object({
  schema_version: z.enum(['1.0', '1.1']),
  exam: ExamSchema,
  passages: z.array(PassageSchema).min(1),
  questions: z.array(QuestionSchema).min(1),
  assets: z.array(AssetSchema),
});

export type Section = z.infer<typeof SectionSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type Passage = z.infer<typeof PassageSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type ExamBundle = z.infer<typeof ExamBundleSchema>;
export type AudioSpan = z.infer<typeof AudioSpanSchema>;
