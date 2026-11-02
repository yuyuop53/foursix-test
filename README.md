# CET-Lab

單人自用、**本地優先、可離線**的 CET-4 英語備考站。目標不是複製商業平台，而是建立一個「診斷 → 處方 → 復診」的能力導向訓練系統，所有作答、錯題、生詞、批改紀錄都留在本機，可隨時匯出。

> **目前狀態：Phase 3 完成（逐句聽寫＋閱讀題庫批量匯入）。**
> 已完成：首頁雙倒數、仔細閱讀、選詞填空、聽力 TTS／音頻檔播放器、逐句聽寫、500 詞核心詞庫、SRS 複習佇列、錯題本、生詞本、內容匯入、IndexedDB 持久化。
> 尚未開始：Phase 4 寫作／翻譯批改、Phase 5 同考點變式與診斷測、Phase 7 PWA／匯出。

## 快速開始

```bash
cd D:\my-projects\cet-lab
npm install
npm run dev        # http://localhost:5173
```

其他指令：

```bash
npm test                  # Vitest：解析、倒數、SRS、遷移、音頻、聽寫
npm run typecheck         # tsc --noEmit
npm run content:validate  # 用 app parser 驗證所有 content/**/*.md
npm run build             # 型別檢查 + 靜態產物
npm run preview           # 預覽 dist/
```

批量匯入需要 **Python 3.10+**（見 `docs/IMPORT-READING.md` 與 `docs/IMPORT-LISTENING.md`）：

```bash
python -I scripts/import_reading.py --input content/imports/reading-example.csv --dry-run --stats
python -I scripts/import_reading.py --input content/imports/reading-example.csv --output content/exams

# 聽力：題目 PDF + 答案檔 → draft；校對後 --commit
python -I scripts/import_listening.py \
  --pdf content/private/paper.pdf \
  --answers-file content/private/answers.txt \
  --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1

# 聽力 Phase B：ffmpeg 切段 + 本地 Whisper SRT（需 ffmpeg + faster-whisper）
python -I scripts/import_listening.py --check-deps
python -I scripts/import_listening.py \
  --pdf content/private/paper.pdf \
  --answers-file content/private/answers.txt \
  --audio content/private/listening.mp3 \
  --spans "l1=0-128,l2=128-245,l3=245-402,l4=402-610,l5=610-790,l6=790-960,l7=960-1140,l8=1140-1320" \
  --prepare-media --asr-engine faster-whisper --whisper-model small.en \
  --whisper-device cpu --whisper-compute-type int8 \
  --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1 \
  --commit --validate
npm run content:validate
```

> Phase B 需要 `ffmpeg`／`ffprobe` 與本地 Whisper（建議 `pip install faster-whisper`）。第一次跑模型會下載；之後可離線。完整說明見 `docs/IMPORT-LISTENING.md`。

> 這是本地部署：不連雲端、不上傳資料。第一次開啟會把 `content/` 的內容與 500 詞核心詞庫寫入瀏覽器 IndexedDB。

## 現在可以做什麼

1. **首頁**：考試／報名雙倒數、目前階段、今日三件事、累積量統計、閱讀進度。
2. **閱讀**：仔細閱讀（MCQ）與選詞填空（10 空／15 詞共用詞庫）；提交後逐題解析與原文引用。
3. **聽力**：TTS 或音頻檔播放器；0.75–1.5×、逐句高亮、點句跳轉、隱藏中文、句子 AB 循環；聽力題作答與錯題歸檔。
4. **逐句聽寫**：播放單句一次、輸入、逐詞 diff、準確率、重播上限、本輪摘要；聽寫模式會隱藏逐字稿，草稿與成績重新整理後保留。
5. **核心詞庫**：500 個高頻詞（音標、詞性、中英義、例句、搭配、詞族）；每日最多加入 20 個新詞。**首次載入會隨機排序並把順序存到 localStorage，7 天內重新整理不變**；可按「重新洗牌」重置。
6. **SRS 複習**：忘記／模糊／記得；每日複習上限 60；到期佇列、優先級、三天回填、D≤14／D≤7／D≤3 考期規則。**複習佇列也在首次載入時固定順序（7 天），重新整理不會打亂**；可按「重新洗牌」重置。
7. **錯題本**：仔細閱讀與選詞填空錯題都能重練；連續答對兩次視為掌握。
8. **內容匯入**：貼上 `exam.md`，用同一套 Zod 規則驗證後寫入本機；重複 `exam.id` 會被拒絕。另有 Python CLI 批量匯入 CSV/Excel（仔細閱讀＋選詞填空），輸出 `content/exams/<id>/exam.md`。
9. **聽力題庫匯入**：題目 PDF + 獨立答案檔 → draft；Phase B 可用 ffmpeg 依時間切段、本地 Whisper（faster-whisper / openai-whisper / whisper.cpp）產生逐段 SRT，再輸出聽力 `exam.md`。
10. **持久化**：重新整理後，作答、錯題、生詞、聽寫草稿/成績、複習排程與自訂題庫都還在。

