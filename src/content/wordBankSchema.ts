import { z } from 'zod';

export const WORD_BANK_POS = [
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'det.',
  'phr.',
] as const;

export const WORD_BANK_BANDS = [
  'core_500',
  'core_2000',
  'extended_4500',
] as const;

export const WordBankEntrySchema = z.object({
  id: z.string().regex(/^wb_[a-z0-9_]+$/),
  lemma: z.string().min(1).max(80),
  phonetics: z
    .object({
      us: z.string().min(1).max(80).optional(),
      uk: z.string().min(1).max(80).optional(),
    })
    .optional(),
  pos: z.array(z.enum(WORD_BANK_POS)).min(1),
  meanings: z.object({
    zh: z.array(z.string().min(1).max(200)).min(1),
    en: z.array(z.string().min(1).max(300)).min(1),
  }),
  example: z.object({
    sentence: z.string().min(1).max(500),
    translation: z.string().min(1).max(500),
  }),
  collocations: z.array(z.string().min(1).max(120)).optional(),
  wordFamily: z
    .array(
      z.object({
        lemma: z.string().min(1).max(80),
        pos: z.enum(WORD_BANK_POS),
      }),
    )
    .optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  frequencyRank: z.number().int().min(1).max(100_000),
  band: z.enum(WORD_BANK_BANDS),
  source: z
    .object({
      name: z.string().min(1).max(120),
      license: z.string().min(1).max(80),
    })
    .optional(),
  notes: z.string().max(500).optional(),
});

export const WordBankFileSchema = z.object({
  schemaVersion: z.literal('1.0'),
  count: z.number().int().min(1),
  entries: z.array(WordBankEntrySchema).min(1),
});

export type WordBankEntry = z.infer<typeof WordBankEntrySchema>;
export type WordBankFile = z.infer<typeof WordBankFileSchema>;

export function normalizeLemma(lemma: string): string {
  return lemma.trim().toLowerCase().replace(/\s+/g, ' ');
}
