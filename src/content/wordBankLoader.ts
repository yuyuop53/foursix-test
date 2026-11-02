import {
  WordBankFileSchema,
  normalizeLemma,
  type WordBankEntry,
} from './wordBankSchema';

const files = import.meta.glob('../../content/words/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface WordBankLoadError {
  file: string;
  message: string;
}

export interface WordBankLoadResult {
  entries: WordBankEntry[];
  errors: WordBankLoadError[];
}

export function loadWordBank(): WordBankLoadResult {
  const entries: WordBankEntry[] = [];
  const errors: WordBankLoadError[] = [];
  const fileNames = Object.keys(files).sort();

  for (const file of fileNames) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(files[file]);
    } catch (error) {
      errors.push({
        file,
        message: `JSON 解析失敗：${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const parsed = WordBankFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      errors.push({
        file,
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('；'),
      });
      continue;
    }

    if (parsed.data.count !== parsed.data.entries.length) {
      errors.push({
        file,
        message: `count=${parsed.data.count} 與實際 ${parsed.data.entries.length} 筆不一致`,
      });
    }

    entries.push(...parsed.data.entries);
  }

  const seenIds = new Set<string>();
  const seenLemmas = new Set<string>();
  const seenRanks = new Set<number>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      errors.push({ file: '(all)', message: `id 重複：${entry.id}` });
    }
    seenIds.add(entry.id);

    const lemmaKey = normalizeLemma(entry.lemma);
    if (seenLemmas.has(lemmaKey)) {
      errors.push({ file: '(all)', message: `lemma 重複：${entry.lemma}` });
    }
    seenLemmas.add(lemmaKey);

    if (seenRanks.has(entry.frequencyRank)) {
      errors.push({
        file: '(all)',
        message: `frequencyRank 重複：${entry.frequencyRank}`,
      });
    }
    seenRanks.add(entry.frequencyRank);
  }

  const coreEntries = entries.filter((entry) => entry.band === 'core_500');
  if (coreEntries.length === 500) {
    const missing: number[] = [];
    for (let rank = 1; rank <= 500; rank += 1) {
      if (!seenRanks.has(rank)) missing.push(rank);
    }
    if (missing.length > 0) {
      errors.push({
        file: '(all)',
        message: `core_500 缺少 frequencyRank：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      });
    }
  }

  entries.sort((a, b) => a.frequencyRank - b.frequencyRank);

  return { entries, errors };
}

export function getWordBankFileCount(): number {
  return Object.keys(files).length;
}

export function getWordBankRawFileNames(): string[] {
  return Object.keys(files).sort();
}
