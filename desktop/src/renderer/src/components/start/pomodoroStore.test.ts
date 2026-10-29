// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPomodoroSnapshot, pomodoroActions, resetPomodoroStore } from './pomodoroStore';

describe('pomodoroStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T08:00:00'));
    resetPomodoroStore();
  });

  afterEach(() => {
    resetPomodoroStore();
    vi.useRealTimers();
  });

  it('开始后按秒递减', () => {
    pomodoroActions.toggle();
    vi.advanceTimersByTime(5000);
    expect(getPomodoroSnapshot()).toMatchObject({ running: true, left: 1495 });
  });

  it('专注结束进入短休并累计轮数', () => {
    pomodoroActions.toggle();
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(getPomodoroSnapshot()).toMatchObject({ phase: 'short', rounds: 1, running: true });
  });

  it('每 4 轮进入长休', () => {
    pomodoroActions.setRounds(3);
    pomodoroActions.setPhase('work');
    pomodoroActions.toggle();
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(getPomodoroSnapshot()).toMatchObject({ phase: 'long', rounds: 4 });
  });

  it('暂停后剩余时间不再变化', () => {
    pomodoroActions.toggle();
    vi.advanceTimersByTime(10000);
    pomodoroActions.toggle();
    expect(getPomodoroSnapshot()).toMatchObject({ running: false, left: 1490 });
    vi.advanceTimersByTime(10000);
    expect(getPomodoroSnapshot().left).toBe(1490);
  });

  it('重启时按结束时间续跑', async () => {
    localStorage.setItem(
      'start-pomodoro',
      JSON.stringify({
        phase: 'work',
        rounds: 0,
        running: true,
        left: 1500,
        endAt: Date.now() + 90_000
      })
    );
    vi.resetModules();
    const fresh = await import('./pomodoroStore');
    expect(fresh.getPomodoroSnapshot()).toMatchObject({ running: true, phase: 'work' });
    expect(fresh.getPomodoroSnapshot().left).toBeGreaterThan(80);
    fresh.resetPomodoroStore();
  });

  it('关应用期间到点则切到下一阶段并暂停', async () => {
    localStorage.setItem(
      'start-pomodoro',
      JSON.stringify({
        phase: 'work',
        rounds: 0,
        running: true,
        left: 1500,
        endAt: Date.now() - 1000
      })
    );
    vi.resetModules();
    const fresh = await import('./pomodoroStore');
    expect(fresh.getPomodoroSnapshot()).toMatchObject({
      running: false,
      phase: 'short',
      rounds: 1
    });
  });

  it('把运行中的结束时间写进本地存储', () => {
    pomodoroActions.toggle();
    const raw = JSON.parse(localStorage.getItem('start-pomodoro') || '{}');
    expect(raw.running).toBe(true);
    expect(raw.endAt).toBeTypeOf('number');
  });
});
