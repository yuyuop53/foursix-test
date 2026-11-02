# CET-Lab Phase 0 架構方案書

| 項目 | 內容 |
|---|---|
| 文件版本 | 1.0.0 |
| 日期 | 2026-11-01 |
| 狀態 | Phase 0 完成；Phase 1/2 已實作（見 README 與 PHASE2-REPORT） |
| 範圍 | 架構、選型、資料模型、演算法、內容格式、風險、15 天排程 |
| 不在範圍 | 任何應用程式碼、依賴安裝、UI 實作 |

> 本文件回答規格第十二節的六個問題，並給出可直接執行的 Phase 1 開工依據。所有考情數字與日期都是**預估或產品策略**，不是教育部考試中心官方公告；一律由 `config/` 管理，UI 標註「預估」。

---

## 1. 產品定位與不可違反原則

CET-Lab 是**單一使用者、本地優先、可離線**的 CET-4 訓練系統。它的差異化不是題庫數量，而是：

1. **能力導向**：診斷 → 處方 → 復診，錯題只推同考點變式，不隨機重刷。
2. **資料主權**：作答、錯題、生詞、批改紀錄全在 IndexedDB，可完整匯出／還原。
3. **版權合規**：不爬取、不內建盜版真題音頻；內容由使用者合法鍵入或使用 TTS 替代。
4. **AI 可質疑**：所有批改附原文引用與 span，允許標記「批改有誤」，規則式永遠可作為降級路徑。
5. **每天願意打開**：深色閱讀模式、低干擾、今日只給三件事。

明確不做：社群、排行榜、邀請裂變、付費牆、自動爬取、花俏 gamification。

---

## 2. 六問完整回答

### 2.1 建議選型？為什麼不用純靜態 + IndexedDB？

**選型：Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui + Dexie.js + Recharts + vite-plugin-pwa + Vitest。**

先釐清一個常見誤解：**本專案的執行時仍然是「純靜態 + IndexedDB」**。建置後的產物是靜態 HTML/JS/CSS，資料存在瀏覽器 IndexedDB，沒有伺服器資料庫。差別只在**作者層**是否需要建置步驟。

| 方案 | 優點 | 缺點 | 結論 |
|---|---|---|---|
| 純靜態 + 手寫 vanilla JS | 零建置、直接開檔 | 手刻路由、渲染、schema 遷移、內容驗證、計時器/音頻狀態、PWA 清單；6 大模組下很快失控 | 不採用 |
| **Vite + React + TS（採用）** | HMR、型別、元件化、Zod 驗證、Vitest、PWA 外掛、靜態部署 | 需要 Node 建置步驟 | **採用** |
| Next.js App Router | SSR/RSC、API route 整合 | 單人離線無 SEO/多用戶需求；伺服器概念與託管鎖定；多一層失敗模式 | 不採用 |

**為什麼不用 Next.js**：這個產品沒有 SEO、沒有多用戶、沒有伺服器渲染需求。Next.js 的價值在伺服器端，但我們的資料真相在瀏覽器。未來若要做 AI 批改代理，只需新增一個獨立的 Vercel Function／Cloudflare Worker／本機 Node proxy，前端不需要改寫。反過來說，先上 Next.js 會讓「靜態優先」變成「伺服器優先」，增加 15 天內的風險。

**為什麼需要建置步驟**：不是為了 IndexedDB，而是為了 TypeScript、元件化、Zod schema 共享、Dexie 遷移管理、PWA precache manifest、以及可測試的純函式（倒數、排程、模板檢測）。這些用手寫 vanilla 也能做，但在 15 天內重工成本更高。

**其他選型**：

| 層 | 選擇 | 理由 |
|---|---|---|
| 路由 | React Router，**hash router** | GitHub Pages／免 rewrite 託管可直接用 |
| UI 狀態 | Zustand | 只放 UI/會話狀態；資料真相用 Dexie `useLiveQuery` |
| 內容驗證 | Zod | 匯入器與執行時共用同一 schema |
| 日期 | date-fns + date-fns-tz（`Asia/Shanghai`） | 日曆日運算，避免毫秒/時區漂移 |
| 測試 | Vitest + fake-indexeddb | 排程與批改是純函式，必須有邊界測試 |
| 音頻 | HTMLAudioElement + Web Audio API（`preservesPitch`） | 變速不變調、AB 循環、逐句定位 |
| 圖表 | Recharts | 雷達圖與趨勢折線足夠 |

**刻意偏離規格**：不做 Supabase／登入（本地單例 profile）；不做 Whisper 初期整合（先錄音＋自評）；不做 Anki `.apkg`（先 TSV）；版權音頻不進 git、不預快取；hash routing。

### 2.2 批改引擎的模板比怎麼算最穩？

採**混合式、可解釋、可校正**，實作位置 `src/services/grading/template.ts`。

**正規化**：小寫、NFKC、去標點、壓縮空白，並建立「正規化字元 → 原文字元」offset 對照，確保回報的 `span` 能精準標回原文。

**句子分數**：

```
t_i = max(
  精確／正規化片語命中        1.0
  正則骨架命中                0.9
  4-gram Jaccard >= 0.65      0.8
  4-gram Jaccard 0.45–0.65    0.5
  未命中                      0
)
```

**模板比**：

