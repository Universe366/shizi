import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { StartShortcut } from '../../../shared/types';
import { hostOf } from './start/model';

interface Props {
  shortcuts: StartShortcut[];
  onEdit: (item: StartShortcut) => void;
  onRemove: (item: StartShortcut) => void;
  onAdd: () => void;
  onImport: () => void;
}

/** 起始页设置里的快捷方式列表。 */
export function StartPageShortcutList({ shortcuts, onEdit, onRemove, onAdd, onImport }: Props) {
  return (
    <section>
      <h4>快捷方式</h4>
      <div className="sc-edit-list">
        {shortcuts.map((item) => (
          <div key={item.id} className="sc-edit-row">
            <span>{item.label}</span>
            <span>{hostOf(item.url)}</span>
            <button type="button" title="编辑" onClick={() => onEdit(item)}>
              <Pencil size={12} />
            </button>
            <button type="button" title="删除" onClick={() => onRemove(item)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="sc-inline-actions">
        <button type="button" className="sc-secondary" onClick={onAdd}>
          <Plus size={13} /> 添加
        </button>
        <button type="button" className="sc-secondary" onClick={onImport}>
          <Upload size={13} /> 导入书签
        </button>
      </div>
    </section>
  );
}
