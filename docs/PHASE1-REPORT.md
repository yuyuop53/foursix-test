# Phase 1 閱讀端 MVP 報告

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-01 |
| 狀態 | 完成，可本地運行 |
| 範圍 | 閱讀端到端、錯題、生詞、內容匯入、首頁骨架 |
| 驗證 | 22 個單元測試＋headless Edge 全流程＋production preview |

## 交付內容

1. **可運行專案**：Vite + React 19 + TypeScript + Tailwind CSS v4 + Dexie + Zod + React Router（hash router）。
2. **首頁**：雙倒數（考試 223 天、報名 129 天）、階段卡、今日三件事（依實際到期／完成狀態計算）、累積量統計、題庫進度。
3. **閱讀流程**：文章與題目由 Markdown 解析、Zod 驗證後寫入 IndexedDB；作答、提交、即時判分、解析、原文引用、錯題自動歸檔。
4. **錯題本**：錯因／考點標籤、錯次、連續答對進度、依錯因篩選、重練 modal；連續答對兩次視為掌握。
5. **生詞本**：文章選字或題目下方收藏、來源回溯、例句、標籤、熱點術語手動標記、到期篩選、複習排程推進。
6. **內容匯入**：貼上／選擇 `exam.md`、即時預覽與 Zod 驗證、重複 `exam.id` 阻擋、成功匯入後可直接練習；重新整理後仍在。
7. **持久化**：所有作答、錯題、生詞、複習、匯入內容存在瀏覽器 IndexedDB（`cet-lab`）。
8. **測試**：內容解析、倒數邊界、SRS、Dexie repository，共 4 檔 22 案例。

## 如何運行

```bash
cd D:\my-projects\cet-lab
npm install
npm run dev
```

- 開發：`npm run dev` → http://localhost:5173
- 型別：`npm run typecheck`
- 測試：`npm test`
- 生產：`npm run build` → `npm run preview`

## 驗證紀錄

- `npm run build`：TypeScript 通過，Vite 產物成功。
- `npm test`：4 個測試檔、22 個案例全數通過。
- headless Edge 全流程（1440px）：
  - 首頁 → 閱讀題庫 → 範例文章 → 作答 3 題（1 錯 2 對）→ 提交 → 解析；
  - 收藏生詞 → 錯題本 → 重練答對 → 生詞複習；
  - 內容匯入預覽 → 重複 ID 阻擋 → 新 exam 成功匯入 → 重新整理後仍存在；
  - 報名標記／取消；
  - 重新整理後作答、錯題、生詞都保留。
- 390px 手機版：首頁與閱讀頁正常堆疊。
- production preview（4173）：內建內容、判分、持久化正常。
- 全流程 console errors：0。

## 已知限制（Phase 1 刻意留白）

- **SRS 尚未完整**：只有單詞的階段推進；到期佇列、三天回填、每日上限、D≤14/3 規則留待 Phase 2。
- **倒數階段只做顯示**：四階段的 UI 行為（隱藏解析、不可暫停、D≤7 收斂）尚未全部實作。
- **錯題重練是原題**：同考點變式推薦留待 Phase 5；目前以同題連續答對兩次判定掌握。
- **沒有聽力播放器**：Phase 3；內容格式已支援 `audio_asset_id`、`accent`、`wpm`、`transcript`、`segments`。
- **沒有 AI／規則式批改**：Phase 4；`gradingRecords` 表與 JSON 契約已在 Phase 0 定義。
- **沒有 PWA／匯出**：Phase 7；目前重新整理可保存，但清除瀏覽器資料會失去紀錄。
- **沒有內容管理 UI**：不能刪除或更新已匯入的 exam；重複 ID 會被阻擋。
- **選字收藏以桌面為主**：手機可用題目下方的收藏按鈕。
- **計時器重新整理會重來**：Phase 2／模擬模式會處理 session 恢復。
- **只有一份內建原創範例**：真題需自行鍵入或匯入。
- 所有日期與考情參數都是預估，非官方公告。

## 下一步：Phase 2

1. 完整四階段 UI 與行為（D>120 只看累積量、30<D≤120 每週模擬、7<D≤30 考試模式、D≤7 收斂）。
2. 報名準備清單（六項）、≤30／≤7／當天提醒、`.ics` 匯出、錯過報名切備用場次。
3. SRS 到期佇列、三天回填 45/35/20、每日上限、考期 clamp、D≤14／D≤3 規則。
4. 時間邊界測試擴充：閏年、D=0、D<0、截止日 23:59、時區。
5. 單元測試補齊階段切換與排程器。

## 檔案入口

- 首頁與說明：`README.md`
- 架構：`docs/PHASE0-ARCHITECTURE.md`
- 內容格式：`docs/CONTENT-AUTHORING.md`
- 主要程式：`src/pages/`、`src/db/`、`src/content/`、`src/services/`
