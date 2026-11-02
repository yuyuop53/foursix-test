import rulesConfig from '../../config/exam_rules.json';

export const HOT_TOPIC_LABELS = Object.fromEntries(
  rulesConfig.reading.hot_topics.map((topic) => [topic.id, topic.label]),
) as Record<string, string>;

export const ERROR_CAUSE_LABELS = Object.fromEntries(
  (rulesConfig.taxonomy.error_causes as { id: string; label: string }[]).map(
    (cause) => [cause.id, cause.label],
  ),
) as Record<string, string>;

export const KNOWLEDGE_LABELS: Record<string, string> = {
  main_idea: '主旨',
  detail: '細節',
  inference: '推論',
  attitude: '觀點／態度',
  vocabulary_in_context: '語境詞義',
  text_structure: '篇章結構',
  signposting: '訊號詞',
  paraphrase: '同義改寫',
  listening_detail: '聽力細節',
  listening_inference: '聽力推論',
  listening_attitude: '聽力態度',
  logic_gap: '邏輯缺口',
  cohesion: '銜接',
};

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  detail: '細節題',
  inference: '推論題',
  attitude: '觀點／態度題',
  main_idea: '主旨題',
  vocabulary_in_context: '語境詞義題',
  text_structure: '篇章結構題',
  listening_detail: '聽力細節題',
  listening_inference: '聽力推論題',
  listening_attitude: '聽力態度題',
  signposting: '訊號詞題',
  paraphrase: '同義改寫題',
  banked_cloze: '選詞填空題',
  translation: '翻譯',
  writing_task: '寫作任務',
};

export const SECTION_LABELS: Record<string, string> = {
  reading: '閱讀',
  listening: '聽力',
  writing: '寫作',
  translation: '翻譯',
  speaking: '口語',
};

export const ACCENT_LABELS: Record<string, string> = {
  us: '美音',
  british: '英音',
  australian: '澳音',
  canadian: '加音',
  other: '其他口音',
};

export function labelOf(
  map: Record<string, string>,
  key: string | null | undefined,
): string {
  if (!key) return '—';
  return map[key] ?? key;
}
