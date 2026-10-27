import { describe, expect, it } from 'vitest';
import { isDue, nextReviewSchedule } from './kbReview';

const DAY = 24 * 60 * 60 * 1000;

describe('nextReviewSchedule', () => {
  it('again 十分钟后重新出现并清零', () => {
    const result = nextReviewSchedule({ intervalDays: 14, streak: 3 }, 'again', 1000);
    expect(result).toEqual({ intervalDays: 0, streak: 0, dueAt: 1000 + 10 * 60 * 1000 });
  });

  it('good 按 1/3/7 天推进', () => {
    expect(nextReviewSchedule({ intervalDays: 0, streak: 0 }, 'good', 0)).toMatchObject({
      intervalDays: 1,
      streak: 1,
      dueAt: DAY
    });
    expect(nextReviewSchedule({ intervalDays: 1, streak: 1 }, 'good', 0)).toMatchObject({
      intervalDays: 3,
      streak: 2
    });
    expect(nextReviewSchedule({ intervalDays: 3, streak: 2 }, 'good', 0)).toMatchObject({
      intervalDays: 7,
      streak: 3
    });
  });

  it('hard 只小幅延长，不增加连续次数', () => {
    const result = nextReviewSchedule({ intervalDays: 7, streak: 2 }, 'hard', 0);
    expect(result.intervalDays).toBe(8);
    expect(result.streak).toBe(2);
    expect(result.dueAt).toBe(8 * DAY);
  });

  it('间隔上限 365 天', () => {
    expect(nextReviewSchedule({ intervalDays: 400, streak: 10 }, 'hard', 0).intervalDays).toBe(365);
  });
});

describe('isDue', () => {
  it('到期时间早于当前时间即到期', () => {
    expect(isDue(100, 200)).toBe(true);
    expect(isDue(300, 200)).toBe(false);
  });
});
