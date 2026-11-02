import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';

const ROOT = path.resolve('.');
const DATA = path.join(ROOT, 'public', 'data');
const EXAMS = path.join(ROOT, 'content', 'exams');

const countWords = (text) =>
  (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;

const exam = {
  id: 'exam_2025-12_set1',
  title: '2025 年 12 月大学英语四级真题（第一套）',
  year: 2025,
  month: 12,
  set: 'set1',
  source: 'user-entered',
  license: 'private',
  content_version: '1.0.0',
  sections: ['writing', 'translation'],
};

const writingPrompt = `Directions: Suppose the student union of your university is collecting opinions on improving its work for the coming year. You are now to write a response by suggesting how it can better enrich student life. You will have 30 minutes to write the essay. You should write at least 120 words but no more than 180 words.`;

const writingSample = `The Student Union plays a vital role in enhancing campus life. To better serve the student body in the coming year, I would like to offer the following suggestions. First, organizing more cultural events would be highly beneficial. Activities such as film festivals, art exhibitions, and music nights can broaden students' horizons and provide much-needed relaxation. Second, expanding sports competitions and recreational leagues would encourage physical well-being and teamwork. Third, academic support should be strengthened through regular workshops and lecture series on skills like public speaking and career planning. Finally, creating more platforms for cross-departmental interaction—such as themed socials or club fairs—would help students build stronger connections across disciplines. By implementing these suggestions, the Student Union can significantly enrich our university experience, making campus life more vibrant, supportive, and engaging for everyone.`;

const translationSource = `近年来，中国政府高度重视民营经济(private economy)的发展，出台了一系列政策支持民营企业。截至2025年3月底，全国民营企业数量超过5700万家，占企业总量的92.3%。民营企业不仅数量稳步增长，质量和结构也在不断提升。民营企业的研发投入不断增加，在新一代信息技术、人工智能等领域发展迅速。民营企业核心竞争力的增强为中国经济的高质量发展提供了有力支撑。`;

const translationReference = `In recent years, the Chinese government has attached great importance to the development of the private economy and has introduced a series of policies to support private enterprises. By the end of March 2025, the number of private enterprises nationwide had exceeded 57 million, accounting for 92.3% of the total number of enterprises. Private enterprises have not only grown steadily in number, but also improved in quality and structure. Their investment in research and development has continued to increase, and they have made rapid progress in fields such as new-generation information technology and artificial intelligence. The strengthening of the core competitiveness of private enterprises has provided strong support for China's high-quality economic development.`;

const translationBody = `Translate the following passage into English.\n\n${translationSource}`;

const writingExplanation = `参考范文（约 160 词）：\n\n${writingSample}\n\n写作提示：\n1. 开头点明校学生会的作用，并提出“愿意提出建议”。\n2. 用 First / Second / Third / Finally 分层提出建议：文化活动、体育活动、学术支持、跨院系交流。\n3. 每项建议说明目的和好处，避免只罗列。\n4. 结尾总结这些建议能如何丰富校园生活，注意 120–180 词。`;

const translationExplanation = `参考译文：\n\n${translationReference}\n\n译点提示：\n1. “近年来”译为 In recent years；“高度重视”可用 attach great importance to。\n2. “出台了一系列政策支持民营企业”可用 introduce a series of policies to support private enterprises。\n3. “截至2025年3月底”译为 By the end of March 2025；注意用过去完成时 had exceeded。\n4. “占企业总量的92.3%”可用 accounting for 92.3% of the total number of enterprises。\n5. “研发投入”译为 investment in research and development；“新一代信息技术、人工智能”译为 new-generation information technology and artificial intelligence。\n6. “核心竞争力”译为 core competitiveness；“高质量发展”译为 high-quality economic development。`;

const passages = [
  {
    meta: {
      id: 'psg_exam_2025-12_set1_writing',
      section: 'writing',
      subtype: 'careful_reading',
      order: 1,
      title: 'Writing Task: Enriching Student Life',
      hot_topic_tags: ['unclassified'],
    },
    body: writingPrompt,
    questions: [
      {
        id: 'q_exam_2025-12_set1_writing_01',
        type: 'writing_task',
        stem: 'Write a response suggesting how the student union can better enrich student life.',
        answer: '-',
        explanation: writingExplanation,
        evidence: [
          {
            paragraph: 1,
            sentence: 1,
            quote:
              "Suppose the student union of your university is collecting opinions on improving its work for the coming year.",
          },
        ],
        knowledge_tags: ['main_idea'],
        error_cause_tags: ['grammar', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 3,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-12_set1_translation',
      section: 'translation',
      subtype: 'careful_reading',
      order: 2,
      title: 'Translation Task: Private Economy',
      hot_topic_tags: ['unclassified'],
    },
    body: translationBody,
    questions: [
      {
        id: 'q_exam_2025-12_set1_translation_01',
        type: 'translation',
        stem: 'Translate the following passage into English.',
        answer: '-',
        explanation: translationExplanation,
        evidence: [
          {
            paragraph: 1,
            sentence: 1,
            quote: 'Translate the following passage into English.',
          },
        ],
        knowledge_tags: ['paraphrase'],
        error_cause_tags: ['grammar', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 3,
      },
    ],
  },
];

const normalizedPassages = [];
const normalizedQuestions = [];
const md = [];
md.push('---');
md.push(yamlStringify({ schema_version: '1.0', exam, assets: [] }).trimEnd());
md.push('---', '');

passages.forEach((passage, index) => {
  const wordCount = countWords(passage.body);
  const meta = { ...passage.meta, word_count: wordCount };
  md.push(`## Passage ${index + 1}`, '');
  md.push('```yaml passage');
  md.push(yamlStringify(meta).trimEnd());
  md.push('```', '');
  md.push(passage.body, '');
  const questions = passage.questions.map((question) => ({
    passage_id: meta.id,
    section: meta.section,
    ...question,
  }));
  md.push('```json questions');
  md.push(JSON.stringify(questions, null, 2));
  md.push('```', '');
  normalizedPassages.push({
    ...meta,
    exam_id: exam.id,
    body_md: passage.body,
    word_count: wordCount,
  });
  normalizedQuestions.push(
    ...questions.map((question) => ({ exam_id: exam.id, ...question })),
  );
});

const bundle = {
  schema_version: '1.0',
  exam,
  passages: normalizedPassages,
  questions: normalizedQuestions,
  assets: [],
};

mkdirSync(DATA, { recursive: true });
mkdirSync(path.join(EXAMS, '2025-12-set1'), { recursive: true });
writeFileSync(
  path.join(DATA, '2025-12-set1.json'),
  `${JSON.stringify(bundle, null, 2)}\n`,
);
writeFileSync(
  path.join(EXAMS, '2025-12-set1', 'exam.md'),
  md.join('\n'),
);
console.log('wrote public/data/2025-12-set1.json');
console.log('wrote content/exams/2025-12-set1/exam.md');
console.log(
  'passages:',
  normalizedPassages.map((p) => `${p.section}:${p.word_count}w`).join(', '),
);