```
base_ratio = Σ(t_i × 該句詞數) / 全文詞數
connective_penalty = clip((每百詞連接詞密度 − p75) / (p95 − p75), 0, 1) × 0.15
template_ratio = clip(base_ratio + connective_penalty, 0, 1)
```

連接詞懲罰獨立計算，避免把「使用連接詞」本身誤判成模板；只有密度超過 p75（預設 4.0/100 詞）才開始扣，上限 0.15。

**門檻**（放 `config/exam_rules.json`）：

| template_ratio | 判定 | 行為 |
|---|---|---|
| `< 0.10` | 低 | 不特別提示 |
| `0.10–0.20` | 中 | 給降模板改寫建議 |
| `> 0.20` | 高 | language 維度上限 3/5 |

另有一條硬規則：命中 **3 個以上高信心精確模板句**時，即使比例未超標，也觸發 language 維度上限。字數不在 120–180 只警告並提示扣分風險，**不自動歸零**。

**Trade-off**：

| 方法 | 精準度 | 召回率 | 成本 | 問題 |
|---|---|---|---|---|
| 精確／正規化片語 | 高 | 低 | 極低 | 抓不到改寫 |
| 正則骨架 | 高 | 中 | 低 | 規則需維護 |
| n-gram Jaccard | 中 | 中高 | 低 | 可能誤傷主題句／學術慣用語 |
| Embedding 相似度 | 中高 | 高 | 中（需模型） | 離線模型下載、延遲、不確定性 |
| LLM 判斷 | 高（有提示詞） | 高 | 高 | 成本、非決定性、需引用依據 |

Phase 0 選前三者，理由是**離線可用、可解釋、零邊際成本**。Embedding/LLM 留給之後的 `AIProvider`，且必須回傳同一份結構化 JSON 與 span。

**個人化校正**：

- 使用者對某個 flagged span 按「這是誤判」→ 寫入 `template_allowlist {normPhrase, detector, reason}`，之後該片語權重為 0，並從連接詞密度統計排除。
- 使用者按「這裡其實是模板」→ 加入個人黑名單，權重 1.0。
- 白名單只屬於個人、隨資料匯出；UI 提醒可能低估比例。
- 禁止整句超過 12 詞的白名單，避免把整篇文章洗白。

**翻譯文化詞**：`content/culture_terms.yaml` 先找中文詞／別名是否存在於原文；存在才檢查譯文中的英文。精確命中 2 分、詞子集或 Levenshtein ≤ `max(1, floor(0.2 × len))` 得 1 分、否則 0 分。逐條回報 `zh / got / should / status / span`。

### 2.3 真題「手動錄入」怎麼做到不痛苦？

**三層設計：作者格式 → 驗證工具 → App 內貼上匯入。**

1. **作者格式**：`content/exams/<exam-id>/exam.md`，YAML front matter 放 metadata；`## Passage N` 下用 fenced YAML 放 passage metadata；題目用 fenced JSON 陣列。詞彙用 CSV。詳細格式見 `docs/CONTENT-AUTHORING.md`。
2. **驗證工具**（Phase 1）：`scripts/validate-content.ts` 用 Zod `superRefine` 檢查唯一 ID、答案合法、至少一個考點標籤、聽力需音頻與逐字稿、字數範圍、引用定位是否存在。壞內容讓建置失敗，不進資料庫。`scripts/new-exam.ts` 產生骨架，`scripts/import-content.ts` 批量匯入。
3. **App 內貼上匯入**（`/import`，開發模式）：貼上原文 → 啟發式切出 `Passage N`、題號、A–D 選項、`Answer: B` → 可編輯預覽表格＋考點標籤自動完成 → 存成 `source:'user'`。目標：**10 分鐘內錄完一組閱讀**。

ID 規則：穩定 ASCII、不含本地化文字，例如 `exam_2024-12_set1`、`psg_exam_2024-12_set1_r1`、`q_exam_2024-12_set1_r1_03`。修改內容時建立新 `rev`，不更動已被作答紀錄引用的 ID。

### 2.4 三天沒上線，艾賓浩斯間隔怎麼回填？

**基本排程**：

- 間隔階梯 `[1, 2, 4, 7, 15, 30, 60]` 天，`stage` 0–6。
- 答對：`stage = min(stage + 1, 6)`。
- 答錯：`stage = 0`、`lapses += 1`，明天再來。
- `dueAt = startOfDay(lastReviewed + ladder[stage])`，以 `Asia/Shanghai` 日曆日計算。
- 一律 clamp：`dueAt = min(dueAt, exam_date − 1)`；若今天已超過該日，則 clamp 到今天，確保不排到過去。

**逾期隊列優先級**：未掌握錯題 → `lapses ≥ 2` 或高頻詞 → 逾期天數多 → `stage` 低 → `dueAt` 早 → 穩定隨機（以 id 雜湊，不用每次不同的亂數）。

**回填演算法**（距上次開啟 ≥ 3 天時觸發，每天首次開啟只跑一次）：

```
base     = median(最近 14 天每日複習量)，下限 20，上限 daily_review_cap
extra    = ceil(base × 0.2)
capacity = base + extra
overdue  = 所有 dueAt <= 今天且未完成的項目，依優先級排序
分配      = 今天 / 明天 / 後天，權重 45% / 35% / 20%，每天不超過 capacity
溢出      = 標記 backlog:true，dueAt 留在今天，排在正常項目之後
新詞      = 暫停 3 天
```

