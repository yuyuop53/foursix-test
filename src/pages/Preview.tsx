import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionTitle,
} from '../components/ui';
import { cn } from '../lib/utils';

interface PreviewOption {
  key: string;
  text: string;
}

interface PreviewQuestion {
  number: number;
  stem: string;
  options: PreviewOption[];
  answer: string | null;
  pending: boolean;
  reasons: string[];
  raw: string;
  option_source?: string;
}

interface PreviewPassage {
  id: string;
  section: string;
  title: string;
  body: string;
  transcript?: string | null;
  transcript_pending?: boolean;
  word_bank?: PreviewOption[];
  questions?: PreviewQuestion[];
}

interface PreviewTranslation {
  id: string;
  title: string;
  body: string;
  reference: string;
}

interface PreviewWriting {
  id: string;
  title: string;
  body: string;
}

interface PreviewExam {
  exam_id: string;
  title: string;
  level: string;
  source: string;
  sections: string[];
  passages: PreviewPassage[];
  writing: PreviewWriting | null;
  translation: PreviewTranslation | null;
  issues: string[];
  stats: {
    passages: number;
    questions: number;
    pending_questions: number;
    answers: number;
  };
}

const modules = import.meta.glob('../../content/private/previews/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, PreviewExam>;

const previews = Object.values(modules).sort(
  (a, b) =>
    a.level.localeCompare(b.level) || a.exam_id.localeCompare(b.exam_id),
);

type Item =
  | { kind: 'passage'; passage: PreviewPassage }
  | { kind: 'writing'; writing: PreviewWriting }
  | { kind: 'translation'; translation: PreviewTranslation };

function renderBody(text: string) {
  return text.split(/\n\s*\n/).map((paragraph, index) => {
    const parts = paragraph.split(/(\[\[\d+\]\])/g);
    return (
      <p key={index}>
        {parts.map((part, partIndex) => {
          const match = part.match(/^\[\[(\d+)\]\]$/);
          if (!match) return <span key={partIndex}>{part}</span>;
          return (
            <span
              key={partIndex}
              className="mx-0.5 rounded bg-accent/15 px-1 text-accent"
            >
              [{match[1]}]
            </span>
          );
        })}
      </p>
    );
  });
}

export default function Preview() {
  const [level, setLevel] = useState('CET4');
  const [examId, setExamId] = useState('');
  const [itemKey, setItemKey] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);

  const levelPreviews = previews.filter(
    (item) => item.level.toLowerCase() === level.toLowerCase(),
  );
  const exam =
    levelPreviews.find((item) => item.exam_id === examId) ??
    levelPreviews[0] ??
    previews[0];

  const items: Item[] = useMemo(() => {
    if (!exam) return [];
    return [
      ...exam.passages.map(
        (passage) => ({ kind: 'passage', passage }) as Item,
      ),
      ...(exam.writing ? [{ kind: 'writing', writing: exam.writing } as Item] : []),
      ...(exam.translation
        ? [{ kind: 'translation', translation: exam.translation } as Item]
        : []),
    ];
  }, [exam]);

  const current =
    items.find((item) => {
      if (item.kind === 'passage') return item.passage.id === itemKey;
      if (item.kind === 'writing') return item.writing.id === itemKey;
      return item.translation.id === itemKey;
    }) ?? items[0];

  if (!exam) {
    return (
      <EmptyState
        icon="◇"
        title="还没有解析预览"
        description="先运行 python -I scripts/smart_parse.py 生成 content/private/previews/*.json。"
      />
    );
  }

  const currentQuestions =
    current?.kind === 'passage' ? current.passage.questions ?? [] : [];
  const visibleQuestions = pendingOnly
    ? currentQuestions.filter((question) => question.pending)
    : currentQuestions;
  const pendingQuestions = exam.passages.flatMap((passage) =>
    (passage.questions ?? [])
      .filter((question) => question.pending)
      .map((question) => ({ passage: passage.title, question })),
  );

  const currentKey = current
    ? current.kind === 'passage'
      ? `passage-${current.passage.id}`
      : current.kind === 'writing'
        ? `writing-${current.writing.id}`
        : `translation-${current.translation.id}`
    : '';

  return (
    <div className="space-y-4 overflow-x-hidden">
      <SectionTitle
        eyebrow="Preview"
        title="解析预览（只读）"
        description="这是 dry-run 的结构化预览，不写数据库、不生成 exam.md。确认排版和数据无误后再正式导入。"
        action={
          <div className="text-right text-[11px] leading-5 text-faint">
            <div>{previews.length} 套预览</div>
            <div>数据源：content/private/previews</div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {['CET4', 'CET6'].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setLevel(value);
              setExamId('');
              setItemKey('');
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition-colors',
              level === value
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-line text-muted hover:text-ink',
            )}
          >
            {value === 'CET4' ? 'CET-4 预览' : 'CET-6 预览'}
          </button>
        ))}
        <span className="text-xs text-faint">选择试卷：</span>
        {levelPreviews.map((item) => (
          <button
            key={item.exam_id}
            type="button"
            onClick={() => {
              setExamId(item.exam_id);
              setItemKey('');
            }}
            className={cn(
              'max-w-full truncate rounded-lg border px-3 py-1.5 text-xs transition-colors',
              exam.exam_id === item.exam_id
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-line text-muted hover:text-ink',
            )}
          >
            {item.title}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="accent">{exam.level.toUpperCase()}</Badge>
          {exam.sections.map((section) => (
            <Badge key={section} tone="muted">
              {section}
            </Badge>
          ))}
          <span className="text-faint">{exam.source}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {[
            ['题目', exam.stats.questions],
            ['待处理', exam.stats.pending_questions],
            ['已解析答案', exam.stats.answers],
            ['问题', exam.issues.length],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-line-soft bg-panel-2/40 px-2 py-2"
            >
              <div className="text-lg font-semibold tabular-nums text-ink">
                {value}
              </div>
              <div className="text-[11px] text-faint">{label}</div>
            </div>
          ))}
        </div>
        {exam.issues.length > 0 ? (
          <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2">
            <div className="text-xs font-medium text-warn">
              解析提示（不会丢弃原始内容）
            </div>
            <ul className="mt-1 space-y-1 text-[11px] leading-5 text-muted">
              {exam.issues.map((issue) => (
                <li key={issue}>· {issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {pendingQuestions.length > 0 ? (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
            <div className="text-xs font-medium text-danger">
              待人工确认：{pendingQuestions.length} 题
            </div>
            <ul className="mt-1 space-y-1 text-[11px] leading-5 text-muted">
              {pendingQuestions.map(({ passage, question }) => (
                <li key={`${passage}-${question.number}`}>
                  {passage} · 第 {question.number} 题 ·{' '}
                  {question.reasons.join('；') || '待确认'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const id =
            item.kind === 'passage'
              ? item.passage.id
              : item.kind === 'writing'
                ? item.writing.id
                : item.translation.id;
          const title =
            item.kind === 'passage'
              ? item.passage.title
              : item.kind === 'writing'
                ? item.writing.title
                : item.translation.title;
          const key = `${item.kind}-${id}`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setItemKey(id)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                currentKey === key
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-line text-muted hover:text-ink',
              )}
            >
              {title}
            </button>
          );
        })}
      </div>

      {current?.kind === 'passage' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Card className="min-w-0 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">
                {current.passage.title}
              </h2>
              <Badge tone="muted">{current.passage.section}</Badge>
            </div>
            <div className="reading-body">
              {renderBody(current.passage.body)}
            </div>
            {current.passage.section === 'listening' ? (
              <div className="mt-4 rounded-xl border border-line-soft bg-panel-2/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="font-medium text-ink">听力原文</span>
                  {current.passage.transcript_pending ? (
                    <Badge tone="danger">缺失，已标记待处理</Badge>
                  ) : (
                    <Badge tone="ok">已解析</Badge>
                  )}
                </div>
                {current.passage.transcript ? (
                  <p className="whitespace-pre-wrap text-xs leading-6 text-muted">
                    {current.passage.transcript}
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-faint">
                    原文不在源文件中；正式导入时不会伪造，会保留这条待处理记录。
                  </p>
                )}
              </div>
            ) : null}
            {current.passage.word_bank?.length ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-ink">词库</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {current.passage.word_bank.map((option) => (
                    <div
                      key={option.key}
                      className="rounded-lg border border-line-soft bg-panel-2/40 px-2 py-1 text-[11px] text-muted"
                    >
                      <span className="mr-1 text-faint">{option.key}.</span>
                      {option.text}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
            <div className="flex items-center justify-between text-xs text-faint">
              <span>
                本题组 {currentQuestions.length} 题 · 待处理{' '}
                {currentQuestions.filter((question) => question.pending).length}
              </span>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(event) => setPendingOnly(event.target.checked)}
                />
                只看待处理
              </label>
            </div>
            {visibleQuestions.length === 0 ? (
              <Card className="p-4 text-xs text-faint">
                没有符合筛选条件的题目。
              </Card>
            ) : (
              visibleQuestions.map((question) => (
                <Card
                  key={question.number}
                  className={cn(
                    'p-4',
                    question.pending
                      ? 'border-danger/40 bg-danger/[0.03]'
                      : 'border-line',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">
                      {question.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="question-text text-sm font-medium leading-6 text-ink break-words">
                        {question.stem || '（题干未解析）'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {question.answer ? (
                          <Badge tone="ok">答案 {question.answer}</Badge>
                        ) : (
                          <Badge tone="danger">答案待确认</Badge>
                        )}
                        {question.pending ? (
                          <Badge tone="danger">待处理</Badge>
                        ) : null}
                        {question.option_source ? (
                          <Badge tone="warn">选项修正表</Badge>
                        ) : null}
                        {question.reasons.map((reason) => (
                          <Badge key={reason} tone="muted">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {question.options.length === 0 ? (
                      <div className="rounded-lg border border-line-soft bg-panel-2/40 px-3 py-2 text-xs text-faint">
                        无选项（选词填空/写作/翻译）
                      </div>
                    ) : (
                      question.options.map((option) => (
                        <div
                          key={option.key}
                          className="flex min-w-0 items-start gap-2.5 rounded-lg border border-line-soft px-3 py-2 text-sm text-muted"
                        >
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px]">
                            {option.key}
                          </span>
                          <span className="option-text min-w-0 flex-1 break-words leading-5">
                            {option.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {question.raw ? (
                    <details className="mt-3 text-[11px] text-faint">
                      <summary className="cursor-pointer select-none">
                        查看原始文本
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line-soft bg-surface/70 p-2 text-[11px] leading-5">
                        {question.raw}
                      </pre>
                    </details>
                  ) : null}
                </Card>
              ))
            )}
          </div>
        </div>
      ) : null}

      {current?.kind === 'writing' ? (
        <Card className="p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">写作题目</h2>
          <div className="reading-body mt-3">
            {renderBody(current.writing.body)}
          </div>
        </Card>
      ) : null}

      {current?.kind === 'translation' ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="min-w-0 p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-ink">翻译原文</h2>
            <div className="reading-body mt-3">
              {renderBody(current.translation.body || '（原文未解析）')}
            </div>
          </Card>
          <Card className="min-w-0 p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-ink">参考译文</h2>
            <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted">
              {current.translation.reference || '（未在源文件中提取到参考译文）'}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
