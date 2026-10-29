import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import {
  POMODORO_LABELS,
  POMODORO_SECONDS,
  formatPomodoro,
  type PomodoroPhase
} from './model';

export interface PomodoroState {
  phase: PomodoroPhase;
  left: number;
  running: boolean;
  rounds: number;
  onToggle: () => void;
  onReset: () => void;
  onPhase: (phase: PomodoroPhase) => void;
}

const PHASES: PomodoroPhase[] = ['work', 'short', 'long'];

/** 番茄钟：25 分钟专注、5 分钟短休、15 分钟长休，结束后自动切换。 */
export function PomodoroWidget({ style, ...state }: { style?: CSSProperties } & PomodoroState) {
  const { phase, left, running, rounds, onToggle, onReset, onPhase } = state;
  const total = POMODORO_SECONDS[phase];
  const progress = Math.min(100, Math.max(0, ((total - left) / total) * 100));

  return (
    <article className="start-widget start-pomodoro-widget" style={style}>
      <header className="start-widget-head">
        <Timer size={15} />
        <span>番茄钟</span>
        <span className="start-widget-meta">完成 {rounds} 轮</span>
      </header>

      <div className="start-pomo-phases">
        {PHASES.map((item) => (
          <button
            key={item}
            className={phase === item ? 'is-active' : ''}
            onClick={() => onPhase(item)}
          >
            {POMODORO_LABELS[item]} {POMODORO_SECONDS[item] / 60}
          </button>
        ))}
      </div>

      <div className={`start-pomo-time${running ? ' is-running' : ''}`}>
        {formatPomodoro(left)}
      </div>
      <div className="start-pomo-bar">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="start-pomo-actions">
        <button
          className="start-pomo-primary"
          onClick={onToggle}
          title={running ? '暂停' : '开始'}
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? '暂停' : '开始'}
        </button>
        <button onClick={onReset} title="重置">
          <RotateCcw size={13} />
          重置
        </button>
      </div>
    </article>
  );
}
