import { describe, expect, it } from 'vitest';
import { scheduleNext } from './srs';

describe('scheduleNext', () => {
  it('advances one stage and uses the ladder interval', () => {
    const next = scheduleNext(0, true, '2027-01-01');
    expect(next.stage).toBe(1);
    expect(next.intervalDays).toBe(2);
    expect(next.dueAt).toBe('2027-01-03');
  });

  it('resets to stage 0 on a wrong answer', () => {
    const next = scheduleNext(4, false, '2027-01-01');
    expect(next.stage).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.dueAt).toBe('2027-01-02');
  });

  it('caps the ladder at the last stage', () => {
    const next = scheduleNext(6, true, '2027-01-01');
    expect(next.stage).toBe(6);
    expect(next.intervalDays).toBe(60);
  });

  it('never schedules past the day before the exam', () => {
    const next = scheduleNext(6, true, '2027-06-10');
    expect(next.dueAt).toBe('2027-06-11');
  });

  it('keeps the due date on or after today even on exam day', () => {
    const next = scheduleNext(6, true, '2027-06-12');
    expect(next.dueAt).toBe('2027-06-12');
  });
});
