import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Exams from './pages/Exams';
import Practice from './pages/Practice';
import Mistakes from './pages/Mistakes';
import MyMistakes from './pages/MyMistakes';
import WordCard from './pages/WordCard';
import Words from './pages/Words';
import Review from './pages/Review';
import ListeningIndex from './pages/ListeningIndex';
import Listening from './pages/Listening';
import TranslationIndex from './pages/TranslationIndex';
import TranslationPractice from './pages/TranslationPractice';
import Import from './pages/Import';
import Preview from './pages/Preview';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="exams" element={<Exams />} />
        <Route path="practice/:examId" element={<Practice />} />
        <Route path="practice/:examId/:passageId" element={<Practice />} />
        <Route path="mistakes" element={<Mistakes />} />
        <Route path="my-mistakes" element={<MyMistakes />} />
        <Route path="word/:id" element={<WordCard />} />
        <Route path="words" element={<Words />} />
        <Route path="review" element={<Review />} />
        <Route path="listening" element={<ListeningIndex />} />
        <Route path="listening/:passageId" element={<Listening />} />
        <Route path="translation" element={<TranslationIndex />} />
        <Route path="translation/:examId" element={<TranslationPractice />} />
        <Route path="import" element={<Import />} />
        <Route path="preview" element={<Preview />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
