import { useEffect, useState } from 'react';
import { hostOf } from './model';

export interface ShortcutDraft {
  id?: string;
  label: string;
  url: string;
  group: string;
  /** 一句话说明（可选） */
  desc?: string;
  /** 编辑中的标签文本，保存时用 normalizeTags 解析 */
  tagsText?: string;
}

interface ShortcutDialogProps {
  draft: ShortcutDraft;
  groups: string[];
  onChange: (next: ShortcutDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** 新增/编辑快捷方式：名称、分组、网址，保存前会补全协议。 */
export function ShortcutDialog({ draft, groups, onChange, onCancel, onSave }: ShortcutDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const preview = draft.url.trim() ? hostOf(draft.url) : '';
  const canSave = Boolean(draft.label.trim() && draft.url.trim());
  const [probing, setProbing] = useState(false);
  const [probeHint, setProbeHint] = useState('');

  const autofill = async () => {
    const url = draft.url.trim();
    if (!url || probing) return;
    setProbing(true);
    setProbeHint('');
    try {
      const response = await window.bsub.startProbeSite?.(url);
      if (!response?.ok) {
        setProbeHint(response?.error || '没有取到站点信息');
        return;
      }
      const title = String(response.data.title || '').trim();
      const description = String(response.data.description || '').trim();
      onChange({
        ...draft,
        ...(title && !draft.label.trim() ? { label: title.slice(0, 20) } : {}),
        ...(description && !String(draft.desc || '').trim() ? { desc: description.slice(0, 120) } : {})
      });
      setProbeHint(title ? `已获取：${title}` : '没有取到标题');
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="start-modal-backdrop" onMouseDown={onCancel}>
      <div className="start-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="start-modal-title">{draft.id ? '编辑快捷方式' : '添加快捷方式'}</div>

        <label className="start-modal-field">
          <span>名称</span>
          <input
            autoFocus
            maxLength={20}
            value={draft.label}
            placeholder="例如：知乎"
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
          />
        </label>

        <label className="start-modal-field">
          <span>网址</span>
          <input
            maxLength={500}
            value={draft.url}
            placeholder="https://example.com"
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSave) onSave();
            }}
          />
          {preview && <em className="start-modal-hint">将打开 {preview}</em>}
          {probeHint && <em className="start-modal-hint">{probeHint}</em>}
        </label>

        <label className="start-modal-field">
          <span>分组</span>
          <input
            list="start-group-options"
            maxLength={12}
            value={draft.group}
            placeholder="常用 / 学习 / 工具"
            onChange={(event) => onChange({ ...draft, group: event.target.value })}
          />
          <datalist id="start-group-options">
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </label>

        <label className="start-modal-field">
          <span>
            描述
            <button
              type="button"
              className="start-modal-probe"
              disabled={!draft.url.trim() || probing}
              onClick={() => void autofill()}
            >
              {probing ? '获取中…' : '自动获取'}
            </button>
          </span>
          <input
            maxLength={120}
            value={draft.desc || ''}
            placeholder="一句话说明（可选）"
            onChange={(event) => onChange({ ...draft, desc: event.target.value })}
          />
        </label>

        <label className="start-modal-field">
          <span>标签</span>
          <input
            maxLength={80}
            value={draft.tagsText || ''}
            placeholder="用逗号分隔，最多 6 个"
            onChange={(event) => onChange({ ...draft, tagsText: event.target.value })}
          />
        </label>

        <div className="start-modal-actions">
          <button className="mini-btn" onClick={onCancel}>
            取消
          </button>
          <button className="mini-btn primary" disabled={!canSave} onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
