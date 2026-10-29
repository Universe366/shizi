import { useSyncExternalStore } from 'react';
import { POMODORO_SECONDS, nextPomodoroPhase, type PomodoroPhase } from './model';
import { playChime } from './chime';

const STORAGE_KEY = 'start-pomodoro';

interface Persisted {
  phase: PomodoroPhase;
  rounds: number;
  running: boolean;
  left: number;
  endAt: number | null;
}

export interface PomodoroSnapshot {
  phase: PomodoroPhase;
  left: number;
  running: boolean;
  rounds: number;
}

function isPhase(value: unknown): value is PomodoroPhase {
  return value === 'work' || value === 'short' || value === 'long';
}

function fallback(): Persisted {
  return { phase: 'work', rounds: 0, running: false, left: POMODORO_SECONDS.work, endAt: null };
}

function read(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<Persisted> | null;
    if (!raw || !isPhase(raw.phase)) return fallback();
    const rounds = Math.max(0, Math.min(9999, Math.floor(Number(raw.rounds) || 0)));
    const running = raw.running === true && Number.isFinite(Number(raw.endAt));
    if (running) {
      const endAt = Number(raw.endAt);
      if (endAt <= Date.now()) {
        // 关应用期间到点：补一次阶段切换，但以暂停状态回来，避免一开页就连跳多轮。
        const completed = raw.phase === 'work' ? rounds + 1 : rounds;
        const next = nextPomodoroPhase(raw.phase, completed);
        return {
          phase: next,
          rounds: completed,
          running: false,
          left: POMODORO_SECONDS[next],
          endAt: null
        };
      }
      return {
        phase: raw.phase,
        rounds,
        running: true,
        left: Math.max(0, Math.ceil((endAt - Date.now()) / 1000)),
        endAt
      };
    }
    const left = Math.max(0, Math.min(24 * 3600, Math.floor(Number(raw.left) || 0)));
    return {
      phase: raw.phase,
      rounds,
      running: false,
      left: left || POMODORO_SECONDS[raw.phase],
      endAt: null
    };
  } catch {
    return fallback();
  }
}

let state = read();
let snapshot: PomodoroSnapshot = toSnapshot(state, Date.now());
let ticker: number | null = null;
const listeners = new Set<() => void>();

function remainingAt(value: Persisted, at: number): number {
  if (!value.running || !value.endAt) return value.left;
  return Math.max(0, Math.ceil((value.endAt - at) / 1000));
}

function toSnapshot(value: Persisted, at: number): PomodoroSnapshot {
  return {
    phase: value.phase,
    left: remainingAt(value, at),
    running: value.running,
    rounds: value.rounds
  };
}

function emit(): void {
  snapshot = toSnapshot(state, Date.now());
  for (const listener of listeners) listener();
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 本地存储不可用时只在内存里跑
  }
}

function stopTicker(): void {
  if (ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
}

function startTicker(): void {
  if (ticker !== null) return;
  ticker = window.setInterval(tick, 1000);
}

function advance(autoStart: boolean): void {
  const completed = state.phase === 'work' ? state.rounds + 1 : state.rounds;
  const next = nextPomodoroPhase(state.phase, completed);
  state = {
    phase: next,
    rounds: completed,
    running: autoStart,
    left: POMODORO_SECONDS[next],
    endAt: autoStart ? Date.now() + POMODORO_SECONDS[next] * 1000 : null
  };
  playChime();
  save();
  emit();
  if (autoStart) startTicker();
  else stopTicker();
}

function tick(): void {
  if (!state.running || !state.endAt) {
    stopTicker();
    return;
  }
  if (Date.now() >= state.endAt) advance(true);
  else emit();
}

function pause(): void {
  if (!state.running) return;
  state = {
    ...state,
    left: remainingAt(state, Date.now()),
    running: false,
    endAt: null
  };
  stopTicker();
  save();
  emit();
}

function resume(): void {
  if (state.running) return;
  const left = state.left > 0 ? state.left : POMODORO_SECONDS[state.phase];
  state = { ...state, running: true, left, endAt: Date.now() + left * 1000 };
  save();
  emit();
  startTicker();
}

export const pomodoroActions = {
  toggle(): void {
    if (state.running) pause();
    else resume();
  },
  reset(): void {
    stopTicker();
    state = { ...state, phase: 'work', running: false, left: POMODORO_SECONDS.work, endAt: null };
    save();
    emit();
  },
  setPhase(phase: PomodoroPhase): void {
    stopTicker();
    state = {
      ...state,
      phase,
      running: false,
      left: POMODORO_SECONDS[phase],
      endAt: null
    };
    save();
    emit();
  },
  setRounds(rounds: number): void {
    state = { ...state, rounds: Math.max(0, Math.min(9999, Math.floor(rounds) || 0)) };
    save();
    emit();
  }
};

/** 测试用：清空进度与计时器。 */
export function resetPomodoroStore(): void {
  stopTicker();
  state = fallback();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPomodoroSnapshot(): PomodoroSnapshot {
  return snapshot;
}

export function usePomodoro(): PomodoroSnapshot {
  return useSyncExternalStore(subscribe, getPomodoroSnapshot, getPomodoroSnapshot);
}

if (state.running) startTicker();