- 分配時不提前推進 `stage`，複習後才更新。
- 若 `D ≤ 7`，不再攤平，只取最高優先級項目到今天。
- 若三個攤平日出現在 `exam_date − 1` 之後，全部收斂到 `exam_date − 1`。
- 回填具冪等性：已調整過的項目記錄 `adjustedAt`，同一天不重複搬移。

**考期對齊**：

- `D ≤ 14`：停止新詞導入。
- `D ≤ 3`：只保留 `frequencyRank ≤ 2000` 或 `lapses ≥ 2` 的詞，以及未掌握錯題；其餘 `suspended`（不刪除，考後可恢復）。
- 積壓 > `2 × base`：暫停新詞，直到回落。
- 所有排程不得超過考試前一天；`D = 0` 當天只顯示祝語與封存入口。

### 2.5 Top 5 風險與緩解

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| 1 | **版權** | 法律風險、repo 無法公開 | 不爬取；只匯入自建／合法持有內容；音頻 local/URL/TTS，`license`、`synthetic` 欄位必填；私有音頻 gitignore 且不部署；TTS 標「非原聲」 |
| 2 | **錄入負擔** | 題庫空、專案荒廢 | 貼上匯入器＋骨架指令＋Zod 錯誤提示；先做 3 套真題＋核心詞表；量測每套錄入時間；預設範例可先跑通 |
| 3 | **15 天內範圍失控** | 做不完、每項都半成品 | 每 Phase 有硬性 cut line；Day 14 功能凍結；口語 AI 評分、熱點預測、雷達圖等列為可砍；每日 dogfood |
| 4 | **IndexedDB 被清空** | 數月資料消失 | `navigator.storage.persist()`；每 7 天或 20 個新項目提醒匯出；`.cetlab.zip` 含 manifest/checksum；遷移前自動備份；還原做 dry-run |
| 5 | **AI／批改不可信** | 使用者不再相信分數 | 規則式顯示 span、依據、信心度；分數標「預估」；「批改有誤」回饋；AI 回應用同一 Zod schema 驗證，失敗或超額自動降級 |

**Watchlist**：音頻在行動瀏覽器的同步與效能、Safari 的 IndexedDB/MediaRecorder 差異、時區與閏年邊界、內容品質參差、過度依賴 AI 而失去自己的判斷。

### 2.6 223 天長週期怎麼避免前期鬆懈、後期崩潰？

**前期（D > 120）只看累積量，不看分數。**

- 首頁顯示：累計詞彙、閱讀篇數、聽力分鐘、寫作/翻譯篇數、活躍天數、錯題掌握數。
- **不顯示預估分數**：資料不足時的分數只會製造焦慮與誤導。分數估算從 `D ≤ 120` 且至少 2 次完整模擬後才出現，並標「預估區間」。
- **D 錨定里程碑**（`config/milestones.json`）：D=210/180/150/120/90/60/30/7，各有累積目標；首頁顯示最近兩個，讓「還很遠」變成「下一個可見目標」。
- **最小可行日**：5 分鐘也算達標；用容量圈（今日完成度）取代懲罰式連續打卡，避免斷一天就放棄。
- **每週日週報**：正確率趨勢、錯因分布、倒數、下週三件事；每月 1 日做計畫 vs 實際的調整。

**後期（D ≤ 120）逐步加壓，但不突然翻倍。**

| 階段 | 條件 | 重點 | UI |
|---|---|---|---|
| 基礎積累 | D > 120 | 詞彙、輸入量、習慣 | 只顯示累積量；隱藏完整模擬 |
| 專項強化 | 120 ≥ D > 30 | 按錯因分配訓練量；每週一次計時模擬 | 顯示預估分數；每週模擬 |
| 模擬實戰 | 30 ≥ D > 7 | 每兩天一套完整題；考試模式 | 隱藏解析、不可暫停 |
| 衝刺收斂 | D ≤ 7 | 錯題重練、高頻詞、個人語料朗讀 | 停止新詞／新題 |

**報名倒數**是另一個節拍器：≤30 天出現六項準備清單，≤7 天每日提醒，報名開放當天全屏提示；可匯出 `.ics`。若錯過，系統建議備用場次（2027-12-11）並重算倒數，原日期保留在歷史，學習不中斷。若根本不符報考資格（例如非中國大陸院校學籍），系統會誠實提示，並以一般英語訓練模式繼續運作。

---

## 3. 系統架構

### 3.1 分層

```
┌──────────────────────────────────────────────┐
│ UI 層（React features + shadcn/ui）           │
│ dashboard / practice / review / writing ...   │
├──────────────────────────────────────────────┤
│ 應用服務層（純函式，可測試）                   │
│ countdown / scheduler / grading / recommend  │
├──────────────────────────────────────────────┤
│ 資料存取層（Dexie repositories）               │
│ attempts / mistakes / words / grading_records│
├──────────────────────────────────────────────┤
│ 內容層（ContentProvider）                      │
│ BundledSource（現在）→ Http/Supabase（未來）   │
├──────────────────────────────────────────────┤
│ 瀏覽器儲存（IndexedDB / Blob / Cache Storage） │
└──────────────────────────────────────────────┘
```

UI 不直接寫 IndexedDB；一律經過 repository。核心演算法不依賴 React、不直接讀 `new Date()`，時鐘由外部注入，方便測試。

