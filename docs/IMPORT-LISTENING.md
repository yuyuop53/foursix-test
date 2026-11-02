# 聽力題庫匯入（Phase A）

`scripts/import_listening.py` 把 **題目 PDF／文字檔 + 獨立答案檔** 轉成可校對的 draft JSON，並可輸出 CET-Lab 的聽力 `exam.md`。

Phase A 的定位是 **draft-first**：

1. 先解析題目、選項、答案與分組；
2. 寫出 `draft.json`，把所有 blocking／warning 列清楚；
3. 你人工校對後，才用 `--commit` 寫入 `exam.md`；
4. app 下次載入時由 `ensureSeeded()` 寫進 IndexedDB。

Phase A 本身**不做** Whisper 轉錄、也不做 ffmpeg 切音頻；這些已整合為 Phase B（`--split-audio`／`--transcribe`／`--prepare-media`，見 §3.5）。Phase A 可以讀取你已經做好的 SRT，或只有題目／答案時先產生 draft。

> 本環境沒有原生 Python、ffmpeg 或 Whisper；Python 邏輯已用 Pyodide（Python 3.14 WASM）實際跑過 24 個 unittest，ffmpeg/Whisper 的外部命令則以 fake runner / fake transcriber 驗證。真實 PDF、MP3 與模型請在你本機安裝後，先跑 `--check-deps` 再驗收。

---

## 1. 前置需求

| 需求 | 說明 |
|---|---|
| Python 3.10+ | `python --version` 可顯示版本 |
| `pdfplumber` | 只有 PDF 輸入需要：`pip install pdfplumber`；`.txt`／`.md` 不需要 |
| ffprobe（可選） | 讀取 MP3 長度；沒有時用 `--duration` |
| SRT（可選） | 有現成字幕時間時可直接匯入；沒有就先只產生 draft |

Phase A 不需要 ffmpeg、Whisper、openpyxl。

---

## 2. 檔案放置

真實考題與音頻請放 **private** 目錄，已被 `.gitignore` 排除：

```
content/private/<exam_id>/paper.pdf
content/private/<exam_id>/answers.txt
content/private/<exam_id>/listening.mp3
content/private/<exam_id>/listening.srt
content/private/<exam_id>/transcripts/l1.txt
content/private/<exam_id>/transcripts/l2.txt

content/exams/private/<exam_id>/exam.md          # --commit 輸出（本機）
public/audio/private/<exam_id>/l1.mp3            # 每段一個 MP3
public/audio/private/<exam_id>/l2.mp3
```

`content/exams/private/` 與 `public/audio/private/` 都不會進 git。  
本機 dev 可正常載入；若部署到 GitHub Pages，這些檔案不存在，該份題庫的音頻會顯示缺少。這是刻意的版權隔離。

> ⚠️ **不要上傳含 private 內容的 `dist/`**：`npm run build` 會把 `content/exams/private/**/*.md` 打包進 JS，並把 `public/audio/private/` 複製到 `dist/`。正式部署請在沒有 private 目錄的乾淨 checkout 中 build。

> `asset.src` 會寫成相對路徑，例如 `audio/private/<exam_id>/l1.mp3`。不要手動改成 `/audio/...`，否則部署在子路徑時會壞。

---

## 3. 快速開始

### 3.1 只有題目 PDF + 答案檔：先產生 draft

```bash
python -I scripts/import_listening.py \
  --pdf content/private/exam_2024-12_set1/paper.pdf \
  --answers-file content/private/exam_2024-12_set1/answers.txt \
  --exam-id exam_2024-12_set1 \
  --year 2024 --month 12 --set set1 \
  --draft content/imports/private/exam_2024-12_set1.draft.json
```

這一步會產生 draft，但因為缺逐字稿、segments、MP3，`readiness.can_commit` 會是 `false`。這是正常的——你可以先檢查題目與答案是否解析正確。

### 3.2 加上 SRT 與 passage 時間：預覽完整 Markdown

