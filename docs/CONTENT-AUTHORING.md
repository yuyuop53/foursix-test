# CET-Lab 內容錄入規範

本文件定義真題／練習內容的作者格式、ID 規則、標籤體系與匯入流程。目標是：**一組閱讀在 10 分鐘內錄完，且壞資料在建置時就被擋下。**

- 作者格式：Markdown + YAML front matter + fenced YAML/JSON 區塊
- 正規化產物：JSON，結構見 `schemas/content.schema.json`
- 驗證：Phase 1 起由 `scripts/validate-content.ts`（Zod）執行
- 範例：`content/examples/exam-sample.md`

---

## 1. 檔案佈局

```
content/
├─ exams/
│  └─ <exam-id>/
│     ├─ exam.md              # 主要內容
│     └─ audio/
│        ├─ public/           # 可公開、有授權的音頻
│        └─ private/          # 私有音頻（gitignore，永不部署）
├─ words/
│  └─ cet4-core.csv           # 詞彙表（lemma, meaning_zh, frequency_rank, tags）
├─ culture_terms.yaml         # 翻譯文化詞術語表
└─ examples/
   └─ exam-sample.md          # 最小可驗證範例
```

一場考試一個 `exam.md`。若同一場有多套題，用 `set` 區分（`set1`、`set2`）。

---

## 2. 檔案格式

### 2.1 Front matter（考試 metadata）

```yaml
---
schema_version: "1.0"
exam:
  id: exam_2024-12_set1
  title: "2024 年 12 月 CET-4 第一套（自行鍵入）"
  year: 2024
  month: 12
  set: set1
  source: user-entered          # user-entered | original | licensed | public-domain
  license: "private"            # private | CC0-1.0 | CC-BY-4.0 | 其他
  content_version: "1.0.0"
  sections: [reading, listening]
assets:
  - id: aud_exam_2024-12_set1_l1
    kind: audio
    backend: tts                # local | url | tts
    src: "audio/public/l1.mp3"
    accent: british             # us | british | australian | canadian | other
    wpm: 145
    synthetic: true
    license: "TTS-generated"
    duration_sec: 182.4
---
```

`sections` 可包含 `reading`、`listening`、`writing`、`translation`、`speaking`。

### 2.2 Passage 區塊

每個 `## Passage N` 標題下，先放一個 `yaml passage` 區塊，再放文章本體：

````markdown
## Passage 1

```yaml passage
id: psg_exam_2024-12_set1_r1
section: reading
order: 1
title: "The Future of Remote Work"
hot_topic_tags: [remote_work, mental_health]
word_count: 218
```

文章正文放這裡，使用一般 Markdown 段落。

段落之間用空行分隔；`evidence.paragraph` 從 1 開始計。
````

聽力 passage 額外欄位：

```yaml
audio_asset_id: aud_exam_2024-12_set1_l1
accent: british
wpm: 145
transcript: |
  ...逐字稿全文...
```

### 2.3 題目區塊

每個 passage 後面接一個 `json questions` 區塊（陣列）：

````markdown
```json questions
[
  {
    "id": "q_exam_2024-12_set1_r1_01",
    "passage_id": "psg_exam_2024-12_set1_r1",
    "section": "reading",
    "type": "detail",
    "stem": "What does the author say about remote work?",
    "options": [
      { "key": "A", "text": "It reduces office costs." },
      { "key": "B", "text": "It improves work-life balance for some." },
      { "key": "C", "text": "It is suitable for every industry." },
      { "key": "D", "text": "It has no effect on productivity." }
    ],
    "answer": "B",
    "explanation": "第二段指出遠距工作對部分員工的工作生活平衡有幫助，但並非所有產業皆適用。",
    "evidence": [
      { "paragraph": 2, "sentence": 3, "quote": "For some employees, ..." }
    ],
    "knowledge_tags": ["detail"],
    "error_cause_tags": ["locating", "lexical"],
    "hot_topic_tags": ["remote_work"],
    "difficulty": 2
  }
]
```
````

聽力題可加：

```json
{
  "audio_span": { "start": 12.3, "end": 18.9 },
  "evidence": [{ "segment": 3 }]
}
```

---

## 3. 欄位參考