### 3.2 目錄結構（Phase 1 起逐步建立）

```
cet-lab/
├─ config/
│  ├─ dates.json
│  ├─ exam_rules.json
│  └─ milestones.json
├─ content/
│  ├─ exams/<exam-id>/exam.md
│  ├─ examples/exam-sample.md
│  ├─ words/cet4-core.csv
│  └─ culture_terms.yaml
├─ schemas/
│  └─ content.schema.json
├─ scripts/
│  ├─ validate-content.ts
│  ├─ new-exam.ts
│  ├─ import-content.ts
│  └─ export-anki.ts
├─ src/
│  ├─ main.tsx / App.tsx / router.tsx
│  ├─ db/
│  │  ├─ index.ts            # Dexie schema + migrations
│  │  ├─ repositories/
│  │  └─ seed.ts
│  ├─ content/
│  │  ├─ schema.ts           # Zod
│  │  ├─ provider.ts         # ContentProvider 介面
│  │  ├─ bundled.ts
│  │  └─ generated/          # 建置產物
│  ├─ services/
│  │  ├─ time/countdown.ts
│  │  ├─ scheduler/scheduler.ts
│  │  ├─ grading/{rule.ts,template.ts,culture.ts,types.ts}
│  │  ├─ recommend/variants.ts
│  │  ├─ audio/player.ts
│  │  └─ export/{zip.ts,csv.ts,ics.ts,anki.ts}
│  ├─ features/
│  │  ├─ dashboard/
│  │  ├─ practice/
│  │  ├─ review/
│  │  ├─ mistakes/
│  │  ├─ words/
│  │  ├─ writing/
│  │  ├─ translation/
│  │  ├─ listening/
│  │  ├─ speaking/
│  │  ├─ stats/
│  │  ├─ import/
│  │  └─ settings/
│  ├─ components/ui/
│  ├─ styles/
│  └─ lib/
├─ tests/
├─ public/
│  ├─ audio/
│  └─ icons/
└─ docs/
```

### 3.3 關鍵介面

- `ContentProvider`：`listExams()`、`getBundle(examId)`、`search(query)`、`getAsset(id)`。現在是 `BundledSource`（讀建置生成的 JSON）；未來可換 `HttpSource` 或 `SupabaseSource`，上層不變。
- `GradingProvider`：`grade(input): Promise<GradingResult>`。現在是 `RuleBasedProvider`；未來 `ProxyProvider` 呼叫 serverless function，回傳同一 Zod schema；失敗、超時、超額都降級到規則式。
- `Clock`：`today(): LocalDate`，測試時注入固定日期。
- `AudioResolver`：把 `assets.backend`（local/url/tts）解析成可播放 URL/Object URL。

### 3.4 資料流

```
Markdown/JSON 內容
   → validate-content (Zod)
   → 建置生成 src/content/generated/*.json
   → 啟動時 ingest 到 Dexie（content_meta checksum 比對）
   → UI 以 useLiveQuery 查詢
   → 作答/複習/批改寫回 Dexie
   → 匯出 .cetlab.zip / CSV / ICS / Anki TSV
```

內容更新不會破壞既有作答：attempts 用 `examId/questionId/contentVersion` 引用，舊版本內容保留在 `exams`/`passages` 的歷史記錄中。

---

## 4. 資料模型

### 4.1 Dexie v1 資料表

| Table | 主鍵 / 索引 | 說明 |
|---|---|---|
| `profile` | `id`（固定 `me`） | 目標分數、每日時長、`registered` 旗標、偏好 |
| `exams` | `id, year, month, status, contentVersion` | 套題 metadata、來源、授權 |
| `passages` | `id, examId, section, order, *hotTopicTags` | 文章本體、字數、音頻 id、口音、wpm |
| `questions` | `id, examId, passageId, section, type, *knowledgeTags, *errorCauseTags, *hotTopicTags` | 題幹、選項、答案、解析、`evidenceSpans` |
| `sessions` | `id, examId, mode, startedAt` | 一次作答/模擬的容器、板塊分數 |
| `attempts` | `++id, sessionId, examId, questionId, mode, createdAt, isCorrect, [questionId+createdAt]` | 逐題作答、耗時、信心度、所處階段 |
| `mistakes` | `++id, questionId, status, nextReviewAt, *errorCauseTags, *knowledgeTags, [status+nextReviewAt]` | 每題合併一筆、錯因、掌握狀態 |
| `words` | `id, lemma, *tags, sourceQuestionId, frequencyRank, createdAt` | 生詞、來源回溯、是否熱點術語 |
| `reviews` | `++id, [itemType+itemId], dueAt, [itemType+dueAt], stage, suspended, backlog` | 單詞/錯題/文化詞的到期佇列 |
| `review_logs` | `++id, reviewId, reviewedAt, [itemType+itemId]` | 每次複習的評分與前後 stage |
| `grading_records` | `++id, taskType, attemptGroupId, createdAt, band, templateRatio` | 完整 `result` JSON、引擎與版本 |
| `speaking_records` | `++id, promptId, createdAt` | 音頻 asset id、逐字稿、自評分數 |
| `assets` | `id, kind, backend, checksum` | 音頻/圖片 metadata；不存 blob |
| `blobs` | `assetId` | 錄音與音頻 Blob，與查詢表分離 |
| `config` | `key` | dates/rules/AI overrides、personal allowlist 快取 |
| `daily_logs` | `date`（YYYY-MM-DD） | 學習分鐘、各項計數、任務完成 |
| `content_meta` | `key` | 內容/schema 版本、checksum |
| `template_allowlist` | `++id, &normPhrase` | 個人模板白名單 |

