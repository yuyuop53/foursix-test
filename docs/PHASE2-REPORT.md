# Phase 2 報告：詞庫＋SRS＋選詞填空＋聽力播放器

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-02 |
| 狀態 | 完成（Checkpoint A + B） |
| 範圍 | 500 詞核心詞庫、SRS 排程、單詞複習、選詞填空、聽力雙後端播放器 |
| 測試 | 15 個測試檔、84 個案例 |
| 驗證 | TypeScript、build、headless Edge 全流程、390px 手機版 |

## 交付內容

### 1. 核心詞庫（500 詞）

- `content/words/cet4_core_01.json` … `_05.json`，每檔 100 詞，rank 1–500。
- 欄位：lemma、US/UK 音標、詞性、中英義、原創例句＋翻譯、搭配、詞族、標籤、頻率序、來源/授權。
- `src/content/wordBankSchema.ts` + `wordBankLoader.ts`：Zod 驗證、跨檔唯一性、rank 連續檢查。
- Dexie v2 新增 `wordBank` 表；`ensureSeeded()` 以 hash 冪等寫入，不自動加入複習。

### 2. 單詞 UI

- `/words` 分頁：**我的生詞** / **核心詞庫**。
- 核心詞庫：500 詞、搜尋、頻率區間／詞性／標籤篩選、每頁 25 詞、加入學習、今日新詞 20 上限。
- 我的生詞：音標、詞性、中英義、例句、搭配、詞族、來源文章、複習階段／到期日。
- `/review`：翻卡、顯示答案、忘記／模糊／記得、鍵盤 Space／1／2／3、每日進度、回填 banner、本輪摘要。

### 3. SRS

- `src/services/srs/`：`grade.ts`、`queue.ts`、`backfill.ts`、`policy.ts`、`types.ts`。
- 評分：Again 回 stage 0、Hard 維持 stage、Good +1、Easy +2；dueAt clamp 到考試前一天。
- 每日上限：新詞 20、複習 60；佇列優先級：新詞 → lapses≥2 → 高頻 → 逾期 → stage → dueAt → 穩定 hash。
- 三天回填：近 14 天中位數（下限 20、上限 60）、容量 +20%、45/35/20 分配到今天/+1/+2、溢出 backlog、新詞暫停 3 天、同一天冪等。
- 考期：D≤14 停新詞、D≤7 不攤平、D≤3 只留核心／高遺忘詞、全部 dueAt clamp。
- `src/db/maintenance.ts` 在啟動時執行考期政策與回填。

### 4. 選詞填空

- Schema v1.1：`subtype: banked_cloze`、`word_bank`、`blank_index`、`[[n]]` 標記。
- 解析器驗證：標記連續、每空一題、答案在詞庫、每詞限用一次、至少 3 個干擾項、v1.0 舊內容相容。
- `content/reading/banked-cloze-sample.md`：原創 10 空／15 詞／10 題。
- UI：文章內嵌下拉、共用詞庫、已填進度、提交、逐空解析、錯題自動歸檔、收藏生詞。
- 錯題本支援 banked_cloze 重練（從共用詞庫選答案）。

### 5. 聽力播放器

- `src/services/audio/`：`fileBackend.ts`（HTMLAudioElement）、`ttsBackend.ts`（SpeechSynthesis）、`segments.ts`、`resolve.ts`。
- 功能：播放／暫停、0.75–1.5×、逐句清單、點句跳轉、字幕高亮、隱藏中文、句子 AB 循環。
- 音頻檔後端：精確時間軸、`preservesPitch` 變速不變調、segment 時間對應。
- TTS 後端：逐字稿逐句朗讀、rate 控制、pause = cancel + 記住當前句、無英語語音警告。
- `/listening` 與 `/listening/:passageId`；`content/listening/listening-sample.md` 為 TTS 原創範例＋3 題。
- 聽力題作答與錯題歸檔。

### 6. 單詞順序穩定化（Stable Shuffle）

