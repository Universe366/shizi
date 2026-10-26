import { useEffect, useMemo, useState } from 'react';
import { Loader2, Scissors, Sparkles } from 'lucide-react';
import type { SubtitleLine } from '../../../shared/types';

interface ResegmentDialogProps {
  open: boolean;
  lines: SubtitleLine[];
  onClose: () => void;
  onApply: (lines: SubtitleLine[]) => void;
}

/** 智能断句：规则/LLM 只做分行，不改写字幕文字。 */
export function ResegmentDialog({ open, lines, onClose, onApply }: ResegmentDialogProps) {
  const [maxChars, setMaxChars] = useState(24);
  const [minDuration, setMinDuration] = useState(1.2);
  const [useAi, setUseAi] = useState(true);
  const [preview, setPreview] = useState<SubtitleLine[] | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setNote('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onClose, open]);

  const before = useMemo(() => lines.slice(0, 8), [lines]);
  const after = useMemo(() => (preview || []).slice(0, 8), [preview]);

  const run = async (withAi: boolean) => {
    if (!lines.length || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await window.bsub.resegmentSubtitles?.({
        requestId: `reseg-${Date.now()}`,
        lines,
        options: { maxChars, minDuration, useAi: withAi }
      });
      if (!response) throw new Error('当前版本不支持断句');
      if (!response.ok) throw new Error(response.error);
      setPreview(response.data.lines);
      setNote(response.data.note);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="confirm-backdrop resegment-backdrop" role="presentation">
      <div className="confirm-card resegment-card" role="dialog" aria-modal="true" aria-label="智能断句">
        <div className="resegment-head">
          <Scissors size={15} />
          <div>
            <div className="confirm-title">智能断句</div>
            <div className="confirm-desc">
              只合并/拆分现有字幕，不改写文字；AI 只判断哪几行属于同一句。
            </div>
          </div>
        </div>

        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">每行最多字数</div>
            <input
              className="settings-input"
              type="number"
              min={8}
              max={60}
              value={maxChars}
              onChange={(event) => setMaxChars(Number(event.target.value) || 24)}
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">最短展示（秒）</div>
            <input
              className="settings-input"
              type="number"
              min={0.4}
              max={5}
              step={0.1}
              value={minDuration}
              onChange={(event) => setMinDuration(Number(event.target.value) || 1.2)}
            />
          </div>
          <label className="settings-check">
            <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} />
            用 AI 判断语义
          </label>
        </div>

        <div className="resegment-columns">
          <div className="resegment-column">
            <div className="resegment-title">原字幕 · {lines.length} 行</div>
            {before.map((line, index) => (
              <div className="resegment-row" key={`before-${index}`}>
                <span className="resegment-time">{clock(line.start)}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
          <div className="resegment-column">
            <div className="resegment-title">
              {preview ? `断句后 · ${preview.length} 行` : '断句后（先预览）'}
            </div>
            {after.map((line, index) => (
              <div className="resegment-row" key={`after-${index}`}>
                <span className="resegment-time">{clock(line.start)}</span>
                <span>{line.text}</span>
              </div>
            ))}
            {preview && preview.length > after.length && (
              <div className="settings-hint">还有 {preview.length - after.length} 行…</div>
            )}
          </div>
        </div>

        {note && <div className="settings-hint">{note}</div>}
        {error && <div className="settings-hint" style={{ color: '#c0392b' }}>{error}</div>}

        <div className="resegment-actions">
          <button className="mini-btn" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="mini-btn" onClick={() => void run(false)} disabled={loading}>
            {loading ? <Loader2 size={12} className="spin" /> : <Scissors size={12} />} 规则预览
          </button>
          <button className="mini-btn" onClick={() => void run(true)} disabled={loading}>
            {loading ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />} AI 预览
          </button>
          <button
            className="mini-btn primary"
            disabled={!preview || loading}
            onClick={() => {
              if (preview) onApply(preview);
              onClose();
            }}
          >
            应用到字幕
          </button>
        </div>
      </div>
    </div>
  );
}

function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, '0')}`;
}