標籤一律用 multiEntry 陣列索引，不做 join table；單人資料量下這是合理取捨。`grading_records.result` 存完整結構，另把 `band`、`templateRatio`、`taskType` 拉成欄位以利查詢。

### 4.2 批改結果 JSON 契約

```json
{
  "overall_score_15": 11,
  "dimensions": { "content": 4, "logic": 4, "language": 3 },
  "template_ratio": 0.12,
  "flagged_templates": [
    {
      "text": "With the development of society",
      "span": [0, 33],
      "alt": "In 2025, campus canteens began...",
      "detector": "exact",
      "weight": 1.0
    }
  ],
  "logic_gaps": [{ "type": "claim_without_evidence", "paragraph": 2 }],
  "sentence_level": [
    {
      "original": "...",
      "issue": "中式英語",
      "fix": "...",
      "why": "...",
      "code": "chinglish",
      "span": [120, 168]
    }
  ],
  "culture_terms": [
    {
      "zh": "非遺",
      "got": "non-legacy",
      "should": "intangible cultural heritage",
      "status": "wrong",
      "span": [40, 49]
    }
  ],
  "band_reasoning": "切題、邏輯較清晰，有少量語言錯誤 → 10–12 分檔",
  "citations": ["原文第 3 句支持此判斷"],
  "engine": "rule",
  "engine_version": "1.0.0",
  "confidence": 0.62,
  "cross_attempt": {
    "group_id": "writing-2027-04-task1",
    "issue_trends": [{ "code": "subject_verb_agreement", "counts": [3, 1] }]
  }
}
```

`sentence_level[].code` 使用固定語法錯誤分類（主謂一致、時態、冠詞、介系詞、從句、流水句、中式英語、搭配、詞形、標點），清單在 `config/exam_rules.json` 的 `grading.issue_codes`，才能做跨次趨勢。這份 JSON 由 Zod schema 驗證，規則式與 AI 都必須遵守。

### 4.3 遷移與完整性

- Dexie `version(n).stores({...}).upgrade(...)`；只增不改，不刪除/改名既有欄位。
- 遷移前自動匯出快照；遷移失敗就阻止啟動並提供還原入口。
- 多分頁以 `versionchange` 事件關閉舊連線，避免資料損毀。
- 內容與 schema 各自有版本號；`content_meta` 記錄 checksum，內容變更時重新 ingest。

### 4.4 匯出格式

| 格式 | 內容 |
|---|---|
| `.cetlab.zip` | `manifest.json`（schema/content 版本、checksum、匯出時間）＋各表 JSON＋blobs |
| CSV | 逐表 UTF-8 BOM，適合 Excel/Numbers |
| `.ics` | 報名開始/截止、考試日、備用場次 |
| Anki TSV | `#separator:tab`、正面/背面/標籤欄，可直接匯入 Anki |
| 還原 | 先做 dry-run diff（新增/衝突/缺少），再選擇替換或合併 |

---

## 5. 內容層

### 5.1 作者格式

一場考試一個資料夾：`content/exams/<exam-id>/exam.md`。front matter 放 `schema_version`、`exam` metadata；正文 `## Passage N` 下用 fenced YAML 放 passage metadata，再接文章本體；題目用 fenced JSON 陣列。完整範例見 `content/examples/exam-sample.md`，規範見 `docs/CONTENT-AUTHORING.md`，正規化後的結構由 `schemas/content.schema.json` 定義。

為何是混合格式：文章用 Markdown 最好讀、最好改；題目/答案/標籤用 JSON 最好驗證、最好查詢。全部用 JSON 會讓長文難編輯，全部用 Markdown 又難以機器檢查答案。

### 5.2 ID 與版本

- `exam_2024-12_set1`
- `psg_exam_2024-12_set1_r1`
- `q_exam_2024-12_set1_r1_03`
- `w_abandon`（單詞 lemma）
- `tag_inference_attitude`、`ec_lexical`（考點/錯因）
- 使用者自建內容：`u_<timestamp>_<slug>`

修改已發布內容時建立新 `rev` 或 `contentVersion`，不覆蓋舊 ID。作答紀錄永遠能回指當時的題目版本。

### 5.3 驗證規則

`scripts/validate-content.ts` 至少檢查：

- 同一檔案內 ID 唯一；跨檔案不重複。
- 每題答案存在於選項；多選題格式正確。
- 每題至少一個 `knowledge_tags`；`error_cause_tags` 必須在允許清單。
- 閱讀題必須有 `evidence_spans`，且 `paragraph/sentence` 在文章範圍內。
- 聽力題必須有 `audio_asset_id` 與逐字稿/時間段。
- 字數、難度範圍、熱點標籤合法。
- 文化詞表每條有 `zh`、`en`，可選 `aliases`。

### 5.4 音頻後端與版權

| backend | 用途 | 注意 |
|---|---|---|
| `local` | 自己錄製/合法持有的檔案 | 私有檔案 gitignore，不部署 |
| `url` | 公開授權或自有 CDN | 記錄 `license` 與來源 |
| `tts` | 無授權音頻時的訓練替代 | 必標 `synthetic: true`、`accent`、`wpm`，UI 顯示「非原聲」 |

