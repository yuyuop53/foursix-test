export interface TranslationDimension {
  key: 'content' | 'logic' | 'language';
  label: string;
  score: number;
}

export interface TranslationGrade {
  total: number;
  band: string;
  dimensions: TranslationDimension[];
  isPass: boolean;
  wordCount: number;
  referenceWordCount: number;
  sentenceCount: number;
  referenceSentenceCount: number;
  keywordTotal: number;
  keywordMatched: string[];
  keywordMissing: string[];
  connectiveHits: string[];
  structureHits: string[];
  suggestions: string[];
  reference: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that', 'these',
  'those', 'with', 'for', 'as', 'at', 'by', 'from', 'we', 'you', 'they',
  'he', 'she', 'i', 'its', 'their', 'his', 'her', 'our', 'your', 'has',
  'have', 'had', 'will', 'would', 'can', 'could', 'may', 'might', 'should',
  'not', 'no', 'so', 'than', 'then', 'there', 'here', 'which', 'who',
  'whom', 'what', 'when', 'where', 'why', 'how', 'more', 'most', 'some',
  'any', 'all', 'also', 'into', 'over', 'under', 'about', 'across',
]);

const CONNECTIVES = [
  'in recent years',
  'for instance',
  'for example',
  'while',
  'however',
  'therefore',
  'moreover',
  'furthermore',
  'such as',
  'as well as',
];

const STRUCTURES: Array<{ label: string; regex: RegExp }> = [
  {
    label: '现在完成进行时（has been developing）',
    regex: /\b(has|have)\s+been\s+(?:\w+\s+){0,2}[a-z]+ing\b/i,
  },
  {
    label: '分词结构（allowing / becoming / making）',
    regex:
      /\b(allowing|becoming|making|attracting|experiencing|leveraging|developing|creating|including|providing)\b/i,
  },
  {
    label: 'What was once ... 结构',
    regex: /\bwhat\s+was\s+once\b/i,
  },
  {
    label: '定语/从句结构（which / who / that）',
    regex: /\b(which|who|that)\b/i,
  },
];

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

function words(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map((word) => word.toLowerCase());
}

function contentKeywords(text: string): string[] {
  return Array.from(
    new Set(
      words(text).filter(
        (word) => word.length >= 3 && !STOPWORDS.has(word),
      ),
    ),
  );
}

function stems(word: string): string[] {
  const out = [word];
  if (word.endsWith("'s") || word.endsWith('’s')) {
    out.push(word.slice(0, -2));
  }
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

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function extractReference(explanation?: string | null): string {
  const text = (explanation ?? '').trim();
  if (!text) return '';
  const marker = '参考译文：';
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const rest = text.slice(start + marker.length);
  const end = rest.indexOf('译点提示：');
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

function bandFor(total: number): string {
  if (total >= 13) return '13–15 分档 · 优秀';
  if (total >= 10) return '10–12 分档 · 良好';
  if (total >= 7) return '7–9 分档 · 及格';
  if (total >= 4) return '4–6 分档 · 需加强';
  return '0–3 分档 · 需重练';
}

export function gradeTranslation(
  userText: string,
  referenceText: string,
): TranslationGrade {
  const reference = referenceText.trim();
  const userWords = words(userText);
  const referenceWords = words(reference);
  const userWordSet = new Set(userWords);
  const userStemSet = new Set(userWords.flatMap(stems));

  const referenceKeywords = contentKeywords(reference);
  const keywordMatched: string[] = [];
  const keywordMissing: string[] = [];

  for (const keyword of referenceKeywords) {
    const variants = [keyword, ...stems(keyword)];
    const hit = variants.some(
      (variant) =>
        userWordSet.has(variant) || userStemSet.has(variant),
    );
    (hit ? keywordMatched : keywordMissing).push(keyword);
  }

  const userSentences = sentenceCount(userText);
  const referenceSentences = sentenceCount(reference);
  const lowerText = userText.toLowerCase();
  const connectiveHits = CONNECTIVES.filter((connective) =>
    lowerText.includes(connective),
  );
  const structureHits = STRUCTURES.filter((structure) =>
    structure.regex.test(userText),
  ).map((structure) => structure.label);

  const coverage =
    keywordMatched.length / Math.max(1, referenceKeywords.length);
  const lengthFactor = Math.min(
    1.2,
    userWords.length / Math.max(1, referenceWords.length),
  );

  const content = clamp(
    Math.round(coverage * 5 * (lengthFactor < 0.6 ? 0.75 : 1)),
    0,
    5,
  );
  const sentenceRatio = Math.min(
    1,
    userSentences / Math.max(1, referenceSentences),
  );
  const logic = clamp(
    Math.round(sentenceRatio * 3 + Math.min(2, connectiveHits.length * 0.7)),
    0,
    5,
  );
  const lengthScore =
    lengthFactor >= 0.8 && lengthFactor <= 1.25
      ? 3
      : lengthFactor < 0.5
        ? 1
        : 2;
  const language = clamp(
    Math.round(lengthScore + Math.min(2, structureHits.length * 0.7)),
    0,
    5,
  );

  const total = content + logic + language;
  const suggestions: string[] = [];

  if (keywordMissing.length > 0) {
    suggestions.push(
      `关键信息覆盖不足，建议补上：${keywordMissing
        .slice(0, 6)
        .join('、')}。`,
    );
  }
  if (lengthFactor < 0.7) {
    suggestions.push(
      `译文偏短（约 ${userWords.length} 词，参考约 ${referenceWords.length} 词），注意不要漏译。`,
    );
  } else if (lengthFactor > 1.4) {
    suggestions.push('译文偏长，注意避免重复表达或逐字直译。');
  }
  if (userSentences < referenceSentences - 1) {
    suggestions.push(
      `句子偏少（${userSentences} / ${referenceSentences} 句），注意拆分长句、保持层次。`,
    );
  }
  if (connectiveHits.length === 0) {
    suggestions.push(
      '建议使用连接词（如 In recent years / For instance / while）串联信息。',
    );
  }
  if (!structureHits.some((hit) => hit.includes('现在完成进行时'))) {
    suggestions.push(
      '可尝试使用现在完成进行时，例如 has been developing...。',
    );
  }
  if (!structureHits.some((hit) => hit.includes('分词'))) {
    suggestions.push(
      '可尝试使用分词结构，例如 allowing visitors to... / becoming a popular destination。',
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(
      '整体信息完整、结构清晰；可继续润色词汇搭配与句式多样性。',
    );
  }

  return {
    total,
    band: bandFor(total),
    dimensions: [
      { key: 'content', label: '内容', score: content },
      { key: 'logic', label: '逻辑', score: logic },
      { key: 'language', label: '语言', score: language },
    ],
    isPass: total >= 7,
    wordCount: userWords.length,
    referenceWordCount: referenceWords.length,
    sentenceCount: userSentences,
    referenceSentenceCount: referenceSentences,
    keywordTotal: referenceKeywords.length,
    keywordMatched,
    keywordMissing,
    connectiveHits,
    structureHits,
    suggestions: suggestions.slice(0, 4),
    reference,
  };
}
