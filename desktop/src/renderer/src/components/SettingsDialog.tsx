import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';

/**
 * 功能现场用的「设置弹窗」：加载当前设置 → 局部修改 → 保存。
 * 用于把字幕、下载这类只在该功能里才需要的配置从设置页搬回现场。
 */
export function SettingsDialog({
  title,
  description,
  onClose,
  children
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: (
    draft: AppSettings,
    patch: (updater: (draft: AppSettings) => AppSettings) => void
  ) => ReactNode;
}) {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void window.bsub.getSettings().then((response) => {
      if (!alive) return;
      if (response.ok) setDraft(response.data.settings);
      else setError(response.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const response = await window.bsub.saveSettings(draft);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card settings-dialog"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="hub-title-row">
            <strong>{title}</strong>
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        {description && <div className="settings-hint">{description}</div>}
        {error && <div className="settings-hint">{error}</div>}
        {!draft && (
          <div className="status-line">
            <Loader2 size={13} className="spin" /> 读取设置…
          </div>
        )}
        {draft && children(draft, (updater) => setDraft((current) => (current ? updater(current) : current)))}
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            取消
          </button>
          <button className="mini-btn primary" disabled={!draft || busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
