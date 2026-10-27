/** 知识库复习卡片的简化间隔重复调度（不依赖数据库，便于单测）。 */
export type KbReviewGrade = 'again' | 'hard' | 'good';

export interface KbReviewState {
  intervalDays: number;
  streak: number;
}

export interface KbReviewSchedule extends KbReviewState {
  dueAt: number;
}

const STEPS = [1, 3, 7, 14, 30, 60, 120];

/**
 * again：10 分钟后再来，连续次数清零；
 * hard：间隔 ×1.2（至少 1 天），连续次数不涨；
 * good：按 1/3/7/14/30/60/120 天推进。
 */
export function nextReviewSchedule(
  current: KbReviewState,
  grade: KbReviewGrade,
  now = Date.now()
): KbReviewSchedule {
  const interval = Math.max(0, Number(current.intervalDays) || 0);
  const streak = Math.max(0, Number(current.streak) || 0);

  if (grade === 'again') {
    return { intervalDays: 0, streak: 0, dueAt: now + 10 * 60 * 1000 };
  }

  if (grade === 'hard') {
    const days = Math.min(365, Math.max(1, Math.round(Math.max(1, interval) * 1.2)));
    return { intervalDays: days, streak, dueAt: now + days * 24 * 60 * 60 * 1000 };
  }

  const nextStreak = streak + 1;
  const days = STEPS[Math.min(STEPS.length - 1, nextStreak - 1)];
  return {
    intervalDays: days,
    streak: nextStreak,
    dueAt: now + days * 24 * 60 * 60 * 1000
  };
}

export function isDue(dueAt: number, now = Date.now()): boolean {
  return (Number(dueAt) || 0) <= now;
}