```bash
python -I scripts/import_listening.py \
  --pdf content/private/exam_2024-12_set1/paper.pdf \
  --answers-file content/private/exam_2024-12_set1/answers.txt \
  --audio content/private/exam_2024-12_set1/listening.mp3 \
  --srt content/private/exam_2024-12_set1/listening.srt \
  --spans "l1=0-128,l2=128-245,l3=245-402,l4=402-610,l5=610-790,l6=790-960,l7=960-1140,l8=1140-1320" \
  --exam-id exam_2024-12_set1 \
  --year 2024 --month 12 --set set1 \
  --allow-missing-audio \
  --dry-run
```

`--spans` 是**完整 MP3 的絕對秒數**；工具會把 SRT 的句時間重設為每段本地時間。  
`--allow-missing-audio` 只讓你預覽 Markdown，不會假裝 MP3 已經存在。

### 3.3 每段一個 SRT：不需要 `--spans`

```bash
python -I scripts/import_listening.py \
  --pdf content/private/exam_2024-12_set1/paper.pdf \
  --answers-file content/private/exam_2024-12_set1/answers.txt \
  --srt-dir content/private/exam_2024-12_set1/srt \
  --transcript-dir content/private/exam_2024-12_set1/transcripts \
  --exam-id exam_2024-12_set1 \
  --year 2024 --month 12 --set set1 \
  --allow-missing-audio --dry-run
```

`srt/` 內放 `l1.srt`、`l2.srt`……，時間是**該段 MP3 的本地時間**。  
這是你之後用 ffmpeg 切好每段 MP3 後最自然的輸入。

### 3.4 校對後 commit

```bash
python -I scripts/import_listening.py \
  --pdf content/private/exam_2024-12_set1/paper.pdf \
  --answers-file content/private/exam_2024-12_set1/answers.txt \
  --srt content/private/exam_2024-12_set1/listening.srt \
  --spans "l1=0-128,l2=128-245,l3=245-402,l4=402-610,l5=610-790,l6=790-960,l7=960-1140,l8=1140-1320" \
  --transcript-dir content/private/exam_2024-12_set1/transcripts \
  --exam-id exam_2024-12_set1 \
  --year 2024 --month 12 --set set1 \
  --commit --validate
```

`--commit` 會：

- 檢查 blocking（答案、選項、逐字稿、segments、span、MP3）；
- 寫入 `content/exams/private/<exam_id>/exam.md`；
- `--validate` 呼叫 `npm run content:validate` 用 app 的 parser 驗證。

---

## 3.5 Phase B：ffmpeg 切段 + 本地 Whisper

Phase B 已整合在同一支 CLI，用 `--split-audio`、`--transcribe` 或一次性的 `--prepare-media` 開啟。

### 安裝

**ffmpeg／ffprobe**（Windows）：

```powershell
winget install Gyan.FFmpeg
# 或 choco install ffmpeg
ffmpeg -version
ffprobe -version
```

**本地 Whisper（推薦 faster-whisper）**：

```bash
pip install faster-whisper
```

第一次使用 `small.en` 等模型時會下載到本機快取，之後可離線執行。  
替代方案：`pip install openai-whisper`（較重，需 PyTorch），或安裝 whisper.cpp CLI + `.bin` 模型。

先檢查依賴：

```bash
python -I scripts/import_listening.py --check-deps \
  --asr-engine auto --whisper-model small.en
```

輸出會列出 ffmpeg、ffprobe、各 Whisper 引擎與目前選用的引擎。

### 一鍵完成：切段 → SRT → exam.md

```bash
python -I scripts/import_listening.py \
  --pdf content/private/exam_2024-12_set1/paper.pdf \
  --answers-file content/private/exam_2024-12_set1/answers.txt \
  --audio content/private/exam_2024-12_set1/listening.mp3 \
  --spans "l1=0-128,l2=128-245,l3=245-402,l4=402-610,l5=610-790,l6=790-960,l7=960-1140,l8=1140-1320" \
  --prepare-media \
  --asr-engine faster-whisper \
  --whisper-model small.en \
  --whisper-device cpu \
  --whisper-compute-type int8 \
  --exam-id exam_2024-12_set1 \
  --year 2024 --month 12 --set set1 \
  --commit --validate
```

它會依序：

1. 用 ffmpeg 依 `--spans` 切出  
   `public/audio/private/<exam_id>/l1.mp3` …
2. 用 faster-whisper 逐段轉錄，寫出  
   `content/imports/private/srt/<exam_id>/l1.srt` …
