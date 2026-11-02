# 閱讀題庫批量匯入指南

`scripts/import_reading.py` 把 CSV／Excel 題庫轉成 CET-Lab 的 `exam.md` 內容檔，再用 Node/Vitest 做最終驗證。它的目標是讓「一次補幾十篇閱讀」變成可重複的流程，而不是逐篇手刻 Markdown。

> **Python 需求**：Python 3.10+。`.xlsx` 直讀另需 `openpyxl`（`pip install openpyxl`）；CSV 不需要任何第三方套件。
>
> 目前建置環境沒有可用的 Python，因此本次已驗證 **CSV 範例、目標 Markdown fixture、Node 內容驗證**；Python 端到端執行需你在自己的電腦安裝 Python 後進行。

## 檔案

| 檔案 | 用途 |
|---|---|
| `scripts/import_reading.py` | 批量匯入 CLI（stdlib；xlsx 可選 openpyxl） |
| `scripts/test_import_reading.py` | Python unittest（需 Python 3.10+） |
| `content/import-templates/reading-import-template.csv` | 表頭＋仔細閱讀／選詞填空範例 |
| `content/imports/reading-example.csv` | 可直接 dry-run 的完整範例 |
| `content/fixtures/import-generated-sample.md` | 目標 Markdown fixture（Node 測試用，不進 app） |
| `src/content/generated-content.test.ts` | 用 app parser 驗證所有內容與 fixture |

## 快速開始

```bash
# 1. 複製模板
python -I scripts/import_reading.py --template content/imports/my-reading.csv

# 2. 先 dry-run，看報告與覆蓋率
python -I scripts/import_reading.py --input content/imports/reading-example.csv --dry-run --stats

# 3. 真正寫入
python -I scripts/import_reading.py --input content/imports/my-reading.csv --output content/exams

# 4. 用 app 的 parser 做權威驗證
npm run content:validate

# 5. 重新整理 / 重啟 dev server，app 會自動 ingest 新內容
npm run dev
```

`--validate` 可在寫入後直接呼叫 `npm run content:validate`：

```bash
python -I scripts/import_reading.py --input content/imports/my-reading.csv --validate
```

## CSV 欄位

**主格式：一行一題。** 同一篇 passage 的多題重複 exam/passage 欄位；Python 依 `exam_id + passage_key` 分組。

| 類別 | 欄位 |
|---|---|
| Exam | `exam_id`, `exam_title`, `year`, `month`, `set`, `source`, `license`, `content_version` |
| Passage | `passage_key`, `passage_id?`, `section`, `subtype`, `order?`, `passage_title`, `body_md`, `hot_topic_tags`, `word_count?`, `word_bank`, `audio_asset_id?`, `accent?`, `wpm?`, `transcript?`, `transcript_zh?` |
| Question | `question_id?`, `type`, `stem`, `option_a`…`option_f`, `answer`, `explanation`, `evidence`, `evidence_quote?`, `knowledge_tags`, `error_cause_tags`, `hot_topic_tags?`, `difficulty`, `blank_index?`, `audio_span?`, `generated?` |

### 規則

- **本階段只匯入 `section=reading`**；聽力欄位保留給未來。
- `source` 預設 `user-entered`；`license` 預設 `private`；`content_version` 預設 `1.0.0`。
- `exam_id` 缺少時生成 `exam_<year>-<month>_<set>`；`passage_id` 缺少時生成 `psg_<exam>_r<order>`；`question_id` 缺少時生成 `q_<exam>_r<order>_<NN>`。
- `answer` 可填字母（A–F）或選項／詞庫文字；文字會比對後轉成 key。
- `evidence` 用 `p1s2|p2s1` 或 JSON；也可只填 `evidence_quote`，Python 會在 `body_md` 中定位並推導段落/句子。
- 標籤用 `|` 分隔；支援 `config/exam_rules.json` 的中文標籤→id。
- `subtype=banked_cloze` 時：
  - `body_md` 使用 `[[1]]`、`[[2]]`…，必須連續且依序。
  - `word_bank` 用 `A=help|B=focus|C=reduce`（也接受裸詞依序對應 A–O）。
  - 每題填 `blank_index`，`answer` 填 key；不要填 `option_a..f`。
  - 詞庫選項至少「空白數 + 3」（含 3 個干擾項），每個詞最多用一次。
