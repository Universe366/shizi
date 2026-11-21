import { useState } from 'react';

interface Props {
  open: boolean;
  canUndo: boolean;
  onClose: () => void;
  onApply: (deltaMs: number) => void;
  onUndo: () => void;
}

const PRESETS = [
  { label: '-5s', value: -5000 },
  { label: '-1s', value: -1000 },
  { label: '-0.2s', value: -200 },
  { label: '+0.2s', value: 200 },
  { label: '+1s', value: 1000 },
  { label: '+5s', value: 5000 }
];

/** 字幕时间轴整体平移：只改 start/end，不改文字。 */
export function TimelineShiftDialog({ open, canUndo, onClose, onApply, onUndo }: Props) {
  const [seconds, setSeconds] = useState('0.5');
  if (!open) return null;
  const custom = Number(seconds);
  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card"
        role="dialog"
        aria-label="时间轴平移"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-title">时间轴平移</div>
        <div className="confirm-desc">
          整体移动当前字幕的起止时间，文字和翻译内容不变；平移后会清空译文，可撤销一次。
        </div>
        <div className="settings-inline" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className="mini-btn"
              onClick={() => onApply(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="settings-inline" style={{ marginTop: 8 }}>
          <input
            type="number"
            step={0.1}
            value={seconds}
            aria-label="平移秒数"
            onChange={(event) => setSeconds(event.target.value)}
            style={{ width: 90 }}
          />
          <span className="settings-hint">秒（正数向后，负数向前）</span>
          <button
            type="button"
            className="mini-btn"
            disabled={!Number.isFinite(custom) || custom === 0}
            onClick={() => onApply(Math.round(custom * 1000))}
          >
            应用
          </button>
        </div>
        <div className="confirm-actions">
          <button type="button" className="mini-btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="mini-btn" disabled={!canUndo} onClick={onUndo}>
            撤销上次平移
          </button>
        </div>
      </div>
    </div>
  );
}
