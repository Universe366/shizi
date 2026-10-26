
interface SubtitleTranslateBarProps {
  open: boolean;
  targetLang: string;
  customTarget: string;
  effectiveTarget: string;
  hasLines: boolean;
  translating: boolean;
  progress: number;
  message: string;
  useContext: boolean;
  reflect: boolean;
  freeFallback: boolean;
  onToggleContext: (value: boolean) => void;
  onToggleReflect: (value: boolean) => void;
  onToggleFreeFallback: (value: boolean) => void;
  onTargetLang: (value: string) => void;
  onCustomTarget: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}

const LANGUAGES = ['中文（简体）', '中文（繁體）', 'English', '日本語', '한국어'];

/** 字幕翻译：目标语言选择、自定义语言、开始/停止与进度。 */
export function SubtitleTranslateBar({
  open,
  targetLang,
  customTarget,
  effectiveTarget,
  hasLines,
  translating,
  progress,
  message,
  useContext,
  reflect,
  freeFallback,
  onToggleContext,
  onToggleReflect,
  onToggleFreeFallback,
  onTargetLang,
  onCustomTarget,
  onStart,
  onStop,
  onClose
}: SubtitleTranslateBarProps) {
  if (!open) return null;

  return (
    <>
      <div className="translate-bar">
        <select
          className="mini-select"
          value={targetLang}
          onChange={(event) => onTargetLang(event.target.value)}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
          <option value="__custom">自定义…</option>
        </select>
        {targetLang === '__custom' && (
          <input
            className="settings-input"
            style={{ maxWidth: 110 }}
            value={customTarget}
            placeholder="目标语言"
            spellCheck={false}
            onChange={(event) => onCustomTarget(event.target.value)}
          />
        )}
        <button
          className="mini-btn primary"
          disabled={translating || !hasLines || !effectiveTarget}
          onClick={onStart}
        >
          开始翻译
        </button>
        <label className="settings-check" title="把上一批/下一批的原文也带给模型，术语和语气更一致">
          <input
            type="checkbox"
            checked={useContext}
            disabled={translating}
            onChange={(event) => onToggleContext(event.target.checked)}
          />
          上下文
        </label>
        <label className="settings-check" title="译完再让模型对照原文复查一遍（耗时约翻倍）">
          <input
            type="checkbox"
            checked={reflect}
            disabled={translating}
            onChange={(event) => onToggleReflect(event.target.checked)}
          />
          反思
        </label>
        <label
          className="settings-check"
          title="AI 不可用/失败时改用 MyMemory 免费翻译（字幕文本会发给第三方）"
        >
          <input
            type="checkbox"
            checked={freeFallback}
            disabled={translating}
            onChange={(event) => onToggleFreeFallback(event.target.checked)}
          />
          免费兜底
        </label>
        {translating && (
          <button className="mini-btn" onClick={onStop}>
            停止
          </button>
        )}
        <button className="mini-btn" onClick={onClose}>
          关闭
        </button>
      </div>

      {translating && (
        <div className="translate-progress">
          <span>{message || '翻译中…'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      )}
    </>
  );
}

interface SubtitleOptimizeProgressProps {
  running: boolean;
  progress: number;
  message: string;
  onStop: () => void;
}

/** 校对进度条与消息（未运行时只显示结果消息）。 */
export function SubtitleOptimizeProgress({
  running,
  progress,
  message,
  onStop
}: SubtitleOptimizeProgressProps) {
  if (!running && !message) return null;

  if (!running) return <div className="save-status">{message}</div>;

  return (
    <div className="translate-progress">
      <span>{message || '校对中…'}</span>
      <span>
        {Math.round(progress)}%
        <button className="mini-btn" onClick={onStop} style={{ marginLeft: 6 }}>
          停止
        </button>
      </span>
    </div>
  );
}