- `subtype=careful_reading` 時：`option_a..f` 至少 2 個、`answer` 必須在其中；不要填 `blank_index`/`word_bank`。
- `knowledge_tags`、`error_cause_tags` 至少一個；`difficulty` 1–5。
- 同一 `passage_key` 的 body/subtype/title/order 必須一致；重複內容會用 hash 警告。

## Excel

- 單一工作表：欄位與 CSV 完全相同；Excel 另存 CSV 最省事。
- 直接 `.xlsx`：`pip install openpyxl`，然後：
  ```bash
  python -I scripts/import_reading.py --input content/imports/reading-example.xlsx --output content/exams
  ```
- 進階兩工作表：`--passages-sheet passages --questions-sheet questions`，以 `passage_key` join。
- 沒有 openpyxl 時會 exit 4 並提示安裝，不會靜默失敗。

## 驗證與輸出

Python 第一層檢查：

- Exam/Passage/Question 必填欄位、ID 格式、source/license。
- 答案在選項/詞庫、選詞填空 marker 與 blank_index、詞庫干擾項、每詞限用一次。
- evidence 是否可定位、tag allowlist、difficulty。
- 輸出檔已存在且未 `--force` → exit 3。
- 重複 exam/passage/question ID、重複 passage hash。

Node 權威驗證（`npm run content:validate`）用 app 真正的 `parseExamMarkdownDetailed` 重新解析所有 `content/**/*.md` 與 fixture；Python 不需要重複實作全部 Zod 規則。

輸出位置：`<output>/<exam_id>/exam.md`（預設 `content/exams`）。寫入是 temp file + `os.replace`；`--force` 覆蓋前會備份 `.bak`。

## CLI 摘要

```text
--input PATH...               CSV/xlsx（可用 glob）
--output PATH                 預設 content/exams
--format auto|csv|xlsx
--sheet / --passages-sheet / --questions-sheet
--dry-run                     只驗證與報告
--force                       允許覆蓋；備份 .bak
--report PATH | -             text/json 報告
--report-format text|json
--template [PATH]             複製模板；- 印到 stdout
--stats [PATH]                掃描內容並報告覆蓋率
--validate / --no-validate    寫入後呼叫 npm run content:validate
--source / --license / --schema-version / --year / --month / --set
--strict                      warnings 也視為失敗
--quiet                       只印必要輸出
```

Exit codes：`0` 成功、`1` 驗證/寫入錯誤、`2` 用法或輸入錯誤、`3` 輸出已存在、`4` 缺少 openpyxl、`5` Node 驗證失敗。

## `--stats` 覆蓋率

`--stats` 會掃描輸出目錄的 `.md`，統計：

- 檔案／passage／question 數
- 題型分布
- 難度分布
- 熱點標籤分布
- 每篇少於 3 題的檔案警告

用它決定下一批要補「哪個題型／哪個熱點」，而不是盲目增加篇數。

## 疑難排解

| 問題 | 處理 |
|---|---|
| `python: command not found` / Windows Store 別名 | 安裝 Python 3.10+（python.org 或 `winget install Python.Python.3.12`），確認 `python --version` 可用 |
| xlsx 匯入失敗 | `pip install openpyxl`，或 Excel 另存 CSV |
| `E_ANSWER_NOT_IN_OPTIONS` | 檢查 answer 與 option_a..f；文字答案需與選項文字一致 |
| `E_EVIDENCE_QUOTE` | quote 需與 body_md 完全一致（忽略大小寫/標點），或改用 `p1s2` |
| `E_CLOZE_MARKERS` | `[[n]]` 必須從 1 開始、連續、依序 |
| `E_OUTPUT_EXISTS` | 使用 `--force`，或改 `exam_id` |
| Node 驗證失敗 | 看 `npm run content:validate` 的錯誤檔名與欄位，修正 CSV 後重跑 |

## 版權

匯入器不抓取任何網路內容。預設 `source=user-entered`、`license=private`；請只匯入你自行鍵入、合法持有或公開授權的素材。TTS 音頻需標 `synthetic`，不要當成官方原聲散布。