### 3.1 `exam`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | `exam_<year>-<month>_<set>`，ASCII |
| `title` | ✅ | 顯示名稱 |
| `year` / `month` | ✅ | 西元年／月 |
| `set` | ✅ | `set1`、`set2`、`sample` 等 |
| `source` | ✅ | `user-entered` / `original` / `licensed` / `public-domain` |
| `license` | ✅ | 授權狀態；私有內容用 `private` |
| `content_version` | ✅ | 語意化版本；內容修改時遞增 |
| `sections` | ✅ | 本檔包含的板塊 |

### 3.2 `passage`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | `psg_<exam-id>_<section><order>` |
| `section` | ✅ | `reading` / `listening` |
| `order` | ✅ | 同 section 內序號，從 1 起 |
| `title` | ✅ | 文章標題 |
| `hot_topic_tags` | ✅ | 取自 `config/exam_rules.json` 的熱點 id |
| `word_count` | ✅ | 由驗證器重算，作者填寫值需相符（±5%） |
| `audio_asset_id` | 聽力必填 | 對應 front matter 的 asset id |
| `accent` / `wpm` | 聽力建議 | 口音、語速 |
| `transcript` | 聽力必填 | 逐字稿全文（可用 `|` 多行） |

### 3.3 `question`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | `q_<exam-id>_<section><order>_<NN>` |
| `passage_id` | ✅ | 所屬 passage |
| `section` | ✅ | 與 passage 一致 |
| `type` | ✅ | 見下方題型枚舉 |
| `stem` | ✅ | 題幹 |
| `options` | 選擇題必填 | `[{key,text}]`，key 為 A–D |
| `answer` | ✅ | 正確選項 key；寫作/翻譯任務可用 `"-"` |
| `explanation` | ✅ | 解析；必須能對應 evidence |
| `evidence` | 閱讀/聽力必填 | `[{paragraph,sentence,quote?}]` 或 `[{segment}]` |
| `knowledge_tags` | ✅ | 至少 1 個考點標籤 |
| `error_cause_tags` | ✅ | 至少 1 個錯因標籤 |
| `hot_topic_tags` | 建議 | 與 passage 同步 |
| `difficulty` | ✅ | 1–5 |
| `audio_span` | 聽力選填 | 本題對應的音頻時間段 |
| `generated` | 選填 | 系統生成的微型練習標 `true` |

**題型枚舉**：`detail`、`inference`、`attitude`、`main_idea`、`vocabulary_in_context`、`text_structure`、`listening_detail`、`listening_inference`、`listening_attitude`、`signposting`、`paraphrase`、`translation`、`writing_task`。

### 3.4 `asset`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | `aud_<exam-id>_<slug>` |
| `kind` | ✅ | `audio` / `image` |
| `backend` | ✅ | `local` / `url` / `tts` |
| `src` | ✅ | 相對路徑或 URL |
| `accent` | 音頻建議 | `us` / `british` / `australian` / `canadian` / `other` |
| `wpm` | 音頻建議 | 實際或估計語速 |
| `synthetic` | TTS 必填 | `true` 表示非原聲，UI 會標示 |
| `license` | ✅ | 授權說明 |
| `duration_sec` | 選填 | 長度 |
| `segments` | 選填 | `[{index,start,end,text}]`，供字幕同步 |

---

## 4. ID 規則

- 一律 ASCII、小寫、以底線分隔，不含中文或空白。
- `exam_2024-12_set1`
- `psg_exam_2024-12_set1_r1`（`r` = reading，`l` = listening）
- `q_exam_2024-12_set1_r1_03`
- `aud_exam_2024-12_set1_l1`
- 使用者自建：`u_<timestamp>_<slug>`
- 修改已發布內容時遞增 `content_version`，不更動既有 ID；作答紀錄靠 ID 回指。

---

## 5. 標籤體系

標籤來源統一在 `config/exam_rules.json`：

- `taxonomy.knowledge_tags`：`main_idea`、`detail`、`inference`、`attitude`、`vocabulary_in_context`、`text_structure`、`signposting`、`paraphrase`、`listening_detail`、`listening_inference`、`listening_attitude`、`logic_gap`、`cohesion`。
- `taxonomy.error_causes`：`lexical`、`grammar`、`locating`、`inference`、`time_pressure`、`carelessness`。
- `reading.hot_topics`：`ai_ethics`、`climate_change`、`remote_work`、`mental_health`、`new_energy`、`tech_ethics`、`aging_population`、`urbanization`、`digital_economy`、`biodiversity`、`education_technology`、`public_health`。