播放器不區分後端，只透過 `AudioResolver` 取得 URL。版權音頻不進 precache、不進公開 repo。

---

## 6. 核心演算法

### 6.1 雙倒數、階段與報名狀態

**時間源**：`config/dates.json`；時區固定 `Asia/Shanghai`；所有日期是「日曆日」，不帶時間。

```
D = differenceInCalendarDays(exam_date, today, { timeZone: 'Asia/Shanghai' })
```

**階段判定**（`config/exam_rules.json` 的 `phases.rules`，由上而下第一個符合）：

| 階段 | 條件 | D 邊界（2027-06-12 考試） |
|---|---|---|
| 基礎積累 | D > 120 | 2026-11-01 ～ 2027-02-11 |
| 專項強化 | 30 < D ≤ 120 | 2027-02-12 ～ 2027-05-12 |
| 模擬實戰 | 7 < D ≤ 30 | 2027-05-13 ～ 2027-06-04 |
| 衝刺收斂 | 0 ≤ D ≤ 7 | 2027-06-05 ～ 2027-06-12 |
| 已封存 | D < 0 | 2027-06-13 起 |

**報名狀態**：

- `not_open`：今天 < `registration_start`（2027-03-10）。
- `open`：`registration_start ≤ 今天 ≤ registration_end`（截止日含 23:59:59）。
- `registered`：profile 的 `registered = true`，優先於其他狀態。
- `missed`：今天 > `registration_end` 且未報名。

**邊界行為**：

- `D = 0`：考試當天，顯示祝語、封存入口、只讀複習；不啟動新排程。
- `D < 0`：全部轉唯讀，資料保留，可匯出。
- 閏年：2028-02-29 必須正確計入；測試 `differenceInCalendarDays` 跨 2/29。
- 報名截止日當天仍為 `open`（含 23:59:59）；隔天才是 `missed`。
- 錯過報名：顯示備用場次（2027-12-11）與備用報名（2027-09-10），提供「切換場次」按鈕；切換後重算 D 與階段，原日期保留在歷史。

### 6.2 里程碑與首頁顯示規則

- 以 D 錨定（210/180/150/120/90/60/30/7），不寫死日曆日；考試日改變時自動跟著移動。
- 首頁顯示最近兩個里程碑的完成率；`D > 120` 只顯示累積量與里程碑，不顯示預估分數。
- 每週日生成週報；每月 1 日做計畫 vs 實際調整。
- 最小可行日 5 分鐘；用容量圈與活躍天數，不用懲罰式斷簽。

### 6.3 艾賓浩斯排程器

- 階梯、升降階、clamp 見 2.4。
- 每日上限：新詞 20、複習 60（可在設定調整）。
- 到期佇列排序：未掌握錯題 → 高頻/高遺忘詞 → 逾期天數 → stage → dueAt → 穩定隨機。
- 回填：3 天門檻、45/35/20、容量 base+20%、溢出 backlog、暫停新詞 3 天、D≤7 不攤平、不超過考試前一天。
- `reviews` 一筆項目只保留最新排程；`review_logs` 保留歷史。
- 排程器是純函式：輸入 `(today, items, config, lastActiveAt)`，輸出新的排程計畫；寫入由 repository 執行。

### 6.4 模板檢測與文化詞

見 2.2。實作拆分：

- `template.ts`：正規化、offset map、片語/正則/n-gram、比例與門檻。
- `culture.ts`：術語表載入、中文定位、英文比對、Levenshtein。
- `rule.ts`：字數、維度評分、band reasoning、citations 組裝。
- `types.ts`：Zod schema 與 TypeScript 型別。

### 6.5 錯題變式推薦

候選題必須與原題共享至少一個 `knowledgeTag`，最好也共享 `errorCauseTag`；排除原題、排除已連續答對兩次的題目。

```
score = 3 × knowledgeTagOverlap
      + 2 × errorCauseOverlap
      + 1 × 同題型
      + 1 × 同熱點標籤
      + 1 × 近 14 天未出現
      − 0.5 × |難度差|
```

排序後取前 N 題，UI 顯示推薦理由（例如「同考點：推斷題・態度」）。若找不到候選，從原題的 `evidence_sentence` 生成微型練習（填空/改寫），標記 `generated: true`；**絕不隨機重刷**。

掌握判定：同一考點在至少 2 道不同變式上答對，才算掌握；之後才可從錯題本歸檔。

### 6.6 跨次批改追蹤

- 同一寫作任務（`attemptGroupId`）的多次批改共享 `sentence_level[].code` 統計。
- 第三次批改時輸出 `cross_attempt.issue_trends`，例如 `subject_verb_agreement: [3, 1]`。
- UI 文案：「你反覆犯的主謂一致問題已減少，但從句仍出錯」——必須由資料生成，不能寫死。
- 個人語料庫：把高品質句子存起來，下次改寫優先推薦自己的句型，避免越改越像 AI。

---

## 7. 路由與畫面

### 7.1 路由（hash router）

