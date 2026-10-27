import { useEffect, useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import { parseShortcutLines, type ParsedShortcut } from './model';

interface BatchAddDialogProps {
  open: boolean;
  groups: string[];
  defaultGroup: string;
  onCancel: () => void;
  onAdd: (items: ParsedShortcut[]) => void;
}

/** 批量导入：粘贴多行「名称 URL / 纯网址」，一次加进当前分组。 */
export function BatchAddDialog({ open, groups, defaultGroup, onCancel, onAdd }: BatchAddDialogProps) {
  const [text, setText] = useState('');
  const [group, setGroup] = useState(defaultGroup);

  useEffect(() => {
    if (!open) return;
    setText('');
    setGroup(defaultGroup);
  }, [open, defaultGroup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, open]);

  const parsed = useMemo(
    () => parseShortcutLines(text, group.trim() || '常用'),
    [text, group]
  );

  if (!open) return null;

  return (
    <div className="start-modal-backdrop" onMouseDown={onCancel}>
      <div className="start-modal start-modal-wide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="start-modal-title">
          <Tags size={14} /> 批量导入网址
        </div>
        <div className="start-modal-field">
          <span>每行一条，支持「名称 URL」「名称,URL」或直接粘贴网址</span>
          <textarea
            className="start-batch-textarea"
            value={text}
            rows={8}
            spellCheck={false}
            placeholder={'哔哩哔哩 https://www.bilibili.com\n知乎 https://www.zhihu.com\nhttps://github.com'}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <label className="start-modal-field">
          <span>加入分组</span>
          <input
            list="start-batch-groups"
            maxLength={12}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          />
          <datalist id="start-batch-groups">
            {groups.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>

        <div className="start-batch-summary">
          {parsed.length ? `识别到 ${parsed.length} 条` : '还没有识别到网址'}
          {parsed.length > 0 && (
            <span className="start-batch-preview">
              {parsed
                .slice(0, 3)
                .map((item) => item.label)
                .join(' · ')}
              {parsed.length > 3 ? ' …' : ''}
            </span>
          )}
        </div>

        <div className="start-modal-actions">
          <button className="mini-btn" onClick={onCancel}>
            取消
          </button>
          <button
            className="mini-btn primary"
            disabled={!parsed.length}
            onClick={() => {
              onAdd(parsed);
              onCancel();
            }}
          >
            导入 {parsed.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