考點標籤決定「錯題重練只推同考點」的候選集合；錯因標籤決定訓練量分配。兩者都不可省略。

---

## 6. 聽力內容

- 必須有 `audio_asset_id`、`transcript`；建議有 `segments` 供逐句高亮與 AB 循環。
- `segments` 的 `text` 應與逐字稿一致；時間以秒為單位。
- 口音與語速寫在 passage/asset；播放器據此顯示標籤與建議倍速。
- TTS 音頻必須 `synthetic: true`，UI 顯示「非原聲」。

---

## 7. 版權與隱私

- **不爬取**、不內建盜版真題音頻或文本。
- 紙質書自行鍵入的內容，`source: user-entered`、`license: private`。
- 私有內容與音頻放 `content/private/` 或 `audio/private/`，已被 `.gitignore` 排除。
- 公開部署前確認 `license` 允許散布；不確定就標 `private` 且不部署。
- TTS 生成音頻標 `synthetic`，避免被誤認為官方原聲。

---

## 8. 驗證與匯入流程

### 8.1 建置時驗證（Phase 1）

```bash
npm run content:validate
```

檢查：

- ID 唯一、格式正確。
- 答案在選項中；`options` key 不重複。
- 至少一個 `knowledge_tags`；標籤在允許清單。
- 閱讀題 `evidence` 的 `paragraph/sentence` 在文章範圍內。
- 聽力題有音頻與逐字稿；`segments` 時間遞增。
- `word_count` 與實際計算相符（±5%）。
- 文化詞表欄位齊全。

任一項失敗 → 建置失敗，錯誤訊息指出 `檔案:行號` 與欄位。

### 8.2 建置時生成

`scripts/vite-plugin-content.ts` 監看 `content/**`，把 Markdown 正規化成 `src/content/generated/<exam-id>.json`，並熱重載。生成物不進 git。

### 8.3 App 內貼上匯入（Phase 1，開發模式）

`/import` 流程：

1. 貼上原始文字。
2. 啟發式切出 `Passage N`、題號、A–D 選項、`Answer: B`、解析。
3. 可編輯預覽表：修正段落、答案、考點/錯因標籤（自動完成）。
4. 即時跑同一套 Zod 驗證。
5. 存成 `source: user`、`u_<timestamp>_<slug>`，寫入 Dexie 並可匯出成 `exam.md`。

目標：一組閱讀 ≤10 分鐘；詞彙表用 CSV 貼上。

### 8.4 批量匯入

`scripts/import-content.ts` 支援 JSON/CSV；每筆都過 Zod。匯入前顯示 dry-run 摘要（新增/更新/衝突），確認後才寫入。

---

## 9. 常見錯誤

| 錯誤 | 後果 | 修正 |
|---|---|---|
| 題目 `passage_id` 打錯 | 題目掛不到文章 | 用 validator 的 dangling-reference 檢查 |
| `answer` 不在 options | 無法判分 | 修正 key 或選項 |
| 沒有 `knowledge_tags` | 變式推薦失效 | 至少補一個考點 |
| `evidence` 指向不存在的段落 | 解析無法引用 | 修正 paragraph/sentence |
| 字數差太多 | 寫作/翻譯節奏失真 | 重新計算或補內容 |
| 聽力沒有逐字稿 | 無法聽寫/字幕 | 補 transcript 與 segments |
| 私有音頻進 git | 版權風險 | 移到 `audio/private/`，確認 gitignore |

---

## 10. 最小範例

- 仔細閱讀：`content/examples/exam-sample.md`，原創短文＋3 題（detail / inference / attitude）。
- 選詞填空：`content/reading/banked-cloze-sample.md`，10 空＋15 詞共用詞庫。
- 聽力：`content/listening/listening-sample.md`，TTS 逐字稿＋9 個 segment＋3 題。

---

## 11. 選詞填空（banked cloze，schema 1.1）

### 11.1 Front matter

```yaml
schema_version: "1.1"
exam:
  id: exam_reading_cloze_2026_11
  title: "選詞填空範例"
  year: 2026
  month: 11
  set: cloze
  source: original
  license: CC0-1.0
  content_version: "1.0.0"
  sections: [reading]
assets: []
```

### 11.2 Passage

