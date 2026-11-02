import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseExamMarkdownDetailed } from './parse';

const contentRoot = fileURLToPath(new URL('../../content', import.meta.url));

function listMarkdown(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdown(fullPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  });
}

describe('generated content validation', () => {
  it('parses every content file and the generated fixture with the app parser', () => {
    const directories = [
      path.join(contentRoot, 'exams'),
      path.join(contentRoot, 'reading'),
      path.join(contentRoot, 'listening'),
      path.join(contentRoot, 'examples'),
    ];
    const fixture = path.join(
      contentRoot,
      'fixtures',
      'import-generated-sample.md',
    );
    const listeningFixture = path.join(
      contentRoot,
      'fixtures',
      'import-listening-sample.md',
    );

    const files = [
      ...directories.flatMap((directory) => listMarkdown(directory)),
      fixture,
      listeningFixture,
    ];

    const failures: string[] = [];
    const examFiles = new Map<string, string>();
    const examsDir = path.join(contentRoot, 'exams');

    for (const file of files) {
      if (!existsSync(file)) {
        failures.push(`缺少內容檔：${file}`);
        continue;
      }

      try {
        const raw = readFileSync(file, 'utf8');
        const { bundle, warnings } = parseExamMarkdownDetailed(raw, file);

        if (file.startsWith(examsDir)) {
          const previous = examFiles.get(bundle.exam.id);
          if (previous) {
            failures.push(
              `exam id 重複：${bundle.exam.id}（${previous} 與 ${file}）`,
            );
          } else {
            examFiles.set(bundle.exam.id, file);
          }
        }

        for (const warning of warnings) {
          console.warn(`${file}: ${warning}`);
        }
      } catch (error) {
        failures.push(
          `${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(files.some((file) => file.endsWith('import-generated-sample.md'))).toBe(
      true,
    );
    expect(files.some((file) => file.endsWith('import-listening-sample.md'))).toBe(
      true,
    );
    expect(failures).toEqual([]);
  });
});
