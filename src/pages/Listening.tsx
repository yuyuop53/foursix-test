import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { ListeningSession } from '../features/listening/ListeningSession';
import { Button, EmptyState } from '../components/ui';

export default function Listening() {
  const { passageId = '' } = useParams();
  const navigate = useNavigate();

  const data = useLiveQuery(async () => {
    const passage = await db.passages.get(passageId);
    if (!passage) {
      return {
        passage: null,
        exam: null,
        asset: null,
        questions: [],
        examQuestionCount: 0,
        prevPassage: null,
        nextPassage: null,
      };
    }
    const [exam, asset, questions, examQuestionCount, passages] =
      await Promise.all([
        db.exams.get(passage.examId),
        passage.audioAssetId
          ? db.assets.get(passage.audioAssetId)
          : Promise.resolve(null),
        db.questions.where('passageId').equals(passage.id).sortBy('id'),
        db.questions
          .where('examId')
          .equals(passage.examId)
          .filter((question) => question.section === 'listening')
          .count(),
        db.passages.where('examId').equals(passage.examId).sortBy('order'),
      ]);
    const listening = passages.filter((item) => item.section === 'listening');
    const index = listening.findIndex((item) => item.id === passage.id);
    return {
      passage,
      exam,
      asset,
      questions,
      examQuestionCount,
      prevPassage: index > 0 ? listening[index - 1] : null,
      nextPassage:
        index >= 0 && index < listening.length - 1
          ? listening[index + 1]
          : null,
    };
  }, [passageId]);

  if (!data) {
    return (
      <div className="animate-pulse-soft py-24 text-center text-sm text-muted">
        正在載入聽力內容…
      </div>
    );
  }

  if (!data.passage || !data.exam) {
    return (
      <EmptyState
        icon="?"
        title="找不到這段聽力"
        description="內容可能已被刪除，或尚未匯入。"
        action={<Button onClick={() => navigate('/listening')}>回聽力題庫</Button>}
      />
    );
  }

  if (!data.asset) {
    return (
      <EmptyState
        icon="◇"
        title="這段聽力缺少音頻資源"
        description="請在內容的 assets 區塊加入 audio_asset_id 對應的音頻。"
        action={<Button onClick={() => navigate('/listening')}>回聽力題庫</Button>}
      />
    );
  }

  return (
    <ListeningSession
      key={data.passage.id}
      exam={data.exam}
      passage={data.passage}
      asset={data.asset}
      questions={data.questions}
      examQuestionCount={data.examQuestionCount}
      prevPassage={data.prevPassage}
      nextPassage={data.nextPassage}
    />
  );
}
