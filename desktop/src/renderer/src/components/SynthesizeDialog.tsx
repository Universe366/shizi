import { useEffect, useMemo, useState } from 'react';
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

const FONT_OPTIONS = [
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'SimHei',
  'SimSun',
  'KaiTi',
  'Segoe UI',
  'Arial',
  'Source Han Sans SC',
  'Noto Sans CJK SC'
];

const POSITIONS: Array<{ alignment: number; label: string }> = [
  { alignment: 8, label: '顶部' },
  { alignment: 5, label: '居中' },
  { alignment: 2, label: '底部' }
];

const SOFT_LANGUAGES = [
  { value: 'chi', label: '中文' },
  { value: 'eng', label: 'English' },
  { value: 'jpn', label: '日本語' },
  { value: 'kor', label: '한국어' }
];

/** 预览画布高度：样式按 1080p 等比缩放到这个高度上。 */
const PREVIEW_HEIGHT = 280;
const PREVIEW_SCALE = PREVIEW_HEIGHT / 1080;

function outlineShadow(width: number, color: string): string {
  const w = Math.max(0, width);
  if (!w) return 'none';
  const parts: string[] = [];
  for (const [x, y] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1]
  ]) {
    parts.push(`${x * w}px ${y * w}px 0 ${color}`);
  }
  return parts.join(', ');
}

