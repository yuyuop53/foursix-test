import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface DictionaryFile {
  count: number;
  license: string;
  entries: Record<string, { t: string; p?: string }>;
}

const file = fileURLToPath(
  new URL('../../public/dictionary/cet4.json', import.meta.url),
);
const dictionary = JSON.parse(readFileSync(file, 'utf8')) as DictionaryFile;

describe('bundled local dictionary', () => {
  it('has broad CET-4 coverage and key words', () => {
    expect(dictionary.license).toBe('MIT');
    expect(dictionary.count).toBeGreaterThan(10000);
    expect(Object.keys(dictionary.entries)).toHaveLength(dictionary.count);

    for (const word of [
      'clothes',
      'guilty',
      'occasion',
      'dress',
      'suggest',
      'effort',
      'professional',
      'classical',
      'opera',
      'symphonic',
      'conflicting',
    ]) {
      expect(dictionary.entries[word]?.t, word).toBeTruthy();
    }
  });
});
