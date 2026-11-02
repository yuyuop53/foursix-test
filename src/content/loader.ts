import { parseExamMarkdownDetailed } from './parse';
import type { ExamBundle } from './schema';

const examFiles = import.meta.glob('../../content/exams/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const exampleFiles = import.meta.glob('../../content/examples/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const readingFiles = import.meta.glob('../../content/reading/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const listeningFiles = import.meta.glob('../../content/listening/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const allFiles: Record<string, string> = {
  ...exampleFiles,
  ...readingFiles,
  ...listeningFiles,
  ...examFiles,
};

export interface ContentLoadError {
  file: string;
  message: string;
}

export interface ContentLoadResult {
  bundles: ExamBundle[];
  errors: ContentLoadError[];
}

export function loadBundledContent(): ContentLoadResult {
  const bundles = new Map<string, ExamBundle>();
  const pathById = new Map<string, string>();
  const errors: ContentLoadError[] = [];

  const entries = Object.entries(allFiles).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [file, raw] of entries) {
    try {
      const { bundle } = parseExamMarkdownDetailed(raw, file);
      const existingPath = pathById.get(bundle.exam.id);
      if (existingPath) {
        const existingIsExam = existingPath.includes('/exams/');
        const nextIsExam = file.includes('/exams/');
        if (nextIsExam && !existingIsExam) {
          bundles.set(bundle.exam.id, bundle);
          pathById.set(bundle.exam.id, file);
        }
        continue;
      }
      bundles.set(bundle.exam.id, bundle);
      pathById.set(bundle.exam.id, file);
    } catch (error) {
      errors.push({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { bundles: [...bundles.values()], errors };
}

export function getSampleMarkdown(): string | null {
  const entry = Object.entries(exampleFiles)[0];
  return entry?.[1] ?? null;
}

export function getBundledFileCount(): number {
  return Object.keys(allFiles).length;
}
