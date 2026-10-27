import { useEffect } from 'react';
import { hostOf } from './model';

export interface ShortcutDraft {
  id?: string;
  label: string;
  url: string;
  group: string;
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
