export type DictationDiffType = 'equal' | 'missing' | 'extra' | 'replace';

export interface DictationDiffOp {
  type: DictationDiffType;
  reference?: string;
  actual?: string;
}

export interface DictationScore {
  normalizedReference: string;
  normalizedInput: string;
  referenceTokens: string[];
  actualTokens: string[];
  diff: DictationDiffOp[];
  correctWords: number;
  referenceWords: number;
  actualWords: number;
  accuracy: number;
  isExact: boolean;
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'is not'],
  [/\blet's\b/g, 'let us'],
  [/\bi'm\b/g, 'i am'],
  [/\b(we|they|you)'re\b/g, '$1 are'],
  [/\b(he|she|it)'s\b/g, '$1 is'],
  [/\b(that|there|what|who|where|when|why|how)'s\b/g, '$1 is'],
  [/\b(i|we|they|you)'ve\b/g, '$1 have'],
  [/\b(i|we|they|you|he|she)'ll\b/g, '$1 will'],
  [/\b(i|we|they|you|he|she)'d\b/g, '$1 would'],
  [/\b(\w+)n't\b/g, '$1 not'],
];

export function normalizeDictation(text: string): string {
  let value = text.normalize('NFKC').toLowerCase();
  value = value.replace(/[’‘]/g, "'").replace(/[–—]/g, '-');

  for (const [pattern, replacement] of CONTRACTIONS) {
    value = value.replace(pattern, replacement);
  }

  value = value.replace(/(?<=\d),(?=\d)/g, '');
  value = value.replace(/'/g, '');
  value = value.replace(/[^a-z0-9\s]/g, ' ');
  return value.replace(/\s+/g, ' ').trim();
}

export function tokenizeDictation(text: string): string[] {
  const normalized = normalizeDictation(text);
  return normalized ? normalized.split(' ') : [];
}

export function diffDictation(
  reference: string,
  actual: string,
): DictationDiffOp[] {
  const ref = tokenizeDictation(reference);
  const act = tokenizeDictation(actual);
  return diffTokens(ref, act);
}

export function diffTokens(
  ref: string[],
  actual: string[],
): DictationDiffOp[] {
  const rows = ref.length + 1;
  const cols = actual.length + 1;
  const table: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i][j] =
        ref[i - 1] === actual[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const reversed: DictationDiffOp[] = [];
  let i = ref.length;
  let j = actual.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === actual[j - 1]) {
      reversed.push({
        type: 'equal',
        reference: ref[i - 1],
        actual: actual[j - 1],
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || table[i - 1][j] >= table[i][j - 1])) {
      reversed.push({ type: 'missing', reference: ref[i - 1] });
      i -= 1;
    } else {
      reversed.push({ type: 'extra', actual: actual[j - 1] });
      j -= 1;
    }
  }

  reversed.reverse();
  return coalesceReplacements(reversed);
}

export function scoreDictation(
  reference: string,
  actual: string,
): DictationScore {
  const normalizedReference = normalizeDictation(reference);
  const normalizedInput = normalizeDictation(actual);
  const referenceTokens = normalizedReference
    ? normalizedReference.split(' ')
    : [];
  const actualTokens = normalizedInput ? normalizedInput.split(' ') : [];
  const diff = diffTokens(referenceTokens, actualTokens);
  const correctWords = diff.filter((op) => op.type === 'equal').length;
  const denominator = Math.max(referenceTokens.length, actualTokens.length);
  const accuracy =
    denominator === 0
      ? 0
      : Math.round((correctWords / denominator) * 10000) / 10000;

  return {
    normalizedReference,
    normalizedInput,
    referenceTokens,
    actualTokens,
    diff,
    correctWords,
    referenceWords: referenceTokens.length,
    actualWords: actualTokens.length,
    accuracy,
    isExact: normalizedReference === normalizedInput,
  };
}

function coalesceReplacements(
  ops: DictationDiffOp[],
): DictationDiffOp[] {
  const merged: DictationDiffOp[] = [];

  for (let index = 0; index < ops.length; index += 1) {
    const current = ops[index];
    const next = ops[index + 1];

    if (current.type === 'missing' && next?.type === 'extra') {
      merged.push({
        type: 'replace',
        reference: current.reference,
        actual: next.actual,
      });
      index += 1;
      continue;
    }

    if (current.type === 'extra' && next?.type === 'missing') {
      merged.push({
        type: 'replace',
        reference: next.reference,
        actual: current.actual,
      });
      index += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}