```yaml
## Passage 1

```yaml passage
id: psg_reading_cloze_2026_11_r1
section: reading
subtype: banked_cloze
order: 1
title: "Urban Green Spaces"
hot_topic_tags: [climate_change, public_health]
word_count: 144
word_bank:
  - { key: A, text: "absorb" }
  - { key: B, text: "agree" }
  # ... 共 15 個
```

City planners are turning to green roofs to [[1]] the effects of heat.
```

- 空白標記 `[[n]]` 必須連續、依序、從 1 開始。
- `word_bank` 至少 `空白數 + 3` 個選項（含干擾項），key 只能是 A–O。
- `word_count` 計算時會自動移除 `[[n]]` 標記。

### 11.3 Questions

```json
{
  "id": "q_reading_cloze_2026_11_r1_01",
  "passage_id": "psg_reading_cloze_2026_11_r1",
  "section": "reading",
  "type": "banked_cloze",
  "blank_index": 1,
  "stem": "Blank 1",
  "answer": "M",
  "explanation": "...",
  "evidence": [{ "paragraph": 1, "sentence": 1 }],
  "knowledge_tags": ["vocabulary_in_context"],
  "error_cause_tags": ["lexical"],
  "hot_topic_tags": ["climate_change"],
  "difficulty": 2
}
```

- 每題一個 `blank_index`，不能重複；每個 blank 恰好一題。
- `answer` 必須是 `word_bank` 的 key；每個 key 最多用一次。
- 選詞填空不使用 `options`（使用共用 `word_bank`）。
- v1.0 的仔細閱讀內容仍可正常解析。

---

## 12. 聽力（schema 1.1）

### 12.1 Audio asset

```yaml
assets:
  - id: aud_listening_sample_2026_11_l1
    kind: audio
    backend: tts          # local | url | tts
    src: "browser-speech" # TTS 可留空；local/url 必填
    accent: us
    wpm: 145
    synthetic: true
    license: "TTS-generated"
    segments:
      - index: 0
        text: "Good morning, everyone."
        textZh: "各位早安。"
```

- `tts`：不需要真實音檔；播放器用瀏覽器 SpeechSynthesis 逐句朗讀。
- `local` / `url`：必須有 `src`；segments 建議有 `start`/`end`，播放器才能精確 seek 與逐句高亮。
- 沒有 `segments` 時，播放器會用逐字稿自動切句。
- `textZh` 用於「隱藏中文」開關；沒有中文時開關不會出現。

### 12.2 Passage

```yaml
## Passage 1

```yaml passage
id: psg_listening_sample_2026_11_l1
section: listening
order: 1
title: "A Short Talk About Study Habits"
hot_topic_tags: [education_technology, mental_health]
word_count: 115
audio_asset_id: aud_listening_sample_2026_11_l1
accent: us
wpm: 145
transcript: |
  Good morning, everyone. ...
transcript_zh: |
  各位早安。...
```

- 聽力 passage 若沒有正文，解析器會使用 `transcript` 作為 body；`word_count` 以逐字稿計算。
- `transcript` 必填；`transcript_zh` 選填。

### 12.3 Questions

```json
{
  "id": "q_listening_sample_2026_11_l1_01",
  "passage_id": "psg_listening_sample_2026_11_l1",
  "section": "listening",
  "type": "listening_detail",
  "stem": "...",
  "options": [{ "key": "A", "text": "..." }],
  "answer": "B",
  "explanation": "...",
  "evidence": [{ "segment": 3 }],
  "knowledge_tags": ["listening_detail"],
  "error_cause_tags": ["lexical"],
  "hot_topic_tags": ["education_technology"],
  "difficulty": 2
}
```

- `evidence.segment` 是 asset segments 的索引，必須小於 segments 數量。
- 可用的聽力題型：`listening_detail`、`listening_inference`、`listening_attitude`。

---

## 13. 核心詞庫

詞庫不走 `exam.md`，而是 `content/words/*.json`。完整格式見 [VOCAB-AUTHORING.md](VOCAB-AUTHORING.md)。

---

## 14. 批量匯入（CSV／Excel）

若一次要匯入大量閱讀題，使用 `scripts/import_reading.py`，而不是逐篇手刻 Markdown。它接受一行一題的 CSV／Excel，支援仔細閱讀與選詞填空，會自動生成 ID、驗證、渲染 `exam.md`，最後用 `npm run content:validate` 做 Node 權威驗證。

完整欄位表、CLI 範例、Excel 使用方式與疑難排解見 [IMPORT-READING.md](IMPORT-READING.md)。
