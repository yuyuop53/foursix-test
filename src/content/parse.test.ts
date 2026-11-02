import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ContentParseError, parseExamMarkdown, parseExamMarkdownDetailed } from './parse';

const samplePath = fileURLToPath(
  new URL('../../content/examples/exam-sample.md', import.meta.url),
);
const sample = readFileSync(samplePath, 'utf8');

const clozePath = fileURLToPath(
  new URL('../../content/reading/banked-cloze-sample.md', import.meta.url),
);
const cloze = readFileSync(clozePath, 'utf8');

const listeningPath = fileURLToPath(
  new URL('../../content/listening/listening-sample.md', import.meta.url),
);
const listening = readFileSync(listeningPath, 'utf8');

describe('parseExamMarkdown', () => {
  it('parses the bundled sample end to end', () => {
    const bundle = parseExamMarkdown(sample, 'exam-sample.md');

    expect(bundle.schema_version).toBe('1.0');
    expect(bundle.exam.id).toBe('exam_sample_2026_11');
    expect(bundle.passages).toHaveLength(1);
    expect(bundle.questions).toHaveLength(3);
    expect(bundle.passages[0].word_count).toBe(229);
    expect(bundle.questions.map((question) => question.answer)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(bundle.questions[0].evidence[0].paragraph).toBe(2);
  });

  it('returns no blocking warnings for the sample', () => {
    const result = parseExamMarkdownDetailed(sample, 'exam-sample.md');
    expect(result.warnings).toEqual([]);
  });

  it('rejects content without front matter', () => {
    expect(() => parseExamMarkdown('## Passage 1\n\ntext')).toThrow(
      ContentParseError,
    );
  });

  it('rejects an answer that is not in the options', () => {
    const broken = sample.replace('"answer": "A"', '"answer": "Z"');
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(
      /answer=Z/,
    );
  });

  it('rejects a question pointing at a missing passage', () => {
    const broken = sample.replace(
      '"passage_id": "psg_exam_sample_2026_11_r1"',
      '"passage_id": "psg_missing"',
    );
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(
      /passage_id|不存在/,
    );
  });
});

describe('banked cloze parsing', () => {
  it('parses the original 10-blank / 15-word sample', () => {
    const bundle = parseExamMarkdown(cloze, 'banked-cloze-sample.md');

    expect(bundle.schema_version).toBe('1.1');
    expect(bundle.passages).toHaveLength(1);
    expect(bundle.passages[0].subtype).toBe('banked_cloze');
    expect(bundle.passages[0].word_bank).toHaveLength(15);
    expect(bundle.questions).toHaveLength(10);
    expect(bundle.questions.every((question) => question.type === 'banked_cloze')).toBe(
      true,
    );
    expect(bundle.questions.map((question) => question.blank_index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(new Set(bundle.questions.map((question) => question.answer)).size).toBe(
      10,
    );
  });

  it('rejects an answer that is not in the word bank', () => {
    const broken = cloze.replace('"answer": "M"', '"answer": "Z"');
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(
      /不在 word_bank/,
    );
  });

  it('rejects a reused answer key', () => {
    const broken = cloze.replace('"answer": "H"', '"answer": "M"');
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(/重複使用/);
  });

  it('rejects missing or non-contiguous blank markers', () => {
    const broken = cloze.replace('[[5]]', '[5]');
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(/空白標記/);
  });
});

describe('listening parsing', () => {
  it('parses the TTS listening sample with segments and questions', () => {
    const bundle = parseExamMarkdown(listening, 'listening-sample.md');

    expect(bundle.schema_version).toBe('1.1');
    expect(bundle.passages).toHaveLength(1);
    expect(bundle.passages[0].section).toBe('listening');
    expect(bundle.passages[0].transcript).toContain('Good morning');
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0].backend).toBe('tts');
    expect(bundle.assets[0].segments).toHaveLength(9);
    expect(bundle.questions).toHaveLength(3);
    expect(bundle.questions[0].evidence[0].segment).toBe(3);
  });

  it('rejects listening evidence pointing past the last segment', () => {
    const broken = listening.replace(
      '"evidence": [{ "segment": 7 }]',
      '"evidence": [{ "segment": 99 }]',
    );
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(
      /超出 9 個片段/,
    );
  });

  it('rejects a non-TTS asset without src', () => {
    const broken = listening
      .replace('backend: tts', 'backend: local')
      .replace('src: "browser-speech"', 'src: ""');
    expect(() => parseExamMarkdown(broken, 'broken.md')).toThrow(/src/);
  });
});
