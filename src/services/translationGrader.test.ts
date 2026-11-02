import { describe, expect, it } from 'vitest';
import { extractReference, gradeTranslation } from './translationGrader';

const reference = `In recent years, Northeast China has been vigorously developing its ice and snow resources. For instance, Harbin has created the highly distinctive "Ice and Snow World" by leveraging its abundant ice and snow resources, allowing visitors to appreciate the beauty of ice and snow while experiencing the region's unique folk culture. What was once an intimidating frozen landscape is now attracting tourists from all directions, becoming a highly popular tourist destination. The ice and snow tourism industry is making an increasingly significant contribution to local economic development.`;

describe('translationGrader', () => {
  it('extracts the reference translation from the explanation', () => {
    const explanation = `参考译文：\n\n${reference}\n\n译点提示：\n1. “近年来”译为 In recent years。`;
    expect(extractReference(explanation)).toBe(reference);
  });

  it('gives a high score to a complete translation', () => {
    const grade = gradeTranslation(reference, reference);

    expect(grade.total).toBe(15);
    expect(grade.isPass).toBe(true);
    expect(grade.keywordMissing).toEqual([]);
    expect(grade.sentenceCount).toBe(4);
    expect(grade.dimensions.map((dimension) => dimension.score)).toEqual([
      5, 5, 5,
    ]);
    expect(grade.suggestions).toHaveLength(1);
  });

  it('flags missing information and structural weaknesses', () => {
    const partial =
      'In recent years, Northeast China has been developing its ice and snow resources.';
    const grade = gradeTranslation(partial, reference);

    expect(grade.total).toBeLessThan(9);
    expect(grade.isPass).toBe(false);
    expect(grade.keywordMissing.length).toBeGreaterThan(0);
    expect(grade.suggestions.join(' ')).toContain('关键信息覆盖不足');
    expect(grade.suggestions.join(' ')).toContain('译文偏短');
  });
});
