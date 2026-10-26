import { useEffect, useState } from 'react';
import { Clapperboard, Loader2, Save } from 'lucide-react';
import type { SubtitleLine, SubtitleStyle } from '../../../shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '../../../shared/ass';

interface SynthesizeDialogProps {
  open: boolean;
  videoPath: string;
  title: string;
  lines: SubtitleLine[];
  translated?: SubtitleLine[] | null;
  onClose: () => void;
}

/** 导出成片：把当前字幕烧进本地视频（硬字幕）或封装成软字幕。 */
export function SynthesizeDialog({
  open,
  videoPath,
  title,
  lines,
  translated,
  onClose
}: SynthesizeDialogProps) {
  const [mode, setMode] = useState<'hard' | 'soft'>('hard');
  const [fontSize, setFontSize] = useState(DEFAULT_SUBTITLE_STYLE.fontSize);
  const [marginV, setMarginV] = useState(DEFAULT_SUBTITLE_STYLE.marginV);
  const [outline, setOutline] = useState(DEFAULT_SUBTITLE_STYLE.outline);
  const [bilingual, setBilingual] = useState(false);
  const [presets, setPresets] = useState<Array<{ name: string; style: SubtitleStyle }>>([]);
  const [presetName, setPresetName] = useState('');
  const [showPresetName, setShowPresetName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canBilingual = Boolean(translated && translated.length === lines.length);

  useEffect(() => {
    if (!open) return;
    setBilingual(false);
    setMessage('');
    setBusy(false);
    setShowPresetName(false);
    void window.bsub.getSettings?.().then((response) => {
      if (!response?.ok) return;
      const general = response.data.settings.general;
      const style = general.subtitleStyle || DEFAULT_SUBTITLE_STYLE;
      setFontSize(style.fontSize);
      setMarginV(style.marginV);
      setOutline(style.outline);
      setPresets(general.subtitlePresets || []);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const currentStyle: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    fontSize,
    marginV,
    outline,
    bilingual
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    try {
      const snapshot = await window.bsub.getSettings();
      if (!snapshot.ok) throw new Error(snapshot.error);
      const settings = snapshot.data.settings;
      const next = [
        ...(settings.general.subtitlePresets || []).filter((item) => item.name !== name),
        { name, style: currentStyle }
      ].slice(-12);
      const response = await window.bsub.saveSettings({
        ...settings,
        general: { ...settings.general, subtitlePresets: next }
      });
      if (!response.ok) throw new Error(response.error);
      setPresets(next);
      setPresetName('');
      setShowPresetName(false);
      setMessage(`已保存样式预设「${name}」`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const submit = async () => {
    if (!videoPath) {
      setMessage('当前页面没有本地视频文件；请先导入本地视频，或下载后再成片');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await window.bsub.synthesizeVideo({
        requestId: `synth-${Date.now()}`,
        videoPath,
        title,
        lines,
        translatedLines: bilingual && translated ? translated : undefined,
        mode,
        style: currentStyle
      });
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      if ('canceled' in response.data) {
        setMessage('已取消');
        return;
      }
      setMessage('已提交任务，进度见右下角「任务」');
      window.setTimeout(onClose, 900);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="confirm-card resegment-card" role="dialog" aria-modal="true" aria-label="导出成片">
        <div className="resegment-head">
          <Clapperboard size={15} />
          <div>
            <div className="confirm-title">导出成片</div>
            <div className="confirm-desc">
              把当前字幕烧进本地视频；长视频需要重新编码，任务可在后台继续。
            </div>
          </div>
        </div>

        <div className="settings-inline">
          <label className="settings-check">
            <input
              type="radio"
              checked={mode === 'hard'}
              onChange={() => setMode('hard')}
            />
            硬字幕（MP4，画面内嵌）
          </label>
          <label className="settings-check">
            <input
              type="radio"
              checked={mode === 'soft'}
              onChange={() => setMode('soft')}
            />
            软字幕（MKV，可开关）
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={bilingual}
              disabled={!canBilingual || mode === 'soft'}
              onChange={(event) => setBilingual(event.target.checked)}
            />
            双语（原文 + 译文）
          </label>
        </div>

        {mode === 'hard' && (
          <div className="settings-inline">
            <div className="settings-field">
              <div className="settings-label">字号</div>
              <input
                className="settings-input"
                type="number"
                min={24}
                max={96}
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value) || 54)}
              />
            </div>
            <div className="settings-field">
              <div className="settings-label">距底部</div>
              <input
                className="settings-input"
                type="number"
                min={10}
                max={200}
                value={marginV}
                onChange={(event) => setMarginV(Number(event.target.value) || 36)}
              />
            </div>
            <div className="settings-field">
              <div className="settings-label">描边</div>
              <input
                className="settings-input"
                type="number"
                min={0}
                max={8}
                value={outline}
                onChange={(event) => setOutline(Number(event.target.value) || 0)}
              />
            </div>
          </div>
        )}

        <div className="settings-inline">
          <select
            className="settings-input"
            value=""
            onChange={(event) => {
              const picked = presets.find((item) => item.name === event.target.value);
              if (!picked) return;
              setFontSize(picked.style.fontSize);
              setMarginV(picked.style.marginV);
              setOutline(picked.style.outline);
              setBilingual(picked.style.bilingual && canBilingual);
              setMessage(`已套用预设「${picked.name}」`);
            }}
          >
            <option value="">样式预设…</option>
            {presets.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          {!showPresetName ? (
            <button className="mini-btn" onClick={() => setShowPresetName(true)}>
              <Save size={12} /> 保存为预设
            </button>
          ) : (
            <>
              <input
                className="settings-input"
                style={{ maxWidth: 140 }}
                value={presetName}
                placeholder="预设名称"
                spellCheck={false}
                onChange={(event) => setPresetName(event.target.value)}
              />
              <button className="mini-btn" disabled={!presetName.trim()} onClick={() => void savePreset()}>
                保存
              </button>
              <button className="mini-btn" onClick={() => setShowPresetName(false)}>
                取消
              </button>
            </>
          )}
        </div>

        <div className="settings-hint">
          源文件：{videoPath || '当前页面不是本地视频'}
          {canBilingual ? '' : ' · 当前没有译文，双语不可用'}
        </div>
        {message && <div className="settings-hint">{message}</div>}

        <div className="resegment-actions">
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="mini-btn primary" onClick={() => void submit()} disabled={busy || !lines.length}>
            {busy ? <Loader2 size={12} className="spin" /> : <Clapperboard size={12} />} 开始合成
          </button>
        </div>
      </div>
    </div>
  );
}