## 專案結構

```
cet-lab/
├─ config/                  # 日期、考情規則、里程碑
├─ content/
│  ├─ words/                # 500 詞核心詞庫（5 檔 × 100）
│  ├─ reading/              # 選詞填空範例
│  ├─ listening/            # TTS 聽力範例
│  ├─ examples/             # 仔細閱讀範例
│  ├─ import-templates/     # 批量匯入 CSV 模板
│  ├─ imports/              # 匯入範例 CSV
│  ├─ fixtures/             # Node 驗證用 generated fixture
│  └─ culture_terms.yaml
├─ docs/                    # Phase 0–3 文件、內容規範
├─ schemas/                 # 內容 JSON Schema
├─ src/
│  ├─ components/           # Layout、UI primitives、Toast、WordModal、audio/
│  ├─ content/              # Markdown/JSON 解析、Zod schema、word bank loader
│  ├─ db/                   # Dexie schema、ingest、repository、dictation repo、SRS maintenance
│  ├─ features/
│  │  ├─ words/             # 我的生詞、核心詞庫
│  │  ├─ reading/           # 選詞填空
│  │  └─ listening/         # ListeningSession、DictationPanel
│  ├─ lib/                  # 標籤、格式化、stable order
│  ├─ pages/                # Dashboard / Exams / Practice / Listening / Review / ...
│  └─ services/
│     ├─ audio/             # file/TTS backends、useAudioEngine、segments、resolver
│     ├─ dictation/         # 正規化、word-level diff、accuracy
│     ├─ srs/               # grade / queue / backfill / policy
│     └─ time/              # 倒數與日曆日
├─ public/                  # favicon、未來的音頻
└─ scripts/                 # import_reading.py、Python unittest
```

## 資料與隱私

- 內容、作答、錯題、生詞、複習紀錄全部存在瀏覽器 **IndexedDB**（資料庫名稱 `cet-lab`）。
- **單詞順序快取存在 localStorage**：`cetlab:stable-order:v1:wordbank:core_500` 與 `cetlab:stable-order:v1:review:queue`，有效期 7 天；清除 localStorage 會重新洗牌。
- 沒有任何網路請求；`content/` 在建置時被打包進前端（目前 bundle 約 1.02MB，gzip 約 288KB）。
- 清除瀏覽器資料會清空學習紀錄；Phase 7 會加入 `.cetlab.zip` 匯出／還原。
- 版權內容請放 `content/private/`、`content/exams/private/` 或 `public/audio/private/`，已被 `.gitignore` 排除；部署時不會包含真實考題與音頻。
- ⚠️ 但 `npm run build` 會把本機的 `content/exams/private/**/*.md` 打包進 JS，並把 `public/audio/private/` 複製到 `dist/`；**不要上傳含 private 內容的 `dist/`**，正式部署請用沒有 private 目錄的乾淨 checkout build。

## 內容格式

- **閱讀／仔細閱讀**：Markdown + YAML front matter + fenced `yaml passage` / `json questions`。
- **選詞填空**：`subtype: banked_cloze`、共用 `word_bank`、`[[n]]` 空白標記、`blank_index`。
- **聽力**：`audio_asset_id`、`transcript`、`transcript_zh`、asset 的 `segments`；TTS 或 local/URL 音頻檔。真實考題請用「每段一個 MP3」，放在 `public/audio/private/<exam_id>/<key>.mp3`，asset 用 `backend: local`。
- **核心詞庫**：`content/words/*.json`，5 檔各 100 詞，`frequencyRank` 1–500。
- **批量匯入**：閱讀 CSV／Excel、聽力 PDF／答案檔 → Python CLI → `content/exams/<id>/exam.md`，再用 Node parser 驗證。聽力匯入器先產生 draft，校對後才 `--commit`。
- 完整規範：[docs/CONTENT-AUTHORING.md](docs/CONTENT-AUTHORING.md)、[docs/VOCAB-AUTHORING.md](docs/VOCAB-AUTHORING.md)、[docs/IMPORT-READING.md](docs/IMPORT-READING.md)。
- 匯入頁 `/import` 提供「載入範例」與即時驗證。

