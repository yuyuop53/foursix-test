# CET-Lab 题库 JSON 字段规范

> `public/data` 当前内容：
>
> - `2025-12-set1.json`：现有唯一题库文件，目前仅含 writing + translation
> - `FIELD-SPEC.md`：本规范
> - `2025-12-set1.MISSING.md`：该套题缺失内容清单
>
> 本规范严格来自项目现有的 `content/exams/*/exam.json` 与
> `schemas/content.schema.json`，字段名不做任何新增或改名。
>
> App 实际读取的是 `content/exams/**/*.md`（同一套数据的作者格式）。
> `public/data/<year>-<month>-<set>.json` 是规范化 JSON 副本；如需 App 直接读取该目录，需要另加加载器。

## 1. 文件命名

```
public/data/2025-12-set1.json
```

文件名格式：`年份月份-套数.json`。

## 2. 顶层结构

```json
{
  "schema_version": "1.0",
  "exam": {},
  "passages": [],
  "questions": [],
  "assets": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema_version` | `"1.0"` / `"1.1"` | 是 | 当前使用 `"1.0"` 即可 |
| `exam` | object | 是 | 试卷元数据 |
| `passages` | array | 是 | 文章 / 听力 / 写作 / 翻译题源 |
| `questions` | array | 是 | 所有题目 |
| `assets` | array | 是 | 音频等资源；没有音频时写 `[]` |

## 3. `exam`

