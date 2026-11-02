import { describe, expect, it } from 'vitest';
import { gradeCard, scheduleNext, SRS_LADDER } from './grade';

const today = '2027-01-01';
const examClamp = '2027-06-11';

describe('gradeCard', () => {
  it('resets to stage 0 and increases lapses on again', () => {
    const result = gradeCard({
      stage: 3,
      lapses: 1,
      grade: 'again',
      today,
      examClamp,
    });
    expect(result.stage).toBe(0);
    expect(result.intervalDays).toBe(SRS_LADDER[0]);
    expect(result.dueAt).toBe('2027-01-02');
    expect(result.lapses).toBe(2);
  });

  it('keeps the stage on hard', () => {
    const result = gradeCard({
      stage: 3,
      grade: 'hard',
      today,
      examClamp,
    });
    expect(result.stage).toBe(3);
    expect(result.intervalDays).toBe(SRS_LADDER[3]);
    expect(result.lapses).toBe(0);
  });

  it('advances one stage on good', () => {
    const result = gradeCard({
      stage: 3,
      grade: 'good',
      today,
      examClamp,
    });
    expect(result.stage).toBe(4);
    expect(result.intervalDays).toBe(SRS_LADDER[4]);
    expect(result.dueAt).toBe('2027-01-16');
  });

  it('advances two stages on easy and caps at stage 6', () => {
    const result = gradeCard({
      stage: 3,
      grade: 'easy',
      today,
      examClamp,
    });
    expect(result.stage).toBe(5);
    expect(result.intervalDays).toBe(SRS_LADDER[5]);

    const capped = gradeCard({
      stage: 6,
      grade: 'easy',
      today,
      examClamp,
    });
    expect(capped.stage).toBe(6);
  });

  it('clamps dueAt to the day before the exam', () => {
    const result = gradeCard({
      stage: 6,
      grade: 'good',
      today: '2027-06-10',
      examClamp,
    });
    expect(result.dueAt).toBe('2027-06-11');
  });

  it('never schedules before today, even on exam day', () => {
    const result = gradeCard({
      stage: 6,
      grade: 'good',
      today: '2027-06-12',
      examClamp: '2027-06-11',
    });
    expect(result.dueAt).toBe('2027-06-12');
  });
});

describe('scheduleNext compatibility wrapper', () => {
  it('maps correct to good and incorrect to again', () => {
    expect(scheduleNext(0, true, today)).toMatchObject({
      stage: 1,
      intervalDays: 2,
      dueAt: '2027-01-03',
    });
    expect(scheduleNext(4, false, today)).toMatchObject({
      stage: 0,
      intervalDays: 1,
      dueAt: '2027-01-02',
    });
  });
});