/** 导出成片：样式（字体/字号/颜色/描边/位置）+ 实时预览 + 硬字幕 / 软字幕。 */
export function SynthesizeDialog({
  open,
  videoPath,
  title,
  lines,
  translated,
  onClose
}: SynthesizeDialogProps) {
  const [mode, setMode] = useState<'hard' | 'soft'>('hard');
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [softLanguage, setSoftLanguage] = useState('chi');
  const [presets, setPresets] = useState<Array<{ name: string; style: SubtitleStyle }>>([]);
  const [presetName, setPresetName] = useState('');
  const [showPresetName, setShowPresetName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const canBilingual = Boolean(translated && translated.length === lines.length);
  const previewBilingual = canBilingual && style.bilingual;
  const patch = (next: Partial<SubtitleStyle>) => setStyle((current) => ({ ...current, ...next }));

  useEffect(() => {
    if (!open) return;
    setStyle(DEFAULT_SUBTITLE_STYLE);
    setMessage('');
    setBusy(false);
    setShowPresetName(false);
    void window.bsub.getSettings?.().then((response) => {
      if (!response?.ok) return;
      const general = response.data.settings.general;
      const saved = general.subtitleStyle || DEFAULT_SUBTITLE_STYLE;
      setStyle({ ...DEFAULT_SUBTITLE_STYLE, ...saved });
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

  const rememberStyle = async () => {
    try {
      const snapshot = await window.bsub.getSettings();
      if (!snapshot.ok) return;
      const settings = snapshot.data.settings;
      await window.bsub.saveSettings({
        ...settings,
        general: { ...settings.general, subtitleStyle: style }
      });
    } catch {
      // 记不住样式不影响本次导出
    }
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
        { name, style }
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

  const deletePreset = async (name: string) => {
    if (!name) return;
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    const next = (settings.general.subtitlePresets || []).filter((item) => item.name !== name);
    const response = await window.bsub.saveSettings({
      ...settings,
      general: { ...settings.general, subtitlePresets: next }
    });
    if (response.ok) {
      setPresets(next);
      setMessage(`已删除预设「${name}」`);
    }
  };

  const submit = async () => {
    if (!videoPath) {
      setMessage('当前页面没有本地视频文件；请先导入本地视频，或下载后再成片');
      return;
    }
    setBusy(true);
    setMessage('');
    void rememberStyle();
    try {
      const response = await window.bsub.synthesizeVideo({
        requestId: `synth-${Date.now()}`,
        videoPath,
        title,
        lines,
        translatedLines: previewBilingual && translated ? translated : undefined,
        mode,
        style: { ...style, bilingual: previewBilingual },
        softLanguage
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

  const previewStyle = useMemo(() => {
    const fontSize = Math.max(8, style.fontSize * PREVIEW_SCALE);
    return {
      fontFamily: `${style.fontName}, "Microsoft YaHei", sans-serif`,
      fontSize: `${fontSize}px`,
      color: style.primaryColor,
      textShadow: outlineShadow(style.outline * PREVIEW_SCALE, style.outlineColor),
      filter: style.shadow ? `drop-shadow(0 ${Math.max(1, style.shadow * PREVIEW_SCALE)}px 1px rgba(0,0,0,.55))` : 'none'
    } as const;
  }, [style]);

  if (!open) return null;

  const position = POSITIONS.find((item) => item.alignment === style.alignment) || POSITIONS[2];

  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="synth-card" role="dialog" aria-modal="true" aria-label="导出成片">
        <header className="synth-head">
          <Clapperboard size={16} />
          <div>
            <div className="confirm-title">导出成片</div>
            <div className="confirm-desc">
              字幕样式会按 1080p 等比应用到视频；长视频需要重新编码，任务可在后台继续。
            </div>
          </div>
          <div className="synth-mode">
            <button
              className={`synth-mode-btn${mode === 'hard' ? ' is-active' : ''}`}
              onClick={() => setMode('hard')}
            >
              硬字幕
              <em>MP4 · 画面内嵌</em>
            </button>
            <button
              className={`synth-mode-btn${mode === 'soft' ? ' is-active' : ''}`}
              onClick={() => setMode('soft')}
            >
              软字幕
              <em>MKV · 可开关</em>
            </button>
          </div>
        </header>

        <div className="synth-body">
          <div className="synth-controls">
            <div className="synth-grid">
              <label className="synth-field">
                <span>字体</span>
                <input
                  className="settings-input"
                  list="synth-fonts"
                  value={style.fontName}
                  spellCheck={false}
                  onChange={(event) => patch({ fontName: event.target.value })}
                />
                <datalist id="synth-fonts">
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font} />
                  ))}
                </datalist>
              </label>
              <label className="synth-field">
                <span>字号</span>
                <input
                  className="settings-input"
                  type="number"
                  min={24}
                  max={96}
                  value={style.fontSize}
                  onChange={(event) => patch({ fontSize: Number(event.target.value) || 54 })}
                />
              </label>
              <label className="synth-field">
                <span>主色</span>
                <input
                  className="synth-color"
                  type="color"
                  value={style.primaryColor}
                  onChange={(event) => patch({ primaryColor: event.target.value })}
                />
              </label>
              <label className="synth-field">
                <span>描边色</span>
                <input
                  className="synth-color"
                  type="color"
                  value={style.outlineColor}
                  onChange={(event) => patch({ outlineColor: event.target.value })}
                />
              </label>
              <label className="synth-field">
                <span>描边</span>
                <input
                  className="settings-input"
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={style.outline}
                  onChange={(event) => patch({ outline: Number(event.target.value) })}
                />
              </label>
              <label className="synth-field">
                <span>阴影</span>
                <input
                  className="settings-input"
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={style.shadow}
                  onChange={(event) => patch({ shadow: Number(event.target.value) })}
                />
              </label>
              <label className="synth-field">
                <span>位置</span>
                <select
                  className="settings-input"
                  value={style.alignment}
                  onChange={(event) => patch({ alignment: Number(event.target.value) })}
                >
                  {POSITIONS.map((item) => (
                    <option key={item.alignment} value={item.alignment}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="synth-field">
                <span>距底部</span>
                <input
                  className="settings-input"
                  type="number"
                  min={10}
                  max={300}
                  value={style.marginV}
                  onChange={(event) => patch({ marginV: Number(event.target.value) || 36 })}
                />
              </label>
            </div>

            <div className="synth-row">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={previewBilingual}
                  disabled={!canBilingual}
                  onChange={(event) => patch({ bilingual: event.target.checked })}
                />
                双语（译文在上）
              </label>
              {mode === 'soft' && (
                <label className="synth-field synth-field-inline">
                  <span>字幕语言</span>
                  <select
                    className="settings-input"
                    value={softLanguage}
                    onChange={(event) => setSoftLanguage(event.target.value)}
                  >
                    {SOFT_LANGUAGES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!canBilingual && <span className="settings-hint">当前没有译文，双语不可用</span>}
            </div>

            <div className="synth-row">
              <select
                className="settings-input synth-preset-select"
                value=""
                onChange={(event) => {
                  const picked = presets.find((item) => item.name === event.target.value);
                  if (!picked) return;
                  setStyle({ ...DEFAULT_SUBTITLE_STYLE, ...picked.style });
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
                  <Save size={12} /> 存为预设
                </button>
              ) : (
                <>
                  <input
                    className="settings-input"
                    style={{ maxWidth: 120 }}
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
              {presets.length > 0 && (
                <select
                  className="settings-input synth-preset-select"
                  value=""
                  onChange={(event) => void deletePreset(event.target.value)}
                >
                  <option value="">删除预设…</option>
                  {presets.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="synth-side">
            <div className="synth-preview" aria-label="字幕样式预览">
              <div className="synth-preview-video" />
              <div
                className="synth-preview-caption"
                style={{
                  alignItems:
                    position.alignment === 8
                      ? 'flex-start'
                      : position.alignment === 5
                        ? 'center'
                        : 'flex-end',
                  paddingTop: position.alignment === 8 ? style.marginV * PREVIEW_SCALE : 10,
                  paddingBottom:
                    position.alignment === 2 ? style.marginV * PREVIEW_SCALE : 10
                }}
              >
                <div className="synth-preview-text" style={previewStyle}>
                  {previewBilingual && (
                    <div className="synth-preview-translated">
                      {(translated?.[0]?.text || 'This is a bilingual subtitle preview.').slice(0, 48)}
                    </div>
                  )}
                  <div>{lines[0]?.text?.slice(0, 40) || '示例字幕：这是一行预览文字'}</div>
                </div>
              </div>
              <div className="synth-preview-meta">
                {mode === 'hard' ? 'MP4 硬字幕' : 'MKV 软字幕（ASS）'} · {position.label} · {style.fontSize}px
              </div>
            </div>
            <div className="settings-hint">
              预览按 1080p 等比缩小；实际渲染使用 ASS 样式，字体需系统已安装。
            </div>
          </div>
        </div>

        <footer className="synth-foot">
          <span className="settings-hint synth-source">
            源文件：{videoPath || '当前页面不是本地视频'} · {lines.length} 行
          </span>
          {message && <span className="settings-hint">{message}</span>}
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="mini-btn primary" onClick={() => void submit()} disabled={busy || !lines.length}>
            {busy ? <Loader2 size={12} className="spin" /> : <Clapperboard size={12} />} 开始合成
          </button>
        </footer>
      </div>
    </div>
  );
}
