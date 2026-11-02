# Phase 3 報告：逐句聽寫＋閱讀題庫批量匯入

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-02 |
| 狀態 | 完成（聽寫＋CSV/Excel 批量匯入） |
| 測試 | 18 個測試檔、105 個案例；另 `npm run content:validate` 驗證所有內容 |
| 限制 | Python 未安裝於本環境；Python 腳本與 unittest 已撰寫，需你安裝 Python 3.10+ 後執行 |

## 交付內容

### 1. 逐句聽寫

- **Dexie v3**：新增 `dictationRecords` 表（`++id, passageId, examId, createdAt, runId, [passageId+segmentIndex], [passageId+runId], [passageId+segmentIndex+createdAt]`），只新增表，Phase 2 資料不受影響。
- **音頻**：`AudioBackend` 新增 `playSegmentOnce(index)` 與 `AudioState.segmentOnce`。
  - 檔案後端：單句 seek 後播放，到 segment end（-0.02 秒）自動 pause，one-shot 優先於 AB loop，正常播放會清除 one-shot。
  - TTS 後端：單句朗讀，`onend` 後停在該句、不進下一句/loop。
- **引擎重構**：`useAudioEngine` 統一管理 backend/state/controls；`AudioPlayer` 改為展示型元件；`ListeningSession` 子元件持有 engine，避免 early return 後呼叫 hook。
- **聽寫演算法**：`src/services/dictation/diff.ts`
  - NFKC、大小寫、標點、縮寫、數字逗號、連字號正規化。
  - word-level LCS diff（equal / missing / extra / replace）。
  - `accuracy = LCS / max(referenceWords, actualWords)`，避免亂打大量單詞拿高分。
- **UI**：`/listening/:passageId?mode=quiz|dictation`
  - 測驗／聽寫 tabs；聽寫模式 **隱藏逐字稿**，避免洩漏答案。
  - 句子選擇、播放本句（每句每輪最多 3 次）、重設本句、上一句／下一句、完成本輪。
  - Enter 檢查、Shift+Enter 換行、Alt+R 重播、Alt+N 下一句。
  - 逐詞 diff、正確句子、準確率、上次成績 badge。
  - `runId`、草稿、播放次數存 localStorage `cetlab:dictation:<passageId>`；attempts 存 Dexie。
  - 本輪摘要：平均準確率、完全正確數、每句最新分數、最需加強／最佳句子。
- **Repository**：`src/db/dictationRepo.ts`，5 秒內相同提交去重、依 passage/segment/run 查詢。

### 2. 閱讀題庫批量匯入

- **Python CLI**：`scripts/import_reading.py`
  - CSV 主格式（一行一題）；xlsx 單工作表；可選 `passages`/`questions` 兩工作表 join。
  - stdlib only；`.xlsx` lazy import `openpyxl`。
  - ID 自動生成與格式檢查、answer 文字→key、evidence `p1s2` 或 quote 定位、tag label→id、word_bank 解析、banked cloze 驗證。
  - `--dry-run`、`--force`（備份 `.bak`）、`--report`（text/json）、`--template`、`--stats`、`--validate`、`--strict`、`--quiet`。
  - 原子寫入（temp + `os.replace`）；重複 exam/passage hash 警告；輸出已存在時 exit 3。
- **模板與範例**：
  - `content/import-templates/reading-import-template.csv`（表頭＋仔細閱讀／選詞填空各一列）
  - `content/imports/reading-example.csv`（2 篇、3 題，可直接 dry-run）
  - `content/fixtures/import-generated-sample.md`（目標格式 fixture，不進 app）
- **Node 權威驗證**：`src/content/generated-content.test.ts`
  - 讀取 `content/exams`、`reading`、`listening`、`examples` 與 fixture。
  - 用 app 的 `parseExamMarkdownDetailed` 重新解析；任何 error 失敗、warnings 印出；`content/exams` 內 exam id 重複失敗。
  - `npm run content:validate`。