3. 把產生的 SRT 當成 Phase A 的 `--srt-dir`，完成 draft 與 `exam.md`。

> `--transcribe`／`--prepare-media` 會使用新產生的 SRT，並忽略你另外給的 `--srt`／`--srt-dir`。若你已經有字幕，請只加 `--split-audio`，不要加 `--transcribe`。

產物：

```
public/audio/private/<exam_id>/l1.mp3
public/audio/private/<exam_id>/l2.mp3
public/audio/private/<exam_id>/manifest.json
content/imports/private/srt/<exam_id>/l1.srt
content/imports/private/srt/<exam_id>/l2.srt
content/exams/private/<exam_id>/exam.md
```

### 分開執行

只切段，SRT 你另外提供：

```bash
python -I scripts/import_listening.py ... \
  --audio full.mp3 --spans "l1=...,..." --split-audio
```

只轉錄已存在的每段 MP3（不再切段）：

```bash
python -I scripts/import_listening.py ... \
  --transcribe --srt-out content/imports/private/srt/exam_2024-12_set1
```

此時 `audio_dir` 必須已有 `l1.mp3`、`l2.mp3`…。

### Phase B 參數

| 參數 | 說明 |
|---|---|
| `--split-audio` | ffmpeg 依 `--spans` 切段 |
| `--transcribe` | 對每段 MP3 跑本地 Whisper |
| `--prepare-media` | 等同 `--split-audio --transcribe` |
| `--asr-engine` | `auto` / `faster-whisper` / `openai-whisper` / `whisper-cpp` |
| `--whisper-model` | 模型名稱；whisper-cpp 時為 `.bin` 路徑 |
| `--whisper-device` | `auto` / `cpu` / `cuda` |
| `--whisper-compute-type` | faster-whisper 的 `auto` / `int8` / `float16` / `float32` |
| `--language` | 預設 `en` |
| `--beam-size` | 預設 5 |
| `--vad-filter` / `--no-vad-filter` | 是否啟用語音活動偵測 |
| `--max-cue-chars` | 單句字幕最大字元數，預設 500 |
| `--audio-quality` | ffmpeg `-q:a` 0–9，預設 2 |
| `--srt-out` | SRT 輸出根目錄；預設 `content/imports/private/srt/<exam_id>` |
| `--force-audio` | 覆寫已存在的切段 MP3 |
| `--force-srt` | 覆寫已存在的 SRT |
| `--ffmpeg-path` | 自訂 ffmpeg 路徑 |
| `--whisper-cpp-binary` | 自訂 whisper.cpp 執行檔 |
| `--check-deps` | 只檢查依賴後結束 |

### 模型與效能

| 模型 | 建議 |
|---|---|
| `small.en` | CPU 日常首選；速度快、CET-4 通常夠用 |
| `medium.en` | 準確度更好，CPU 明顯較慢 |
| `large-v3` | 有 GPU 再考慮；最準但最慢 |
| `tiny.en` | 只適合快速預覽，錯誤較多 |

- CPU 建議 `--whisper-device cpu --whisper-compute-type int8`。
- GPU（NVIDIA / CUDA）可用 `--whisper-device cuda --whisper-compute-type float16`。
- 第一次執行會下載模型；之後從快取載入。
- 25 分鐘聽力 + `small.en` + CPU，實際時間取決於 CPU；建議先用 `--question-range 1-2` 只切第一段測試流程，成功後再跑全卷。

### 重跑與 idempotency

- 切段成功後會寫 `audio/manifest.json`，記錄來源 SHA-256、quality、spans 與檔名。
- 同樣的來源與 spans 再跑一次會直接跳過切段。
- 先只跑 `l1`、之後跑全卷時，會只補切缺少的 `l2`…`l8`，不會重切 `l1`。
- 既有的 passage span、來源 MP3 或 quality 改變時，沒有 `--force-audio` 會拒絕覆寫，避免誤蓋。
- SRT 已存在且非空時會跳過；要重新轉錄用 `--force-srt`。

### ASR 品質提醒