```json
{
  "id": "exam_2025-12_set1",
  "title": "2025 年 12 月大学英语四级真题（第一套）",
  "year": 2025,
  "month": 12,
  "set": "set1",
  "source": "user-entered",
  "license": "private",
  "content_version": "1.0.0",
  "sections": ["reading", "listening", "writing", "translation"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | `exam_<year>-<month>_<set>`，只含小写 ASCII、数字、`_`、`-` |
| `title` | string | 是 | 显示名称 |
| `year` | integer | 是 | 2000–2100 |
| `month` | integer | 是 | 1–12 |
| `set` | string | 是 | 如 `set1`、`set2` |
| `source` | enum | 是 | `user-entered` / `original` / `licensed` / `public-domain` |
| `license` | string | 是 | 自行录入用 `private` |
| `content_version` | string | 是 | `1.0.0` |
| `sections` | array | 是 | `reading` / `listening` / `writing` / `translation` / `speaking` |

## 4. `passages[]`

```json
{
  "id": "psg_exam_2025-12_set1_r1",
  "exam_id": "exam_2025-12_set1",
  "section": "reading",
  "subtype": "careful_reading",
  "order": 1,
  "title": "Passage One",
  "body_md": "第一段……\n\n第二段……",
  "word_count": 350,
  "hot_topic_tags": ["unclassified"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | `psg_<exam-id>_<section><order>` |
| `exam_id` | string | 是 | 所属试卷 ID |
| `section` | enum | 是 | `reading` / `listening` / `writing` / `translation` / `speaking` |
| `subtype` | enum | 是 | `careful_reading` / `banked_cloze` |
| `order` | integer | 是 | 同 section 内从 1 开始 |
| `title` | string | 是 | 文章标题 |
| `body_md` | string | 是 | 文章正文；段落之间用空行分隔。翻译题的 `body_md` 放中文原文；写作题的 `body_md` 放题目要求 |
| `word_count` | integer | 是 | 英文词数；验证器允许 ±5% |
| `hot_topic_tags` | string[] | 是 | 至少 1 个；无合适热点用 `unclassified` |
| `word_bank` | Option[] | 否 | 仅选词填空使用 |
| `audio_asset_id` | string \| null | 听力必填 | 对应 `assets[].id` |
| `accent` | enum \| null | 听力建议 | `us` / `british` / `australian` / `canadian` / `other` |
| `wpm` | number \| null | 听力建议 | 80–220 |
| `transcript` | string | 听力必填 | 听力逐字稿全文 |
| `transcript_zh` | string | 否 | 逐字稿中文翻译 |

## 5. `questions[]`

```json
{
  "id": "q_exam_2025-12_set1_r1_46",
  "exam_id": "exam_2025-12_set1",
  "passage_id": "psg_exam_2025-12_set1_r1",
  "section": "reading",
  "type": "detail",
  "stem": "What does the author say about ...?",
  "options": [
    { "key": "A", "text": "..." },
    { "key": "B", "text": "..." },
    { "key": "C", "text": "..." },
    { "key": "D", "text": "..." }
  ],
  "answer": "B",
  "explanation": "根据第二段……，故选 B。",
  "evidence": [
    { "paragraph": 2, "sentence": 3, "quote": "原文关键句" }
  ],
  "knowledge_tags": ["detail"],
  "error_cause_tags": ["locating"],
  "hot_topic_tags": ["unclassified"],
  "difficulty": 2
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | `q_<exam-id>_<section><order>_<题号>` |
| `exam_id` | string | 是 | 所属试卷 ID |
| `passage_id` | string | 是 | 所属 passage ID |
| `section` | enum | 是 | 与 passage 一致 |
| `type` | enum | 是 | 见下方题型枚举 |
| `stem` | string | 是 | 题干（不是 `question`） |
| `options` | Option[] | 选择题必填 | `{key,text}`，key 为 A–O；阅读/听力一般为 A–D |
| `answer` | string | 是 | 正确选项 key；选词填空为词库 key；写作/翻译为 `"-"` |
| `explanation` | string | 是 | 中文解析；阅读必须体现原文依据，听力给出关键句，翻译/写作给出参考译文/范文与要点 |
| `evidence` | Evidence[] | 是 | 阅读：`{paragraph,sentence,quote?}`；听力：`{segment,quote?}` |
| `knowledge_tags` | string[] | 是 | 至少 1 个，见考点枚举 |
| `error_cause_tags` | string[] | 是 | 至少 1 个，见错因枚举 |
| `hot_topic_tags` | string[] | 建议 | 与 passage 同步 |
| `difficulty` | integer | 是 | 1–5 |
| `blank_index` | integer | 选词填空必填 | 从 1 开始，每个空恰好一题 |
| `audio_span` | object \| null | 听力选填 | `{start,end}`，秒 |
| `generated` | boolean | 选填 | 系统生成题目标 `true` |

### 题型枚举

`detail`、`inference`、`attitude`、`main_idea`、`vocabulary_in_context`、`text_structure`、`signposting`、`paraphrase`、`listening_detail`、`listening_inference`、`listening_attitude`、`banked_cloze`、`translation`、`writing_task`。

- 阅读仔细阅读：`detail` / `inference` / `attitude` / `main_idea` / `vocabulary_in_context` / `text_structure` 等
- 阅读选词填空：`banked_cloze`，不要 `options`，用 `blank_index`
- 听力：`listening_detail` / `listening_inference` / `listening_attitude`
- 翻译：`translation`，`answer: "-"`，不要 `options`
- 写作：`writing_task`，`answer: "-"`，不要 `options`

### 选项与证据

- `options` 的 key 只能 A–O，不能重复；标准选择题 2–6 个，段落匹配最多 15 个。
- 答案必须在 options 中（选词填空在 `word_bank` 中）。
- 阅读 `evidence.paragraph` / `evidence.sentence` 都从 1 开始。
- 听力 `evidence.segment` 从 0 开始，对应 `assets[].segments[].index`。

## 6. `assets[]` 与听力字幕

```json
{
  "id": "aud_exam_2025-12_set1_l1",
  "kind": "audio",
  "backend": "local",
  "src": "audio/l1.mp3",
  "accent": "us",
  "wpm": 145,
  "synthetic": false,
  "license": "licensed",
  "duration_sec": 180,
  "segments": [
    { "index": 0, "start": 0.0, "end": 4.2, "text": "First sentence.", "textZh": "第一句。" },
    { "index": 1, "start": 4.2, "end": 9.8, "text": "Second sentence.", "textZh": "第二句。" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | `aud_<exam-id>_<slug>` |
| `kind` | enum | 是 | `audio` / `image` |
| `backend` | enum | 是 | `local` / `url` / `tts` |
| `src` | string | local/url 必填 | 音频路径或 URL；TTS 可用 `browser-speech` 或不填 |
| `accent` | enum | 建议 | `us` / `british` / `australian` / `canadian` / `other` |
| `wpm` | number | 建议 | 80–220 |
| `synthetic` | boolean | TTS 必填为 `true` | 非原声标记 |
| `license` | string | 是 | 授权说明 |
| `duration_sec` | number | 否 | 音频时长（秒） |
| `segments` | array | 听力强烈建议 | 字幕数组，每句一项 |

### `segments[]`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `index` | integer | 是 | 从 0 开始，连续递增 |
| `start` | number | local/url 必填 | 该句起始秒 |
| `end` | number | local/url 必填 | 该句结束秒，必须大于 start |
| `text` | string | 是 | 英文原句 |
| `textZh` | string | 否 | 中文翻译 |

> 这就是字幕同步需要的“subtitles”数据。现有结构里没有顶层 `subtitles` 字段，字幕放在 `assets[].segments`。
> 听力 passage 还必须提供 `transcript`，并把 `audio_asset_id` 指向该 asset。

## 7. 你列出的字段与现有字段对照

| 你提到的字段 | 现有字段 | 说明 |
|---|---|---|
| `id` | `exam.id` / `passage.id` / `question.id` / `asset.id` | 按层级使用 |
| `type` | `question.type` | 题型枚举见上 |
| `question` | `question.stem` | 现有字段名是 `stem` |
| `options` | `question.options` | `{key,text}` 数组 |
| `answer` | `question.answer` | 选项 key；写作/翻译为 `"-"` |
| `explanation` | `question.explanation` | 中文解析 |
| `audioUrl` | `assets[].src` + `passages[].audio_asset_id` | 没有顶层 `audioUrl` 字段 |
| `subtitles` | `assets[].segments` | 没有顶层 `subtitles` 字段 |

## 8. 时间 / 词数 / 标签规则

- `word_count`：英文词数；验证器会重算，允许 ±5%。
- 听力 `word_count`：按逐字稿英文词数计算。
- `hot_topic_tags` 允许值：`ai_ethics`、`climate_change`、`remote_work`、`mental_health`、`new_energy`、`tech_ethics`、`aging_population`、`urbanization`、`digital_economy`、`biodiversity`、`education_technology`、`public_health`、`unclassified`。
- `knowledge_tags`：`main_idea`、`detail`、`inference`、`attitude`、`vocabulary_in_context`、`text_structure`、`signposting`、`paraphrase`、`listening_detail`、`listening_inference`、`listening_attitude`、`logic_gap`、`cohesion`。
- `error_cause_tags`：`lexical`、`grammar`、`locating`、`inference`、`time_pressure`、`carelessness`。

## 8.1 现有数据模型的两个硬限制

1. **听力没有逐字稿时无法生成有效 passage**
   - `passages[].transcript` 是必填字段。
   - 字幕不是顶层 `subtitles`，而是 `assets[].segments`。
   - 只有听力题目、没有逐字稿/音频时，不能创建合法的 listening passage；建议暂时不导入听力，等逐字稿或音频补齐。
   - `segments` 可以为空（由播放器按 `transcript` 自动切句），但 `transcript` 不能为空。

2. **现有结构没有“中文题干”字段**
   - 阅读题干使用 `questions[].stem`（英文）。
   - 中文解析放在 `questions[].explanation`。
   - 如果必须单独保存中文题干，就需要新增字段/扩展 schema，这与“严格按现有结构、不自创字段”冲突。

## 9. 转换规则（新真题）

1. 一套真题生成一个文件：`public/data/<year>-<month>-<set>.json`。
2. 听力：
   - 每段听力一个 passage，`section: "listening"`。
   - 必须写 `transcript`，并设置 `audio_asset_id`。
   - 字幕拆成 `assets[].segments`，每句一个 segment，`index` 从 0 连续。
   - 有真实音频时 `backend: "local"` 或 `"url"`，`segments` 必须有 `start/end`。
   - 使用浏览器 TTS 时 `backend: "tts"`、`synthetic: true`，`segments` 可不填时间。
3. 阅读：
   - `body_md` 保留原文段落，段落之间空行分隔。
   - `evidence` 写段号、句号、原文引用；`explanation` 必须说明答案依据。
4. 翻译：
   - `body_md` 放中文原文。
   - `question.type: "translation"`，`answer: "-"`。
   - `explanation` 放参考译文和译点提示（现有结构没有单独的 `reference` 字段）。
5. 写作：
   - `body_md` 放题目要求。
   - `question.type: "writing_task"`，`answer: "-"`。
   - `explanation` 放参考范文和写作要点。
6. 不新增字段；所有字段名与本文档一致。

## 10. 最小骨架

```json
{
  "schema_version": "1.0",
  "exam": {
    "id": "exam_2025-12_set1",
    "title": "2025 年 12 月大学英语四级真题（第一套）",
    "year": 2025,
    "month": 12,
    "set": "set1",
    "source": "user-entered",
    "license": "private",
    "content_version": "1.0.0",
    "sections": ["reading"]
  },
  "passages": [
    {
      "id": "psg_exam_2025-12_set1_r1",
      "exam_id": "exam_2025-12_set1",
      "section": "reading",
      "subtype": "careful_reading",
      "order": 1,
      "title": "Passage One",
      "body_md": "第一段……\n\n第二段……",
      "word_count": 300,
      "hot_topic_tags": ["unclassified"]
    }
  ],
  "questions": [
    {
      "id": "q_exam_2025-12_set1_r1_46",
      "exam_id": "exam_2025-12_set1",
      "passage_id": "psg_exam_2025-12_set1_r1",
      "section": "reading",
      "type": "detail",
      "stem": "What does the author say?",
      "options": [
        { "key": "A", "text": "..." },
        { "key": "B", "text": "..." },
        { "key": "C", "text": "..." },
        { "key": "D", "text": "..." }
      ],
      "answer": "A",
      "explanation": "根据第一段……，故选 A。",
      "evidence": [
        { "paragraph": 1, "sentence": 1, "quote": "原文关键句" }
      ],
      "knowledge_tags": ["detail"],
      "error_cause_tags": ["locating"],
      "hot_topic_tags": ["unclassified"],
      "difficulty": 2
    }
  ],
  "assets": []
}
```