| 路由 | 畫面 |
|---|---|
| `/` | 首頁：雙倒數、階段、今日三件事、累積量、里程碑 |
| `/practice/:examId/:section` | 閱讀/聽力作答 |
| `/mock` | 完整模擬與考試模式 |
| `/review` | 到期複習佇列（單詞＋錯題） |
| `/mistakes` | 錯題本與錯因篩選 |
| `/words` | 生詞本、熱點術語子分類、來源回溯 |
| `/writing`、`/translation` | 寫作/翻譯輸入與批改 |
| `/grading/:id` | 批改結果、span 高亮、A/B 改寫、跨次 diff |
| `/listening/:passageId` | 播放器、逐句、AB 循環、聽寫 |
| `/speaking` | 錄音與自評 |
| `/stats` | 趨勢、雷達圖、錯因分布 |
| `/import` | 貼上匯入（開發模式） |
| `/settings` | 日期、規則、AI endpoint、匯出/還原 |

### 7.2 六個核心畫面

1. **首頁**：兩個倒數卡（考試、報名）、當前階段、今日三件事、累積量/里程碑、備份提醒。
2. **做題/模擬**：計時器（重新整理可恢復）、分割視窗、答題卡、考試模式隱藏解析且不可暫停。
3. **複習佇列**：單詞翻卡、錯題重練、同考點變式、推薦理由。
4. **寫作/翻譯批改**：編輯器、字數、模板 span 高亮、A/B 改寫、跨次趨勢、個人語料庫。
5. **聽力播放器**：1.0–1.5× 變速不變調、AB 單句循環、字幕同步、隱藏中文、聽寫、口音標籤。
6. **資料/設定**：日期與規則、AI endpoint、備份狀態、匯出/還原、鍵盤快捷鍵。

### 7.3 UI 原則

- 深色預設、閱讀模式排版、低干擾；字體與行寬以長文閱讀為先。
- 所有預估數字標「預估」；所有批改分數附依據。
- 鍵盤快捷鍵（1–4 選項、Enter 下一題、Space 播放/暫停）與基本無障礙（焦點、對比、ARIA）。
- 手機優先確保複習與聽力可用；桌面優先確保模擬與批改。

---

## 8. PWA、離線與匯出

- `vite-plugin-pwa` 預快取應用殼與生成的內容 JSON；音頻/圖片用 runtime cache，上限約 200MB。
- 版權音頻排除在 precache 之外，避免公開部署時散布。
- 啟動時 `navigator.storage.persist()`，設定頁顯示 `storage.estimate()`。
- 每 7 天或累積 20 個新項目提醒匯出；首頁顯示備份狀態。
- 更新提示：有新版本時顯示「重新載入」，不自動中斷作答。
- 多分頁：Dexie `liveQuery` 同步；計時器/會話用 BroadcastChannel 避免兩個分頁同時計時。

---

## 9. 測試策略

| 模組 | 必測案例 |
|---|---|
| `countdown` | D=0、D<0、D=120/119、D=30/29、D=7/6、閏年 2028-02-29、跨月/跨年、`Asia/Shanghai` 邊界、報名截止日 23:59 前後、錯過報名切備用場次 |
| `scheduler` | 階梯升降、答錯歸零、每日上限、3 天回填 45/35/20、溢出 backlog、D≤14 停新詞、D≤3 只留核心、D≤7 不攤平、clamp 到考試前一天、冪等性 |
| `template` | 精確片語、正則骨架、n-gram 命中/未命中、span offset 正確、中文標點正規化、白名單、連接詞密度、3 個精確命中觸發上限、字數不足只警告 |
| `culture` | 精確、詞子集、Levenshtein 邊界、原文沒有該詞時跳過、span 正確 |
| `variants` | 同考點優先、排除原題、排除已掌握、無候選時生成 micro-drill、絕不隨機 |
| `export/restore` | zip round-trip、CSV BOM、ICS 日期、Anki TSV 欄位、dry-run diff |
| `migrations` | v1→v2 保留資料、失敗回滾、多分頁 versionchange |

測試用 Vitest + fake-indexeddb；種子內容用 `content/examples/exam-sample.md`。批改引擎另備 10–20 篇人工標註的黄金樣本，用來校準門檻。

---

## 10. 15 天開發節奏與 cut line

| Day | Phase | 交付 | 硬性 cut line |
|---|---|---|---|
| 0 | 0 | 本方案、config、內容契約 | 凍結 schema 與 ID 規則 |
| 1–4 | 1 | 腳手架、Dexie、內容匯入、閱讀作答、錯題、生詞、首頁骨架 | **一組閱讀離線端到端可跑** |
| 5–6 | 2 | dates/rules、雙倒數、報名狀態、階段切換、排程器＋邊界測試 | **D=0、D<0、閏年、錯過報名測試綠燈** |
| 7–8 | 3 | 聽力播放器、單句循環、字幕、聽寫 | **變速＋定位＋聽寫可用** |
| 9–10 | 4 | 規則式批改、模板檢測、文化詞、歷史 diff、AI seam stub | **同一篇改三次能看到問題趨勢** |
| 11 | 5 | 今日三件事、週報、同考點變式；簡化診斷 | 錯題重練只推同考點 |
| 12 | 6 | 錄音＋自評；Whisper/AI 評分延後 | 錄音可播放、可自評 |
| 13 | 7 | PWA、匯出、快捷鍵、打磨 | 斷網可刷題/複習；匯出可還原 |
| 14 | — | 緩衝、真實內容錄入、修 bug | **功能凍結** |
| 15 | — | 只修阻塞問題、dogfood | 可每天使用 |