- Whisper 是 **ASR**，不是官方逐字稿；人名、數字、專有名詞、口音容易錯。
- 逐句聽寫與解析引用依賴 SRT，commit 前務必抽查 `l1.srt`、`l2.srt`。
- `--max-cue-chars` 會把過長句子再切；太小會切斷語意，太大會讓聽寫句子過長。
- 若轉錄結果空白或漏句，先確認 MP3 有聲音、ffmpeg 切段正常，再換 `medium.en` 或關閉 VAD 測試。

---

## 4. 題目分組

預設依 CET-4 常見 25 題結構：

| key | 題號 | 標籤 |
|---|---|---|
| `l1` | 1–2 | News Report 1 |
| `l2` | 3–4 | News Report 2 |
| `l3` | 5–7 | News Report 3 |
| `l4` | 8–11 | Conversation 1 |
| `l5` | 12–15 | Conversation 2 |
| `l6` | 16–18 | Passage 1 |
| `l7` | 19–21 | Passage 2 |
| `l8` | 22–25 | Passage 3 |

若你的卷子不同，用 `--groups-file`：

```json
[
  { "key": "l1", "label": "News Report 1", "section": "A", "questions": [1, 2] },
  { "key": "l2", "label": "Conversation 1", "section": "B", "questions": [3, 4] }
]
```

`--list-groups` 可列出預設分組後結束。

---

## 5. 答案格式

`--answers-file` 支援 `.txt`、`.md`、`.pdf`；`--answers` 支援內聯。以下都可：

```text
1:B
2:B
3:C
4:A
```

```text
1-4: BBCA
```

```text
1. B
2. C
```

PDF 答案需要 `pdfplumber` 且是文字層；掃描檔請先 OCR。

---

## 6. SRT／逐字稿

### 完整 SRT

- `--srt full.srt` + `--spans "l1=0-128,..."`。
- cue 會依 overlap 分配到各 passage；重設為本地時間。
- 若某個 cue 跨越兩段，會歸到 overlap 較大的那一段；必要時人工修正。

### 每段 SRT

- `--srt-dir srt/`，檔名必須是 `<key>.srt` 或 `<key>.vtt`。
- 時間視為該段的本地時間，不需要 `--spans`。
- 若同時給了 `--spans`，工具會警告並忽略位移。

### 逐字稿

- `--transcript-dir transcripts/`：`<key>.txt` 或 `<key>.md`。
- `--transcript file.json`：`{ "l1": "...", "l2": "..." }`。
- `--transcript file.txt`：用 `## l1`、`## l2` 分節。
- 若只提供一份沒有 key 的逐字稿，僅在只有一個 passage 時自動套用；多 passage 會警告。

> 逐字稿若和 SRT 的 cue 文本不一致，passage 的 `transcript` 用逐字稿檔，segments 用 SRT；建議兩者保持一致，否則聽寫對照會出現差異。

---

## 7. Draft 內容與 readiness

`draft.json` 大致長這樣：

```json
{
  "phase": "A",
  "source": { "pdf": "...", "srt": "...", "audio": null },
  "exam": { "id": "exam_...", "sections": ["listening"] },
  "audio": { "duration_sec": null, "sha256": null, "expected_files": [] },
  "passages": [
    {
      "key": "l1",
      "id": "psg_..._l1",
      "span": { "start": 0, "end": 128 },
      "transcript": "...",
      "word_count": 210,
      "audio": {
        "asset_id": "aud_..._l1",
        "src": "audio/private/.../l1.mp3",
        "segments": [{ "index": 0, "start": 0, "end": 3.2, "text": "..." }]
      },
      "questions": []
    }
  ],
  "readiness": {
    "can_commit": false,
    "blocking": [],
    "warnings": []
  }
}
```

常見 blocking：

| code | 意思 |
|---|---|
| `E_ANSWER_MISSING` | 某題沒有答案 |
| `E_ANSWER_NOT_IN_OPTIONS` | 答案不在 A–D 中 |
| `E_OPTIONS` | 選項少於 2 個 |
| `E_TRANSCRIPT_MISSING` | 該 passage 沒有逐字稿 |
| `E_SEGMENTS_MISSING` | 沒有逐句時間（SRT） |
| `E_SPAN_MISSING` | 完整 SRT 模式沒有給 `--spans` |
| `E_AUDIO_FILE_MISSING` | `public/audio/private/<exam>/<key>.mp3` 不存在 |
| `E_AUDIO_OUTSIDE_PUBLIC` | `--audio-out` 不在 `public/` 之下 |