- **文件**：`docs/IMPORT-READING.md`（欄位、CLI、workflow、疑難排解、版權）。

## 驗證紀錄

- `npm run typecheck`：通過。
- `npm test`：**18 檔、105 案例全數通過**（新增 audio one-shot、dictation diff、Dexie v3 migration、dictation repo）。
- `npm run content:validate`：所有現有內容＋fixture 通過。
- `npm run build`：通過（bundle 約 1,016KB，gzip 約 288KB）。
- Headless Edge（1440px）：
  - 聽力測驗 3/3 回歸；
  - 聽寫 tab 隱藏逐字稿（檢查前句子不可見）；
  - 第 1 句播放 1 次、輸入正確 → 100%、顯示正確句子；
  - 第 2 句輸入部分內容 → 29%、漏寫/正確詞 diff；
  - 第 2 句播滿 3 次後按鈕停用；
  - 重新整理後 `?mode=dictation`、目前句與草稿都還原；
  - 完成本輪 → 摘要顯示已檢查 2 句、平均 65%、完全正確 1；
  - 再練一次清除草稿、開始新 runId；
  - quiz tab 3/3 正常；console errors 0。
- Production preview（4173）：同一聽寫流程（100%/29%、重播上限、草稿還原、摘要）＋測驗 3/3，console errors 0。
- 390px 手機版：聽寫初始與檢查後頁面均無水平溢出（scrollWidth = innerWidth = 390），console errors 0。
- Python：本環境無直譯器，**未實際執行**；以 `pyright` 做靜態分析（0 errors、0 warnings）。已用 Node 驗證 fixture 與所有內容；你安裝 Python 後可跑：
  ```bash
  python -I scripts/import_reading.py --template content/import-templates/reading-import-template.csv
  python -I scripts/import_reading.py --input content/imports/reading-example.csv --dry-run --stats --report -
  python -I scripts/import_reading.py --input content/imports/reading-example.csv --output content/exams
  npm run content:validate
  python -I -m unittest discover -s scripts -p "test_*.py"
  ```

## 已知限制

- **Python 尚未在此環境執行**：腳本與 unittest 只做靜態審查與目標格式驗證；實際 CLI 行為需你安裝 Python 3.10+ 後確認。
- `.xlsx` 直讀需要 `openpyxl`；沒有時請另存 CSV。
- 聽寫 TTS 仍受系統英語語音包限制；無英語語音時沿用既有警告，可改用音頻檔。
- 聽寫只做逐句輸入與 diff，沒有 ASR/Whisper 自動評分；跟讀錄音與講座筆記不在本次範圍。
- 匯入後需要重新整理或重啟 dev server；`ensureSeeded` 以內容 hash 重新 ingest，舊作答保留。
- 目前 `--stats` 的熱點統計以 regex 掃描 Markdown，屬近似值。
- Bundle 首屏約 1MB；若在意可把詞庫／內容改成 dynamic import。
- 測試環境沒有 Python，`scripts/test_import_reading.py` 未在 CI 綠燈；請把它當作你本機的驗收腳本。

## 下一步

1. 你安裝 Python 後跑一次 `reading-example.csv` 匯入，確認 Python 端行為與 Node 驗證一致。
2. Phase 4：寫作／翻譯規則式批改（模板比、文化詞、跨次追蹤）。
3. Phase 5：同考點變式、診斷測驗、週報、熱點預測。
4. Phase 7：PWA、`.cetlab.zip` 匯出／還原、Anki TSV、段落匹配。

## 入口檔案

- 聽寫：`src/services/dictation/diff.ts`、`src/features/listening/DictationPanel.tsx`、`src/components/audio/useAudioEngine.ts`、`src/db/dictationRepo.ts`
- 匯入：`scripts/import_reading.py`、`content/import-templates/`、`content/imports/reading-example.csv`、`src/content/generated-content.test.ts`
- 文件：`docs/IMPORT-READING.md`
