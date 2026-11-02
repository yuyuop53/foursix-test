# 本地四级 PDF 导入器

`import_exam_pdfs.py` 把本地 PDF 真题转换成 CET-Lab 的 JSON / exam.md。

**它只读取你放进本地的 PDF，不会访问新东方等网站。**

## 1. 准备 PDF

把 PDF 放进：

```
content/imports/pdfs/
```

目录不存在时，第一次运行脚本会自动创建。

PDF 必须是**文本层 PDF**（可以用鼠标选中文字）。纯扫描图片版需要 OCR，本脚本暂不包含 OCR。

## 2. 运行

在项目根目录执行：

```bash
cd D:\my-projects\cet-lab

"C:\Users\COLORFUL\AppData\Local\Programs\Python\Python312\python.exe" scripts/import_exam_pdfs.py
```

默认行为：

- 读取 `content/imports/pdfs/**/*.pdf`
- 写入 `public/data/<year>-<month>-<set>.json`
- 写入 `content/exams/<exam-id>/exam.md`（App 实际读取这个）
- 写入 `public/data/<year>-<month>-<set>.report.md`
- 把 PDF 提取的纯文本保存到 `content/imports/pdf-text/`

### 常用参数

```bash
# 预览解析结果，不写 JSON / exam.md
python scripts/import_exam_pdfs.py --dry-run

# 文件名/PDF 内识别不到年份、月份、套数时手动指定
python scripts/import_exam_pdfs.py --year 2024 --month 12 --set set1

# 覆盖同名 JSON / exam.md
python scripts/import_exam_pdfs.py --force

# 自定义目录
python scripts/import_exam_pdfs.py \
  --input-dir content/imports/pdfs \
  --output-dir public/data \
  --exam-md-dir content/exams
```

注意：不加 `--force` 时，如果同名试卷已存在，会自动改用 `-2`、`-3` 后缀，避免覆盖。

## 3. 导入后验证

```bash
npm run content:validate
```

然后刷新 App。新内容会从 `content/exams` 自动加载。

## 4. 解析能力与限制

### 能自动处理

- **Writing**：题目 Directions；如果 PDF 中有“参考范文：”，会一起提取。
- **Translation**：中文原文；如果 PDF 中有“参考译文：”，会一起提取。
- **Reading Section C**：Passage One/Two 原文、46–55 题目/选项/答案。
- **Reading Section A**：选词填空文章、空格 `[[1]]…[[10]]`、A–O 词库、26–35 答案。
- **Reading Section B**：A–O 段落、36–45 陈述、答案字母。
- **Listening**：1–25 题目/选项/答案；如果 PDF 中有“听力原文”且包含 News Report / Conversation / Passage 分组，会生成 TTS 听力和字幕；没有逐字稿时跳过听力并写进报告。

### 不能自动处理

- **扫描版 PDF / 图片页**：没有文本层，无法提取；报告会列出缺失。
- **只有题目没有答案**：阅读/听力题目会跳过，不会编造答案。
- **听力只有题目没有逐字稿**：不会生成听力 passage（schema 要求 `transcript`）。
- **中文题干**：现有 schema 没有单独的中文字段；题干用 `stem`（英文），中文解析放 `explanation`。
- **PDF 答案在图片里**：无法提取；需要 OCR 或手工补答案。

### 解析报告

每次导入都会生成 `public/data/<stem>.report.md`，列出：

- 已导入板块
- 跳过的题目及原因
- 自动生成的解析数量
- 警告（如 ID 冲突、覆盖）

请先看报告，再决定是否需要手工补齐。

## 5. 版权

- 只导入你有权使用的 PDF。
- `content/imports/pdfs/` 和 `content/imports/pdf-text/` 已加入 `.gitignore`，不会被提交。
- 本脚本不抓取第三方网站内容。
