import { useEffect, useState } from 'react';
import { Loader2, Mic } from 'lucide-react';
import type { SubtitleLine } from '../../../shared/types';

/** 本地配音（实验性）：Windows SAPI 逐条合成，按字幕时间轴对齐。 */
export function DubDialog({
  open,
  videoPath,
  title,
  lines,
  onClose
}: {
  open: boolean;
  videoPath: string;
  title: string;
  lines: SubtitleLine[];
  onClose: () => void;
}) {
  const [voices, setVoices] = useState<string[]>([]);
  const [voice, setVoice] = useState('');
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setBusy(false);
    setMode(videoPath ? 'video' : 'audio');
    void window.bsub.listTtsVoices?.().then((response) => {
      if (!response?.ok) return;
      setVoices(response.data.voices);
      setVoice(response.data.voices[0] || '');
    });
  }, [open, videoPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const submit = async () => {
    if (!lines.length) {
      setMessage('没有字幕，无法配音');
      return;
    }
    setBusy(true);
    setMessage('已提交配音任务…');
    try {
      const response = await window.bsub.dubVideo?.({
        videoPath,
        title,
        lines,
        voice,
        mode
      });
      if (!response) {
        setMessage('当前版本不支持配音');
        return;
      }
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      if ('canceled' in response.data) {
        setMessage('已取消');
        return;
      }
      setMessage('配音中，进度见右下角「任务」');
      window.setTimeout(onClose, 800);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="confirm-card" role="dialog" aria-modal="true" aria-label="本地配音">
        <div className="resegment-head">
          <Mic size={15} />
          <div>
            <div className="confirm-title">本地配音（实验性）</div>
            <div className="confirm-desc">
              用 Windows 自带语音逐条合成，按字幕时间轴对齐；音色取决于系统已安装语音。
            </div>
          </div>
        </div>
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">音色</div>
            <select className="settings-input" value={voice} onChange={(event) => setVoice(event.target.value)}>
              {voices.length === 0 && <option value="">系统默认</option>}
              {voices.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <label className="settings-check">
            <input type="radio" checked={mode === 'audio'} onChange={() => setMode('audio')} />
            只导出音轨
          </label>
          <label className="settings-check">
            <input
              type="radio"
              checked={mode === 'video'}
              disabled={!videoPath}
              onChange={() => setMode('video')}
            />
            替换视频音轨
          </label>
        </div>
        <div className="settings-hint">
          {mode === 'video' && !videoPath
            ? '当前页面不是本地视频，只能导出音轨'
            : '配音会按每条字幕的起止时间压缩/补静音；超过 300 行请先断句精简。'}
        </div>
        {message && <div className="settings-hint">{message}</div>}
        <div className="resegment-actions">
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="mini-btn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={12} className="spin" /> : <Mic size={12} />} 开始配音
          </button>
        </div>
      </div>
    </div>
  );
}
