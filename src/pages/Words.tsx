import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { MyWordsTab } from '../features/words/MyWordsTab';
import { LocalWordsTab } from '../features/words/LocalWordsTab';
import { CoreBankTab } from '../features/words/CoreBankTab';
import {
  getLocalWords,
  useLocalWordsRevision,
} from '../services/localWords';
import { SectionTitle } from '../components/ui';
import { cn } from '../lib/utils';

type WordsTab = 'my' | 'local' | 'bank';

export default function Words() {
  const [params, setParams] = useSearchParams();
  useLocalWordsRevision();
  const localWords = getLocalWords();
  const requested = params.get('tab');

  const tab: WordsTab =
    requested === 'bank'
      ? 'bank'
      : requested === 'my'
        ? 'my'
        : requested === 'local'
          ? 'local'
          : localWords.length > 0
            ? 'local'
            : 'my';

  const counts = useLiveQuery(async () => {
    const [words, bank] = await Promise.all([
      db.words.count(),
      db.wordBank.count(),
    ]);
    return { words, bank };
  }, []);

  return (
    <div>
      <SectionTitle
        eyebrow="Vocabulary"
        title="單字"
        description="划词生词保存在本地浏览器；核心詞庫提供 500 個高頻詞，加入學習後由 SRS 安排複習。"
      />

      <div className="mb-4 flex flex-wrap rounded-xl border border-line bg-panel p-1">
        <button
          type="button"
          onClick={() => setParams({ tab: 'my' })}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs transition-colors',
            tab === 'my'
              ? 'bg-panel-2 text-accent'
              : 'text-muted hover:text-ink',
          )}
        >
          我的生詞 {counts?.words ?? 0}
        </button>
        <button
          type="button"
          onClick={() => setParams({ tab: 'local' })}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs transition-colors',
            tab === 'local'
              ? 'bg-panel-2 text-accent'
              : 'text-muted hover:text-ink',
          )}
        >
          划词生詞 {localWords.length}
        </button>
        <button
          type="button"
          onClick={() => setParams({ tab: 'bank' })}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs transition-colors',
            tab === 'bank'
              ? 'bg-panel-2 text-accent'
              : 'text-muted hover:text-ink',
          )}
        >
          核心詞庫 {counts?.bank ?? 0}
        </button>
      </div>

      {tab === 'bank' ? (
        <CoreBankTab />
      ) : tab === 'local' ? (
        <LocalWordsTab />
      ) : (
        <MyWordsTab />
      )}
    </div>
  );
}