- `src/lib/stableOrder.ts`：首次載入用 Fisher–Yates 隨機洗牌，把 ID 順序寫入 localStorage；有效期 7 天。
- 套用範圍：
  - 核心詞庫：`cetlab:stable-order:v1:wordbank:core_500`；重新整理不變，新增詞彙 append、移除詞彙 drop，保留既有相對順序。
  - 複習佇列：`cetlab:stable-order:v1:review:queue`；佇列「選哪些詞」仍由 SRS 優先級與每日上限決定，只有顯示順序被洗牌並固定。
- 兩個頁面都有「重新洗牌」按鈕；localStorage 不可用時退回記憶體快取（同一次 session 內仍固定）。
- 測試：`src/lib/stableOrder.test.ts`（首次置換、跨次固定、新增/移除、reset）。

## 驗證紀錄

- `npm run typecheck`：通過。
- `npm run build`：通過（bundle 約 999KB，gzip 約 284KB）。
- `npm test`：15 檔、84 案例全數通過。
- Headless Edge（1440px）：
  - 核心詞庫 500 詞、搜尋、加入 abandon/ability、今日新詞 2/20；
  - `/review` 顯示 2 張新詞卡、顯示答案、記得／模糊、本輪完成 2/2；
  - 選詞填空 10 空、故意錯 1 空、提交 9/10、逐空解析、錯題本重練答對；
  - 聽力 index → TTS 播放器、無英語語音警告、顯示中文、點句跳轉、AB 循環、播放/暫停、3/3 作答；
  - 原有仔細閱讀 3/3 回歸；
  - 單詞順序：核心詞庫重新整理後前 5 詞完全相同、localStorage 有 `wordbank:core_500` 快取、按「重新洗牌」後順序改變；複習頁重新整理後第一張卡相同、localStorage 有 `review:queue` 快取；
  - 390px 手機版：核心詞庫、聽力播放器、選詞填空、複習頁正常。
- 全流程 console errors：0。

> Production preview（4173）已重跑：500 詞、加入學習、SRS 複習、選詞填空、聽力頁皆正常，console errors 0。

## 已知限制

- **TTS**：依系統語音包；headless Edge 只有中文語音，實際英文朗讀需在一般瀏覽器測試；無英語語音時顯示警告並使用預設語音。
- **聽力音檔**：後端已實作，但目前沒有真實音頻內容；TTS 範例為訓練替代，非官方原聲。
- **SRS 只排單詞**：錯題仍在錯題本，沒有混入每日佇列。
- **段落匹配**未實作；閱讀支援仔細閱讀＋選詞填空。
- **500 詞為估計排序**：非官方 CET-4 詞表；建議自行校對與擴充。
- 沒有 PWA／匯出／AI 批改／口語／聽寫。
- 單詞順序快取有效期 7 天；到期或按「重新洗牌」會產生新順序。清除 localStorage 也會重新洗牌。
- Bundle 約 999KB（gzip 約 284KB）；若在意首屏，可把詞庫 JSON 改 dynamic import。

## 下一步

1. **Phase 3 剩餘**：逐句聽寫、跟讀錄音、影子跟讀對比。
2. **Phase 4**：規則式寫作／翻譯批改、模板比、文化詞、跨次追蹤。
3. **Phase 5**：同考點變式、診斷測驗、週報、熱點預測。
4. **Phase 7**：PWA、`.cetlab.zip`、Anki TSV、段落匹配。

## 入口檔案

- 詞庫：`content/words/`、`src/content/wordBankSchema.ts`、`src/content/wordBankLoader.ts`
- SRS：`src/services/srs/`、`src/db/maintenance.ts`、`src/db/repo.ts`
- 選詞填空：`src/content/parse.ts`、`src/features/reading/BankedCloze.tsx`、`content/reading/`
- 聽力：`src/services/audio/`、`src/components/audio/Player.tsx`、`src/pages/Listening.tsx`、`content/listening/`
- 文件：`docs/CONTENT-AUTHORING.md`、`docs/VOCAB-AUTHORING.md`
