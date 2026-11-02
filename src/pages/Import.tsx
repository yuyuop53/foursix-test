import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import {
  getBundledFileCount,
  getSampleMarkdown,
} from '../content/loader';
import {
  parseExamMarkdownDetailed,
  type ParseResult,
} from '../content/parse';
import { ingestBundles } from '../db/ingest';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  SectionTitle,
} from '../components/ui';

export default function Import() {
  const toast = useToast();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedId, setImportedId] = useState<string | null>(null);

  const loadErrors = useLiveQuery(async () => {
    const record = await db.config.get('content_load_errors');
    return Array.isArray(record?.value)
      ? (record.value as { file: string; message: string }[])
      : [];
  }, []);

  const handleParse = () => {
    try {
      const result = parseExamMarkdownDetailed(text, '貼上內容');
      setPreview(result);
      setError(null);
    } catch (parseError) {
      setPreview(null);
      setError(
        parseError instanceof Error ? parseError.message : String(parseError),
      );
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setPreview(null);
    setError(null);
  };

  const handleImport = async () => {
    if (!preview || importing) return;
    setImporting(true);
    try {
      const existing = await db.exams.get(preview.bundle.exam.id);
      if (existing) {
        setError(
          `exam.id「${preview.bundle.exam.id}」已存在。請修改 front matter 的 exam.id 後再匯入；內容管理會在後續 Phase 加入。`,
        );
        return;
      }
      await ingestBundles([preview.bundle]);
      setImportedId(preview.bundle.exam.id);
      setError(null);
      toast.push('內容已匯入，可立即開始練習', 'ok');
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : '匯入失敗',
      );
    } finally {
      setImporting(false);
    }
  };

  const sample = getSampleMarkdown();

  return (
    <div>
      <SectionTitle
        eyebrow="Import"
        title="匯入內容"
        description="貼上 exam.md，先用同一套 Zod 規則驗證，再寫入本機 IndexedDB。內容永遠不會上傳。"
        action={
          <div className="text-right text-[11px] leading-5 text-faint">
            <div>內建檔案 {getBundledFileCount()} 份</div>
            <div>使用者匯入保存在本機</div>
          </div>
        }
      />

      {loadErrors && loadErrors.length > 0 ? (
        <Card className="mb-4 border-warn/30 bg-warn/5 p-4">
          <div className="text-xs font-medium text-warn">
            內建內容有 {loadErrors.length} 個解析錯誤
          </div>
          <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted">
            {loadErrors.map((item) => (
              <li key={`${item.file}-${item.message}`}>
                <span className="text-faint">{item.file}</span>：{item.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">exam.md 內容</h2>
            <div className="flex flex-wrap gap-2">
              {sample ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setText(sample);
                    setPreview(null);
                    setError(null);
                  }}
                >
                  載入範例
                </Button>
              ) : null}
              <label className="inline-flex h-8 cursor-pointer items-center rounded-xl border border-line bg-panel-2 px-3 text-xs text-ink hover:border-accent/50 hover:text-accent">
                選擇檔案
                <input
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
              setImportedId(null);
            }}
            rows={18}
            spellCheck={false}
            placeholder="---&#10;schema_version: &quot;1.0&quot;&#10;exam:&#10;  id: exam_...&#10;..."
            className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-6 text-ink placeholder:text-faint focus:border-accent/60"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={handleParse} disabled={!text.trim()}>
              解析預覽
            </Button>
            <Button
              onClick={handleImport}
              disabled={!preview || importing || Boolean(importedId)}
            >
              {importing ? '匯入中…' : importedId ? '已匯入' : '匯入到本機'}
            </Button>
          </div>

          {error ? (
            <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-5 text-danger">
              {error}
            </div>
          ) : null}

          {importedId ? (
            <div className="mt-3 rounded-xl border border-ok/30 bg-ok/10 px-3 py-3 text-xs leading-5 text-ok">
              <div>匯入成功：{importedId}</div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => navigate(`/practice/${importedId}`)}
                >
                  開始練習
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setText('');
                    setPreview(null);
                    setImportedId(null);
                  }}
                >
                  再匯入一份
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-medium text-ink">預覽</h2>
            {!preview ? (
              <p className="mt-3 text-xs leading-6 text-faint">
                解析後會在這裡顯示 exam、passage、question 數量與警告。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-sm font-medium text-ink">
                    {preview.bundle.exam.title}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">
                    {preview.bundle.exam.id}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">
                    {preview.bundle.passages.length} 篇
                  </Badge>
                  <Badge tone="accent">
                    {preview.bundle.questions.length} 題
                  </Badge>
                  <Badge tone="muted">
                    {preview.bundle.exam.sections.join(' / ')}
                  </Badge>
                  <Badge tone="muted">
                    {preview.bundle.exam.source}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {preview.bundle.passages.map((passage) => (
                    <div
                      key={passage.id}
                      className="rounded-lg border border-line-soft bg-panel-2/50 px-3 py-2 text-xs"
                    >
                      <div className="font-medium text-ink">{passage.title}</div>
                      <div className="mt-0.5 text-[11px] text-faint">
                        {passage.id} · {passage.word_count} 詞 ·{' '}
                        {passage.hot_topic_tags.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>

                {preview.warnings.length > 0 ? (
                  <div className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] leading-5 text-warn">
                    <div className="font-medium">警告</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-[11px] text-ok">驗證通過，沒有警告。</div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium text-ink">格式提醒</h2>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-muted">
              <li>
                <span className="text-ink">Front matter</span>：
                <code className="text-accent">schema_version</code>、
                <code className="text-accent">
                  exam.id/title/year/month/set/source/license/content_version/sections
                </code>
                。
              </li>
              <li>
                <span className="text-ink">Passage</span>：
                <code className="text-accent">## Passage N</code> 下放一個{' '}
                <code className="text-accent">yaml passage</code> 區塊，再接文章正文。
              </li>
              <li>
                <span className="text-ink">Questions</span>：文章後放{' '}
                <code className="text-accent">json questions</code>{' '}
                陣列；每題至少一個考點與錯因標籤。
              </li>
              <li>
                ID 一律小寫 ASCII，例如 <code className="text-accent">exam_2024-12_set1</code>、
                <code className="text-accent">q_..._r1_01</code>。
              </li>
              <li>
                完整規範見專案目錄的{' '}
                <span className="text-accent">docs/CONTENT-AUTHORING.md</span>。
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
