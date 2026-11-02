import { useEffect, useState, type FormEvent } from 'react';
import { addWord } from '../db/repo';
import { Button, Modal } from './ui';
import { useToast } from './Toast';

export interface WordSource {
  questionId?: string | null;
  examId?: string | null;
  passageId?: string | null;
  sentence?: string | null;
  hotTopicTags?: string[];
}

export function WordModal({
  open,
  onClose,
  initialLemma = '',
  source,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initialLemma?: string;
  source?: WordSource;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [lemma, setLemma] = useState(initialLemma);
  const [meaning, setMeaning] = useState('');
  const [example, setExample] = useState('');
  const [tags, setTags] = useState('');
  const [isHotTerm, setIsHotTerm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLemma(initialLemma.slice(0, 80));
    setMeaning('');
    setExample(source?.sentence?.slice(0, 500) ?? '');
    setTags('');
    setIsHotTerm(false);
  }, [open, initialLemma, source?.sentence]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await addWord({
        lemma,
        meaningZh: meaning,
        example,
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        sourceQuestionId: source?.questionId,
        sourceExamId: source?.examId,
        sourcePassageId: source?.passageId,
        sourceSentence: source?.sentence,
        isHotTerm,
      });
      toast.push(result.created ? '已加入生詞本' : '已更新生詞', 'ok');
      onSaved?.();
      onClose();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '儲存失敗', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="收藏生詞">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-muted" htmlFor="word-lemma">
            單詞或片語
          </label>
          <input
            id="word-lemma"
            value={lemma}
            onChange={(event) => setLemma(event.target.value)}
            autoFocus
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-accent/60"
            placeholder="例如：narrow the gap"
            maxLength={80}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs text-muted"
            htmlFor="word-meaning"
          >
            中文意思 <span className="text-danger">*</span>
          </label>
          <input
            id="word-meaning"
            value={meaning}
            onChange={(event) => setMeaning(event.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-accent/60"
            placeholder="例如：縮小差距"
            maxLength={200}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs text-muted"
            htmlFor="word-example"
          >
            例句（選填）
          </label>
          <textarea
            id="word-example"
            value={example}
            onChange={(event) => setExample(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink placeholder:text-faint focus:border-accent/60"
            placeholder="貼上原文句子，方便日後回想語境"
            maxLength={1000}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-muted" htmlFor="word-tags">
            標籤（選填，逗號分隔）
          </label>
          <input
            id="word-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-accent/60"
            placeholder="例如：教育, 熱點術語"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={isHotTerm}
            onChange={(event) => setIsHotTerm(event.target.checked)}
            className="h-4 w-4 rounded border-line accent-[#5eead4]"
          />
          標記為熱點術語（AI 倫理、氣候變遷、心理健康等）
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" disabled={saving || !lemma.trim() || !meaning.trim()}>
            {saving ? '儲存中…' : '加入生詞本'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