`--allow-missing-audio` 與 `--allow-missing-segments` 只建議用於預覽；後者會用 `segment: 0` 佔位，逐句播放與解析引用不可用。

---

## 8. 輸出內容與 DB 關係

`exam.md` 會包含：

- `Exam`：id、年份、月份、set、source、license；
- `Asset`：每個 passage 一個 local MP3，`src: audio/private/.../<key>.mp3`，`segments` 為該段本地時間；
- `Passage`：`audio_asset_id`、`transcript`、`word_count`、`accent`、`wpm`、`hot_topic_tags`；
- `Question`：題幹、選項、答案、解析、`evidence.segment`、知識/錯因/熱點標籤。

app 載入後寫入：

| IndexedDB table | 內容 |
|---|---|
| `exams` | 試卷 metadata |
| `passages` | passage、`audioAssetId`、transcript、wpm |
| `questions` | 題目與 `evidence` |
| `assets` | `backend: "local"`、`src`、`segments` |

MP3 本身不進 IndexedDB；它留在 `public/audio/private`，由 `FileAudioBackend` 以 `BASE_URL + src` 播放。

`hot_topic_tags` 預設 `unclassified`；之後可人工或 AI 改成 `ai_ethics`、`climate_change` 等。

---

## 9. 常見問題

| 問題 | 處理 |
|---|---|
| `pdfplumber` 未安裝 | `pip install pdfplumber`，或把 PDF 轉成 `.txt` 再匯入 |
| 找不到題目 | 用 `--dump-text` 看抽取文字；確認 `--pages` 包含題目頁；必要時調整 `--question-range` |
| 選項被下一個 Section 汙染 | 已在 parser 中截斷 `Section/Questions/News Report/Conversation/Passage` 標頭；若還有其他標頭，請回報 |
| 題號缺漏 | 看 `W_QUESTION_GAP`；可能是 PDF 題號格式不同或頁面沒選到 |
| 答案沒抓到 | 檢查答案檔格式；或直接用 `--answers "1:B,2:C"` |
| `E_AUDIO_FILE_MISSING` | Phase B 會切 MP3；預覽時加 `--allow-missing-audio` |
| `E_AUDIO_OUTSIDE_PUBLIC` | `--audio-out` 必須在 `public/` 之下 |
| `找不到 ffmpeg` | `winget install Gyan.FFmpeg`，或用 `--ffmpeg-path` |
| `faster-whisper 未安裝` | `pip install faster-whisper`；或改用 openai-whisper／whisper.cpp |
| `--check-deps` 顯示 ready: no | 依序補 ffmpeg、ffprobe、Whisper；whisper-cpp 還要給 `.bin` 模型 |
| 切段 manifest 不符 | 來源 MP3 或 `--spans` 改了；確認後加 `--force-audio` |
| SRT 已存在但想重轉 | 加 `--force-srt` |
| Whisper 轉錄空白／漏句 | 確認 MP3 有聲、切段正常；換 `medium.en`、關 VAD 測試、或檢查語言是否為 en |
| 模型下載很慢 | 第一次會下載；之後從快取載入。可先換 `small.en` 或 `tiny.en` 測試流程 |
| Python 端沒跑過 | 本環境沒有 Python；請在你電腦執行 `python -I -m unittest discover -s scripts -p "test_*.py"` |

---

## 10. Phase B 已完成，後續可加強

已實作：

1. `ffmpeg` 依 `--spans` 切出每段 MP3 到 `public/audio/private/<exam_id>/`。
2. 本地 Whisper（faster-whisper / openai-whisper / whisper.cpp）逐段轉錄，產生 `<key>.srt`。
3. 產生的 SRT 直接餵回 Phase A，完成 draft／`exam.md`。
4. 切段 manifest、SRT 跳過／覆寫、`--check-deps`、sentence-level cue 切分。

後續可加強：

- 更好的 evidence 定位（同義替換、LLM 輔助）。
- 人工校對介面（目前請直接編輯 SRT 或 draft）。
- 多口音標註、per-passage `hot_topic_tags`、`transcript_zh`。
- 對 SRT 做顯示用分段／換行；目前一句一行，適合聽寫。
