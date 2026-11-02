import { db } from '../db/db';
import { normalizeWord } from './localWords';

export interface WordLookupResult {
  word: string;
  definition: string;
  phonetic: string | null;
}

interface LocalDictionaryEntry {
  p?: string;
  t: string;
}

interface LocalDictionaryFile {
  entries: Record<string, LocalDictionaryEntry>;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'are',
  'was', 'were', 'be', 'been', 'it', 'this', 'that', 'with', 'for',
  'as', 'at', 'by', 'from', 'we', 'you', 'they', 'he', 'she', 'i',
]);

let dictionaryPromise: Promise<Map<string, LocalDictionaryEntry>> | null =
  null;

function loadLocalDictionary(): Promise<Map<string, LocalDictionaryEntry>> {
  if (!dictionaryPromise) {
    dictionaryPromise = fetch('/dictionary/cet4.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`本地词典加载失败：HTTP ${response.status}`);
        }
        return response.json() as Promise<LocalDictionaryFile>;
      })
      .then((data) => new Map(Object.entries(data.entries)))
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }
  return dictionaryPromise;
}

function stems(word: string): string[] {
  const out = [word];
  if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) out.push(word.slice(0, -2));
  if (word.endsWith('s')) out.push(word.slice(0, -1));
  if (word.endsWith('ing')) {
    out.push(word.slice(0, -3));
    out.push(`${word.slice(0, -3)}e`);
  }
  if (word.endsWith('ed')) {
    out.push(word.slice(0, -2));
    out.push(word.slice(0, -1));
    out.push(`${word.slice(0, -2)}e`);
  }
  if (word.endsWith('ly')) out.push(word.slice(0, -2));
  return out;
}

function candidates(text: string): string[] {
  const normalized = normalizeWord(text);
  const all = [normalized];
  for (const token of normalized.split(' ')) {
    if (!token || STOPWORDS.has(token)) continue;
    all.push(...stems(token));
  }
  return Array.from(new Set(all.filter(Boolean)));
}

export async function lookupWordDefinition(
  text: string,
  options: { sentenceInitial?: boolean } = {},
): Promise<WordLookupResult | null> {
  const exact = text.trim();
  const isCapitalized = /^[A-Z][A-Za-z'-]*$/.test(exact);
  const words = candidates(text);

  // A capitalized word in the middle of a sentence is usually a proper noun.
  // Do not map it onto a lowercase common word (e.g. Bach != "bach").
  const properNounCandidate = isCapitalized && !options.sentenceInitial;

  if (!properNounCandidate) {
    // Prefer the curated 500-word bank (richer phonetics and meanings).
    for (const candidate of words) {
      const entry = await db.wordBank.where('lemma').equals(candidate).first();
      if (entry) {
        return {
          word: entry.lemma,
          definition: `${entry.pos.join(' ')} ${entry.meanings.zh.join('；')}`.trim(),
          phonetic: entry.phonetics?.us ?? entry.phonetics?.uk ?? null,
        };
      }
    }
  }

  // Fall back to the bundled local CET-4 / high-frequency dictionary.
  const dictionary = await loadLocalDictionary();

  const exactEntry = dictionary.get(exact);
  if (exactEntry) {
    return {
      word: exact,
      definition: exactEntry.t,
      phonetic: exactEntry.p || null,
    };
  }

  if (properNounCandidate) return null;

  for (const candidate of words) {
    const entry = dictionary.get(candidate);
    if (entry) {
      return {
        word: candidate,
        definition: entry.t,
        phonetic: entry.p || null,
      };
    }
  }

  return null;
}
