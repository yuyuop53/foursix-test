import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getLocalWord,
  markLocalWordReviewed,
  useLocalWordsRevision,
} from '../services/localWords';
import { formatDateTime } from '../lib/utils';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';

export default function WordCard() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  useLocalWordsRevision();

  let decodedId = id;
  try {
    decodedId = decodeURIComponent(id);
  } catch {
    decodedId = id;
  }
  const word = getLocalWord(decodedId);

  if (!word) {
    return (
      <EmptyState
        icon="◇"
        title="找不到这个生词"
        description="它可能已被删除，或还没有加入生词本。"
        action={<Button onClick={() => navigate('/')}>返回首页</Button>}
      />
    );
  }

  const review = () => {
    markLocalWordReviewed(word.id);
    toast.push('已标记复习，明天会再次出现在到期生词中', 'ok');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
        <Link to="/" className="hover:text-accent">
          首页
        </Link>
        <span>/</span>
        <span className="text-muted">生词卡片</span>
      </div>

      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              {word.word}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              {word.definition?.trim() || '暂无本地释义，请手动校对'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={word.reviewedAt ? 'ok' : 'accent'}>
              {word.reviewedAt ? '已复习' : '待复习'}
            </Badge>
            <Badge tone="muted">加入于 {formatDateTime(word.addedAt)}</Badge>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-line-soft bg-panel-2/40 p-4">
          <div className="mb-2 text-xs font-medium tracking-wide text-faint">
            原句出处
          </div>
          <blockquote className="border-l-2 border-accent/40 pl-3 text-sm leading-7 text-ink">
            “{word.sentence || '暂无原句' }”
          </blockquote>
          <div className="mt-3 text-[11px] leading-5 text-faint">
            {word.examTitle ? <div>{word.examTitle}</div> : null}
            {word.passageTitle ? <div>{word.passageTitle}</div> : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={review}>标记已复习</Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/exams')}
          >
            去阅读
          </Button>
        </div>
      </Card>
    </div>
  );
}