**可砍**：口語 AI 評分、熱點預測、雷達圖、自動週報生成、Anki `.apkg`、TTS 批量、影子跟讀對比、完整診斷測。
**不可砍**：倒數階段、離線閱讀/複習、匯出/還原、批改 span 顯示。

---

## 11. 驗收標準對照

| 規格第十節驗收項 | 交付 Phase | 驗證方式 |
|---|---|---|
| 1 分鐘完成「閱讀 → 收藏 3 詞 → 看解析 → 加錯題」 | Phase 1 | 手動計時 dogfood |
| 首頁倒數每日自動遞減、不可寫死 | Phase 2 | 注入不同日期跑單元測試＋改系統時間 |
| 報名卡狀態正確（未開放/開放中/已截止） | Phase 2 | 邊界測試（開放前一日、截止日 23:59、隔日） |
| 依 D 自動切換四階段，D≤7 衝刺 | Phase 2 | 邊界 120/30/7 測試 |
| 錯題重練只推同考點 | Phase 5 | 推薦器單元測試＋人工檢查理由 |
| 同一作文第三次批改指出跨次問題 | Phase 4 | 黄金樣本連續批改三次 |
| 斷網仍可刷題、看解析、複習 | Phase 1 + 7 | DevTools offline + PWA 安裝 |
| 一鍵匯出可在另一台機器完整還原 | Phase 7 | 兩台瀏覽器 round-trip |

---

## 12. Phase 1 開工清單

1. `npm create vite@latest . -- --template react-ts`，加入 Tailwind、shadcn/ui、Dexie、Recharts、date-fns、Zod、Vitest。
2. 把 `schemas/content.schema.json` 改寫成 Zod（`src/content/schema.ts`），讓 `scripts/validate-content.ts` 與執行時共用。
3. 建立 Dexie v1（`src/db/index.ts`）與 repositories；先做 `exams/passages/questions/attempts/mistakes/words/reviews`。
4. 實作 `BundledSource`：讀取建置生成的內容 JSON，啟動時 ingest 到 Dexie。
5. 實作最小閱讀流程：文章 → 作答 → 即時判分 → 解析（附 `evidence_spans`）→ 收藏生詞 → 加入錯題。
6. 首頁骨架：倒數先用 `config/dates.json` 顯示（完整階段邏輯留 Phase 2）。
7. 用 `content/examples/exam-sample.md` 驗收；確保離線可跑。

Phase 1 驗收：**不連網、只用本機，完成一組閱讀的完整流程。**

---

## 13. 待確認事項

1. **目標分數**（例如 500／550／600）——影響里程碑壓力與「通過」判定。
2. **報考資格**：CET-4 通常要求中國大陸院校學籍；若你不符資格，系統仍可作為訓練工具，但報名清單要誠實調整。
3. **部署方式**：只在本機、Vercel、GitHub Pages，或三者都要？
4. **音頻來源**：初期是否只用 TTS？是否有合法持有的音頻可匯入？
5. **AI 偏好**：之後接 Claude、OpenAI 兼容，或本機 Ollama？
6. **介面語言**：全繁體中文，或保留英文題幹＋中文 UI？（目前假設後者）
7. **口語模組優先級**：Phase 6 是否保留，或先延後到 15 天之後？

---

## 附錄 A：日期邊界驗算（2026-11-01 起算）

| 項目 | 日期 | D | 說明 |
|---|---|---|---|
| 今天 | 2026-11-01 | 223 | 距考試 |
| 距報名 | 2026-11-01 → 2027-03-10 | 129 | 距報名開放 |
| 基礎積累結束 | 2027-02-11 | 121 | 隔天進入專項 |
| 專項強化開始 | 2027-02-12 | 120 | `120 ≥ D > 30` |
| 報名準備 ≤30 天 | 2027-02-08 | — | 距報名 30 天 |
| 報名開放 | 2027-03-10 | — | 狀態 `open` |
| 報名截止 | 2027-03-17 | — | 含 23:59:59 |
| 報名 ≤7 天提醒 | 2027-03-03 | — | 距報名 7 天 |
| 模擬實戰開始 | 2027-05-13 | 30 | `30 ≥ D > 7` |
| 衝刺開始 | 2027-06-05 | 7 | `D ≤ 7` |
| 考試日 | 2027-06-12 | 0 | 顯示祝語、封存 |
| 封存 | 2027-06-13 | -1 | 唯讀 |

> 這些邊界由 `src/services/time/countdown.ts` 的單元測試固定；文件中的日期只是 2027-06-12 這場的參考，程式不得寫死。

## 附錄 B：規格中需標註「未證實」的說法

以下內容來自公開培訓分析或規格作者推測，**不是官方大綱**，Phase 1 起一律放 config 並在 UI 標「預估」：

- 四級語速 140–150 wpm、講座 160–180 wpm。
- 非美音占比約 30%。
- 推斷/觀點態度題比例上升、細節題下降。
- 2026 起口試與筆試合併呈現、等級改三級制、新增學術討論與職場溝通場景。
- 寫作 120–180 詞、翻譯 140–160 字。
- 模板句黑名單與各項批改門檻（屬本專案產品策略）。

若官方公布新規則，只改 `config/exam_rules.json` 與 `config/dates.json`，不重構程式碼。
