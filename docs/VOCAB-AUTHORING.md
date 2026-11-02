# 核心詞庫 JSON 規範

核心詞庫是唯讀參考資料，存在 `content/words/`，由 `src/content/wordBankLoader.ts` 在建置/啟動時驗證並寫入 `wordBank` 表。加入學習後才會進入 `words` 與 SRS `reviews`。

## 檔案佈局

```
content/words/
├─ cet4_core_01.json   # frequencyRank 1–100
├─ cet4_core_02.json   # 101–200
├─ cet4_core_03.json   # 201–300
├─ cet4_core_04.json   # 301–400
└─ cet4_core_05.json   # 401–500
```

目前 500 筆；要擴充到 2,000–4,500，新增 `cet4_core_06.json` 等檔案，`band` 可用 `core_2000` / `extended_4500`。

## 檔案 envelope

```json
{
  "schemaVersion": "1.0",
  "count": 100,
  "entries": []
}
```

- `count` 必須等於 `entries.length`。
- 5 個檔案的 `frequencyRank` 必須合計連續 1–500，且 `id`/`lemma` 不得重複。

## 單筆欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | `wb_<slug>`，小寫 ASCII |
| `lemma` | ✅ | 單詞或片語 |
| `phonetics` | 選填 | `{ us?, uk? }`，IPA 字串 |
| `pos` | ✅ | `n.` / `v.` / `adj.` / `adv.` / `prep.` / `conj.` / `pron.` / `det.` / `phr.` |
| `meanings` | ✅ | `{ zh: string[], en: string[] }`，各至少一項 |
| `example` | ✅ | `{ sentence, translation }` |
| `collocations` | 選填 | 常見搭配 |
| `wordFamily` | 選填 | `[{ lemma, pos }]` |
| `tags` | 選填 | 主題／詞性標籤 |
| `frequencyRank` | ✅ | 整數，1–N |
| `band` | ✅ | `core_500` / `core_2000` / `extended_4500` |
| `source` | 選填 | `{ name, license }` |
| `notes` | 選填 | 校對備註 |

## 範例

```json
{
  "id": "wb_abandon",
  "lemma": "abandon",
  "phonetics": { "us": "/əˈbændən/", "uk": "/əˈbændən/" },
  "pos": ["v."],
  "meanings": {
    "zh": ["放棄", "拋棄"],
    "en": ["to leave something completely"]
  },
  "example": {
    "sentence": "The team had to abandon the plan because of the storm.",
    "translation": "團隊因暴風雨不得不放棄計畫。"
  },
  "collocations": ["abandon a plan", "abandon hope"],
  "wordFamily": [{ "lemma": "abandonment", "pos": "n." }],
  "tags": ["core", "cet4", "verb"],
  "frequencyRank": 1,
  "band": "core_500",
  "source": { "name": "CET-Lab original", "license": "CC0-1.0" }
}
```

## 驗證

```bash
npm test -- src/content/wordBank.test.ts
```

驗證項目：500 筆、rank 連續 1–500、id/lemma 唯一、中英義與例句齊全、Zod schema 合法。

## 資料來源誠實標註

目前 500 詞由助手依常見 CET-4 高頻範圍整理，`frequencyRank` 是**估計排序**，不是官方詞表；例句為原創。`source` 標 `CET-Lab original` / `CC0-1.0`，你可以自行校對、替換或擴充。

## 加入學習

在 `/words?tab=bank` 按「加入學習」，系統會：

1. 檢查每日新詞上限（20）與考期暫停規則。
2. 把詞庫欄位快照複製到 `words`（`wordBankId`、`origin:'bank'`）。
3. 建立 `reviews`（stage 0、due today），之後由 `/review` 排程。
