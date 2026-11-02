import { parse as parseYaml } from 'yaml';
import {
  ExamBundleSchema,
  type ExamBundle,
  type Passage,
  type Question,
} from './schema';

export class ContentParseError extends Error {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(file ? `${file}：${message}` : message);
    this.name = 'ContentParseError';
  }
}

export interface ParseResult {
  bundle: ExamBundle;
  warnings: string[];
}

export function parseExamMarkdown(raw: string, file = 'exam.md'): ExamBundle {
  return parseExamMarkdownDetailed(raw, file).bundle;
}

export function parseExamMarkdownDetailed(
  raw: string,
  file = 'exam.md',
): ParseResult {
  const normalized = raw
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const frontMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontMatch) {
    throw new ContentParseError('缺少 YAML front matter（檔案需以 --- 開頭）', file);
  }

  let front: Record<string, unknown>;
  try {
    front = (parseYaml(frontMatch[1]) ?? {}) as Record<string, unknown>;
  } catch (error) {
    throw new ContentParseError(
      `front matter YAML 解析失敗：${error instanceof Error ? error.message : String(error)}`,
      file,
    );
  }

  const exam = front.exam as Record<string, unknown> | undefined;
  if (!exam || typeof exam.id !== 'string') {
    throw new ContentParseError('front matter 缺少 exam.id', file);
  }
  const examId = exam.id;

  const body = normalized.slice(frontMatch[0].length);
  const sections = splitPassageSections(body);
  if (sections.length === 0) {
    throw new ContentParseError('找不到任何 ## Passage 區塊', file);
  }

  const warnings: string[] = [];
  const passages: Passage[] = [];
  const questions: Question[] = [];

  sections.forEach((section, index) => {
    const passageFence = section.chunk.match(
      /```yaml\s+passage\s*\n([\s\S]*?)```/,
    );
    if (!passageFence) {
      if (/```json\s+questions/.test(section.chunk)) {
        throw new ContentParseError(
          `「${section.heading}」有題目區塊但沒有 yaml passage 區塊`,
          file,
        );
      }
      return;
    }

    let meta: Record<string, unknown>;
    try {
      meta = (parseYaml(passageFence[1]) ?? {}) as Record<string, unknown>;
    } catch (error) {
      throw new ContentParseError(
        `「${section.heading}」passage YAML 解析失敗：${error instanceof Error ? error.message : String(error)}`,
        file,
      );
    }

    const passageStart = (passageFence.index ?? 0) + passageFence[0].length;
    const questionsFence = section.chunk.match(
      /```json\s+questions\s*\n([\s\S]*?)```/,
    );
    const bodyEnd = questionsFence?.index ?? section.chunk.length;
    let bodyMd = section.chunk.slice(passageStart, bodyEnd).trim();

    if (!bodyMd && typeof meta.transcript === 'string') {
      bodyMd = meta.transcript.trim();
    }

    if (!bodyMd) {
      throw new ContentParseError(
        `「${section.heading}」沒有文章正文或逐字稿`,
        file,
      );
    }

    const computedWords = countWords(bodyMd);
    const declaredWords =
      typeof meta.word_count === 'number' ? meta.word_count : computedWords;
    if (typeof meta.word_count !== 'number') {
      warnings.push(`「${section.heading}」未填 word_count，已自動計算為 ${computedWords}`);
    }

    const passage = {
      id: meta.id,
      exam_id: examId,
      section: meta.section ?? 'reading',
      subtype: meta.subtype ?? 'careful_reading',
      order: meta.order ?? index + 1,
      title: meta.title ?? section.heading,
      body_md: bodyMd,
      word_count: declaredWords,
      hot_topic_tags: meta.hot_topic_tags ?? [],
      word_bank: meta.word_bank ?? undefined,
      audio_asset_id: meta.audio_asset_id ?? null,
      accent: meta.accent ?? null,
      wpm: meta.wpm ?? null,
      transcript: meta.transcript ?? null,
      transcript_zh: meta.transcript_zh ?? null,
    } as Passage;

    passages.push(passage);

    if (!questionsFence) {
      warnings.push(`「${section.heading}」沒有題目區塊`);
      return;
    }

    let parsedQuestions: unknown;
    try {
      parsedQuestions = JSON.parse(questionsFence[1]);
    } catch (error) {
      throw new ContentParseError(
        `「${section.heading}」題目 JSON 解析失敗：${error instanceof Error ? error.message : String(error)}`,
        file,
      );
    }

    if (!Array.isArray(parsedQuestions)) {
      throw new ContentParseError(
        `「${section.heading}」的 questions 必須是陣列`,
        file,
      );
    }

    for (const rawQuestion of parsedQuestions) {
      const q = rawQuestion as Record<string, unknown>;
      if (q.passage_id && q.passage_id !== passage.id) {
        throw new ContentParseError(
          `題目 ${String(q.id)} 的 passage_id 與所屬 passage ${passage.id} 不一致`,
          file,
        );
      }
      if (q.section && q.section !== passage.section) {
        throw new ContentParseError(
          `題目 ${String(q.id)} 的 section 與所屬 passage 不一致`,
          file,
        );
      }

      const merged = {
        id: q.id,
        exam_id: examId,
        passage_id: passage.id,
        section: passage.section,
        type: q.type,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        evidence: q.evidence,
        knowledge_tags: q.knowledge_tags ?? [],
        error_cause_tags: q.error_cause_tags ?? [],
        hot_topic_tags: q.hot_topic_tags ?? passage.hot_topic_tags,
        difficulty: q.difficulty ?? 3,
        blank_index: q.blank_index ?? undefined,
        audio_span: q.audio_span ?? null,
        generated: q.generated ?? false,
      } as Question;

      questions.push(merged);
    }
  });

  if (passages.length === 0) {
    throw new ContentParseError('沒有解析到任何 passage', file);
  }
  if (questions.length === 0) {
    throw new ContentParseError('沒有解析到任何題目', file);
  }

  const assets = Array.isArray(front.assets) ? front.assets : [];

  const candidate = {
    schema_version: front.schema_version ?? '1.0',
    exam,
    passages,
    questions,
    assets,
  };

  const parsed = ExamBundleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ContentParseError(formatZodIssues(parsed.error), file);
  }

  const crossCheck = validateBundle(parsed.data);
  if (crossCheck.errors.length > 0) {
    throw new ContentParseError(crossCheck.errors.join('；'), file);
  }

  return {
    bundle: parsed.data,
    warnings: [...warnings, ...crossCheck.warnings],
  };
}

export function countWords(text: string): number {
  const withoutBlankMarkers = text.replace(/\[\[\d+\]\]/g, ' ');
  return (
    withoutBlankMarkers.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []
  ).length;
}

export function countParagraphs(body: string): number {
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

export function countSentences(paragraph: string): number {
  return (paragraph.match(/[.!?](?=\s|$)/g) ?? []).length;
}

function splitPassageSections(
  body: string,
): { heading: string; chunk: string }[] {
  const headingRegex = /^##\s+(.+)$/gm;
  const matches = [...body.matchAll(headingRegex)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return {
      heading: match[1].trim(),
      chunk: body.slice(start, end),
    };
  });
}

function formatZodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('；');
}

function validateBundle(bundle: ExamBundle): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const passageIds = new Set<string>();
  const questionIds = new Set<string>();
  const assetIds = new Set(bundle.assets.map((asset) => asset.id));
  const assetById = new Map(
    bundle.assets.map((asset) => [asset.id, asset]),
  );

  const passageById = new Map(bundle.passages.map((passage) => [passage.id, passage]));

  for (const passage of bundle.passages) {
    if (passageIds.has(passage.id)) {
      errors.push(`passage id 重複：${passage.id}`);
    }
    passageIds.add(passage.id);

    const computedWords = countWords(passage.body_md);
    const tolerance = Math.max(5, Math.round(passage.word_count * 0.05));
    if (Math.abs(computedWords - passage.word_count) > tolerance) {
      errors.push(
        `passage ${passage.id} 的 word_count=${passage.word_count} 與實際 ${computedWords} 相差超過 5%`,
      );
    }

    if (passage.section === 'listening') {
      if (!passage.audio_asset_id) {
        errors.push(`聽力 passage ${passage.id} 缺少 audio_asset_id`);
      } else if (!assetIds.has(passage.audio_asset_id)) {
        errors.push(
          `聽力 passage ${passage.id} 引用了不存在的音頻 ${passage.audio_asset_id}`,
        );
      }
      if (!passage.transcript) {
        errors.push(`聽力 passage ${passage.id} 缺少 transcript`);
      }
    } else if (passage.audio_asset_id && !assetIds.has(passage.audio_asset_id)) {
      errors.push(
        `passage ${passage.id} 引用了不存在的音頻 ${passage.audio_asset_id}`,
      );
    }
  }

  const paragraphStats = new Map(
    bundle.passages.map((passage) => {
      const paragraphs = passage.body_md
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      return [
        passage.id,
        {
          paragraphs: paragraphs.length,
          sentences: paragraphs.map(countSentences),
        },
      ];
    }),
  );

  for (const question of bundle.questions) {
    if (questionIds.has(question.id)) {
      errors.push(`question id 重複：${question.id}`);
    }
    questionIds.add(question.id);

    const passage = passageById.get(question.passage_id);
    if (!passage) {
      errors.push(`題目 ${question.id} 引用了不存在的 passage ${question.passage_id}`);
      continue;
    }
    if (question.section !== passage.section) {
      errors.push(
        `題目 ${question.id} 的 section ${question.section} 與 passage ${passage.section} 不一致`,
      );
    }

    if (question.options) {
      const keys = question.options.map((option) => option.key);
      if (new Set(keys).size !== keys.length) {
        errors.push(`題目 ${question.id} 的選項 key 重複`);
      }
      if (!keys.includes(question.answer)) {
        errors.push(
          `題目 ${question.id} 的 answer=${question.answer} 不在選項 ${keys.join('/')} 中`,
        );
      }
    } else if (
      question.type !== 'writing_task' &&
      question.type !== 'translation' &&
      question.type !== 'banked_cloze'
    ) {
      errors.push(`題目 ${question.id} 缺少 options`);
    }

    if (question.evidence.some((evidence) => evidence.segment !== undefined)) {
      const asset = passage.audio_asset_id
        ? assetById.get(passage.audio_asset_id)
        : undefined;
      const segmentCount = asset?.segments?.length ?? 0;

      if (segmentCount > 0) {
        for (const evidence of question.evidence) {
          if (
            evidence.segment !== undefined &&
            evidence.segment >= segmentCount
          ) {
            errors.push(
              `題目 ${question.id} 的 evidence.segment=${evidence.segment} 超出 ${segmentCount} 個片段`,
            );
          }
        }
      }
    }

    if (question.evidence.some((e) => e.paragraph !== undefined)) {
      const stats = paragraphStats.get(question.passage_id);
      if (stats) {
        for (const evidence of question.evidence) {
          if (evidence.paragraph === undefined) continue;
          if (evidence.paragraph > stats.paragraphs) {
            errors.push(
              `題目 ${question.id} 的 evidence.paragraph=${evidence.paragraph} 超出文章段落數 ${stats.paragraphs}`,
            );
            continue;
          }
          if (evidence.sentence === undefined) continue;
          const maxSentence = stats.sentences[evidence.paragraph - 1] ?? 0;
          if (evidence.sentence > maxSentence) {
            warnings.push(
              `題目 ${question.id} 的 evidence.sentence=${evidence.sentence} 超出第 ${evidence.paragraph} 段句數 ${maxSentence}（可能是縮寫或引號造成計數差異）`,
            );
          }
        }
      }
    }
  }

  for (const passage of bundle.passages) {
    if (passage.subtype !== 'banked_cloze') {
      if (passage.word_bank && passage.word_bank.length > 0) {
        warnings.push(
          `passage ${passage.id} 不是 banked_cloze，但提供了 word_bank，將被忽略`,
        );
      }
      continue;
    }

    const markers = [
      ...passage.body_md.matchAll(/\[\[(\d+)\]\]/g),
    ].map((match) => Number(match[1]));
    const expected = Array.from(
      { length: markers.length },
      (_, index) => index + 1,
    );

    if (markers.length === 0) {
      errors.push(`選詞填空 ${passage.id} 沒有 [[n]] 空白標記`);
      continue;
    }
    if (markers.join(',') !== expected.join(',')) {
      errors.push(
        `選詞填空 ${passage.id} 的空白標記必須是連續且依序的 1..${markers.length}`,
      );
    }

    const bank = passage.word_bank ?? [];
    if (bank.length === 0) {
      errors.push(`選詞填空 ${passage.id} 缺少 word_bank`);
    }
    const bankKeys = bank.map((option) => option.key);
    if (new Set(bankKeys).size !== bankKeys.length) {
      errors.push(`選詞填空 ${passage.id} 的 word_bank key 重複`);
    }
    if (bank.length < markers.length + 3) {
      errors.push(
        `選詞填空 ${passage.id} 至少需要 ${markers.length + 3} 個選項（含 3 個干擾項）`,
      );
    }

    const passageQuestions = bundle.questions.filter(
      (question) => question.passage_id === passage.id,
    );
    const blankQuestions = passageQuestions.filter(
      (question) => question.type === 'banked_cloze',
    );

    if (passageQuestions.length !== blankQuestions.length) {
      errors.push(`選詞填空 ${passage.id} 只能包含 banked_cloze 題型`);
    }
    if (blankQuestions.length !== markers.length) {
      errors.push(
        `選詞填空 ${passage.id} 有 ${markers.length} 個空白，但有 ${blankQuestions.length} 題`,
      );
    }

    const seenBlanks = new Set<number>();
    const usedAnswers = new Set<string>();

    for (const question of blankQuestions) {
      if (question.options && question.options.length > 0) {
        errors.push(
          `題目 ${question.id} 不應有 options（選詞填空使用共用 word_bank）`,
        );
      }

      const blankIndex = question.blank_index;
      if (blankIndex === undefined) {
        errors.push(`題目 ${question.id} 缺少 blank_index`);
        continue;
      }
      if (!markers.includes(blankIndex)) {
        errors.push(
          `題目 ${question.id} 的 blank_index=${blankIndex} 不在文章空白標記中`,
        );
      }
      if (seenBlanks.has(blankIndex)) {
        errors.push(`選詞填空 ${passage.id} 的 blank ${blankIndex} 重複出現`);
      }
      seenBlanks.add(blankIndex);

      if (!bankKeys.includes(question.answer)) {
        errors.push(
          `題目 ${question.id} 的 answer=${question.answer} 不在 word_bank 中`,
        );
      }
      if (usedAnswers.has(question.answer)) {
        errors.push(
          `選詞填空 ${passage.id} 的答案 ${question.answer} 重複使用；每個詞最多用一次`,
        );
      }
      usedAnswers.add(question.answer);
    }
  }

  return { errors, warnings };
}
