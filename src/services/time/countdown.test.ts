import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDaysBetween,
  getCountdown,
} from './countdown';

const noonShanghai = (date: string) => new Date(`${date}T04:00:00Z`);

describe('calendar math', () => {
  it('counts the full runway from plan start to exam', () => {
    expect(calendarDaysBetween('2026-11-01', '2027-06-12')).toBe(223);
    expect(calendarDaysBetween('2026-11-01', '2027-03-10')).toBe(129);
  });

  it('handles leap day', () => {
    expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(calendarDaysBetween('2028-01-01', '2028-03-01')).toBe(60);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
});

describe('getCountdown', () => {
  it('reports 223 days on 2026-11-01', () => {
    const countdown = getCountdown(noonShanghai('2026-11-01'), false);
    expect(countdown.today).toBe('2026-11-01');
    expect(countdown.daysToExam).toBe(223);
    expect(countdown.daysToRegistrationStart).toBe(129);
    expect(countdown.phase.id).toBe('foundation');
    expect(countdown.registrationStatus).toBe('not_open');
  });

  it('switches to intensive at D=120', () => {
    const countdown = getCountdown(noonShanghai('2027-02-12'), false);
    expect(countdown.daysToExam).toBe(120);
    expect(countdown.phase.id).toBe('intensive');
  });

  it('switches to mock at D=30', () => {
    const countdown = getCountdown(noonShanghai('2027-05-13'), false);
    expect(countdown.daysToExam).toBe(30);
    expect(countdown.phase.id).toBe('mock');
  });

  it('switches to sprint at D=7 and D=0', () => {
    expect(getCountdown(noonShanghai('2027-06-05'), false).phase.id).toBe(
      'sprint',
    );
    expect(getCountdown(noonShanghai('2027-06-12'), false).daysToExam).toBe(0);
    expect(getCountdown(noonShanghai('2027-06-12'), false).phase.id).toBe(
      'sprint',
    );
  });

  it('archives after the exam', () => {
    const countdown = getCountdown(noonShanghai('2027-06-13'), false);
    expect(countdown.daysToExam).toBe(-1);
    expect(countdown.phase.id).toBe('archived');
  });

  it('handles registration boundaries', () => {
    expect(
      getCountdown(noonShanghai('2027-03-09'), false).registrationStatus,
    ).toBe('not_open');
    expect(
      getCountdown(noonShanghai('2027-03-10'), false).registrationStatus,
    ).toBe('open');
    expect(
      getCountdown(noonShanghai('2027-03-17'), false).registrationStatus,
    ).toBe('open');
    expect(
      getCountdown(noonShanghai('2027-03-18'), false).registrationStatus,
    ).toBe('missed');
    expect(
      getCountdown(noonShanghai('2027-03-18'), true).registrationStatus,
    ).toBe('registered');
  });
});
