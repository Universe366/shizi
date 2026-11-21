import { Copy, ExternalLink, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import type { StartShortcut } from '../../../shared/types';

interface Props {
  menu: { x: number; y: number; item: StartShortcut };
  onOpen: () => void;
  onNewTab: () => void;
  onCopy: () => void;
  onRemoveFolder: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** 起始页快捷方式右键菜单。 */
export function StartPageContextMenu({
  menu,
  onOpen,
  onNewTab,
  onCopy,
  onRemoveFolder,
  onEdit,
  onDelete
}: Props) {
  return (
    <div className="sc-context" style={{ left: menu.x, top: menu.y }} role="menu">
      <button type="button" onClick={onOpen}>
        <ExternalLink size={13} /> 打开
      </button>
      <button type="button" onClick={onNewTab}>
        <Plus size={13} /> 新标签打开
      </button>
      <button type="button" onClick={onCopy}>
        <Copy size={13} /> 复制链接
      </button>
      {menu.item.folder && (
        <button type="button" onClick={onRemoveFolder}>
          <Folder size={13} /> 移出文件夹
        </button>
      )}
      <div className="sc-context-sep" />
      <button type="button" onClick={onEdit}>
        <Pencil size={13} /> 编辑
      </button>
      <button type="button" className="is-danger" onClick={onDelete}>
        <Trash2 size={13} /> 删除
      </button>
    </div>
  );
}