## 設定檔

| 檔案 | 用途 |
|---|---|
| `config/dates.json` | 考試日、報名窗口、備用場次、計畫起算日 |
| `config/exam_rules.json` | 語速、口音、題型比例、模板黑名單、SRS 參數、考期階段 |
| `config/milestones.json` | D 錨定里程碑與累積量目標 |
| `content/culture_terms.yaml` | 翻譯文化詞術語表 |

所有考情數字與日期都是**預估或產品策略，不是官方公告**；UI 標註「預估」，官方更新時只改 config。

## 測試

目前 18 個測試檔、105 個案例：

- 內容解析：仔細閱讀、選詞填空、聽力、v1.0/v1.1 相容、錯誤驗證。
- 詞庫：500 筆、rank 連續、欄位合法、加入學習與每日上限。
- 單詞順序：首次隨機、重新整理固定、新增/移除詞彙保留相對順序、reset 重新洗牌。
- 時間：223/129 天、D=0、D<0、閏年、四階段、報名邊界。
- SRS：四種評分、每日上限、優先級、三天回填、考期政策、幂等。
- Dexie：v1→v3 遷移、words/reviews/mistakes 保留、dictationRecords 可查。
- 音頻：句子切分、segment 查找、AB 邊界、單句 one-shot、TTS 模擬、檔案後端模擬。
- 聽寫：正規化、word-level diff、accuracy、重播上限與草稿還原（瀏覽器流程）。
- 內容：`npm run content:validate` 用 app parser 驗證所有 `content/**/*.md` 與 fixture。
- 批量匯入：Python unittest（需 Python 3.10+；本環境未執行）。

## 已知限制

- **TTS 語音**：瀏覽器 TTS 依系統語音包而定；headless Edge 目前只有中文語音。正常瀏覽器若沒有英語語音，頁面會提示改用音頻檔。
- **聽力範例**是 TTS 朗讀的原創逐字稿，不是官方真題音頻；音頻檔後端已實作，但需要你提供合法音檔。
- **Python 未安裝於本環境**：閱讀／聽力匯入器與 unittest 已撰寫，`pyright` 0 errors；Python 測試目前用 Pyodide（Python 3.14 WASM）實際執行。原生 Python、`pdfplumber`、`ffmpeg`、Whisper 仍需你在本機安裝後驗收。`.xlsx` 另需 `openpyxl`。
- **聽寫只做逐句輸入**：Whisper 只用來產生 SRT，不做口語評分；跟讀錄音與講座筆記未實作。
- **SRS 佇列只排單詞**；錯題仍在錯題本，維持「連續答對兩次」的掌握邏輯。
- **段落匹配**（matching）尚未實作；閱讀目前支援仔細閱讀與選詞填空。
- 沒有 PWA／匯出／AI 批改／口語。
- 500 詞為助手整理的版本，頻率序是估計值，不是官方 CET-4 詞表；建議自行校對。

## 下一步

- **你安裝 Python 後**：跑一次 `content/imports/reading-example.csv` 匯入，確認 Python 端與 Node 驗證一致。
- **Phase 4**：規則式寫作／翻譯批改（模板比、文化詞、span 引用、跨次追蹤）。
- **Phase 5**：同考點變式、診斷測驗、週報、熱點預測。
- **Phase 7**：PWA、`.cetlab.zip` 匯出／還原、Anki TSV、段落匹配、跟讀錄音。

## 文件

- [docs/PHASE0-ARCHITECTURE.md](docs/PHASE0-ARCHITECTURE.md) — Phase 0 架構方案書。
- [docs/PHASE1-REPORT.md](docs/PHASE1-REPORT.md) — Phase 1 閱讀端 MVP 報告。
- [docs/PHASE2-REPORT.md](docs/PHASE2-REPORT.md) — Phase 2 交付內容、驗證、限制、下一步。
- [docs/PHASE3-REPORT.md](docs/PHASE3-REPORT.md) — Phase 3 聽寫＋批量匯入報告。
- [docs/CONTENT-AUTHORING.md](docs/CONTENT-AUTHORING.md) — 閱讀／聽力內容錄入格式。
- [docs/VOCAB-AUTHORING.md](docs/VOCAB-AUTHORING.md) — 核心詞庫 JSON 格式。
- [docs/IMPORT-READING.md](docs/IMPORT-READING.md) — CSV/Excel 批量匯入指南。
- [docs/IMPORT-LISTENING.md](docs/IMPORT-LISTENING.md) — 聽力 PDF／答案檔／SRT 匯入指南（Phase A）。
