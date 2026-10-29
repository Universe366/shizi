import { useEffect, useRef, useState } from 'react';
import { FolderPlus } from 'lucide-react';

interface GroupNameDialogProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  title?: string;
  hint?: string;
  placeholder?: string;
  submitLabel?: string;
}

/** 拖动快捷方式到「新分组」时询问分组名。 */
export function GroupNameDialog({
  open,
  onCancel,
  onSubmit,
  title = '新建分组',
  hint = '快捷方式会从原分组移入新分组。',
  placeholder = '如 设计 / 学习 / 工具',
  submitLabel = '创建分组'
}: GroupNameDialogProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const next = name.trim();
    if (next) onSubmit(next);
  };

  return (
    <div className="start-modal-backdrop" onMouseDown={onCancel}>
      <form
        className="start-modal start-group-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="start-modal-title">
          <FolderPlus size={15} />
          {title}
        </div>
        <label className="start-modal-field">
          分组名称
          <input
            ref={inputRef}
            value={name}
            maxLength={20}
            placeholder={placeholder}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCancel();
            }}
          />
        </label>
        <div className="start-modal-hint">{hint}</div>
        <div className="start-modal-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="is-primary" disabled={!name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
