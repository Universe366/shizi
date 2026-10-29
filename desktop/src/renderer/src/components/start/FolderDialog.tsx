import { FolderOpen, X } from 'lucide-react';
import type { StartShortcut } from '../../../../shared/types';
import { SiteIcon } from './SiteIcon';

interface FolderDialogProps {
  open: boolean;
  name: string;
  items: StartShortcut[];
  editMode: boolean;
  onClose: () => void;
  onOpen: (item: StartShortcut) => void;
  onRemoveFromFolder: (id: string) => void;
}

/** 起始页文件夹：点击后查看/打开里面收起的网络图标。 */
export function FolderDialog({
  open,
  name,
  items,
  editMode,
  onClose,
  onOpen,
  onRemoveFromFolder
}: FolderDialogProps) {
  if (!open) return null;
  return (
    <div className="start-modal-backdrop" onMouseDown={onClose}>
      <div
        className="start-modal start-folder-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="start-modal-title">
          <FolderOpen size={15} />
          {name}
          <span className="start-folder-dialog-count">{items.length}</span>
        </div>
        <div className="start-folder-dialog-grid">
          {items.map((item) => (
            <div className="start-folder-dialog-item" key={item.id}>
              <button
                className="start-folder-dialog-open"
                title={item.url}
                onClick={() => onOpen(item)}
              >
                <SiteIcon item={item} />
                <span>{item.label}</span>
              </button>
              {editMode && (
                <button
                  className="start-folder-dialog-remove"
                  title={`从文件夹移出 ${item.label}`}
                  onClick={() => onRemoveFromFolder(item.id)}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="start-modal-actions">
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
