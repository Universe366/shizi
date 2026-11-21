import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import type { StartShortcut } from '../../../shared/types';
import { SiteIcon } from './start/SiteIcon';

export interface StartPageFolderView {
  key: string;
  group: string;
  name: string;
  items: StartShortcut[];
}

interface Props {
  folders: StartPageFolderView[];
  visible: StartShortcut[];
  group: string;
  folderFilter: { group: string; name: string } | null;
  dropFolder: { group: string; name: string } | null;
  dragItemId?: string;
  suppressClickRef: MutableRefObject<boolean>;
  onFolderFilter: (value: { group: string; name: string } | null) => void;
  onReorderFolder: (from: string, to: string) => void;
  onOpenShortcut: (item: StartShortcut) => void;
  onStartLinkDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: StartShortcut
  ) => void;
  onEdit: (item: StartShortcut) => void;
  onRemove: (item: StartShortcut) => void;
  onContextMenu: (x: number, y: number, item: StartShortcut) => void;
  onAdd: (folder: { group: string; name: string } | null, group: string) => void;
}

/** 起始页主快捷方式网格：文件夹磁贴、链接卡、拖拽与添加入口。 */
export function StartPageLinks({
  folders,
  visible,
  group,
  folderFilter,
  dropFolder,
  dragItemId,
  suppressClickRef,
  onFolderFilter,
  onReorderFolder,
  onOpenShortcut,
  onStartLinkDrag,
  onEdit,
  onRemove,
  onContextMenu,
  onAdd
}: Props) {
  return (
    <div className="sc-links">
      {folderFilter ? (
        <button
          type="button"
          className="sc-folder-back"
          onClick={() => onFolderFilter(null)}
        >
          <ArrowLeft size={13} /> 返回全部
        </button>
      ) : (
        folders.map((folder) => (
          <button
            key={folder.key}
            type="button"
            data-folder={folder.name}
            data-group={folder.group}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/sc-folder', folder.key);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('text/sc-folder')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(event) => {
              const from = event.dataTransfer.getData('text/sc-folder');
              if (from) {
                event.preventDefault();
                onReorderFolder(from, folder.key);
              }
            }}
            className={`sc-link sc-folder${
              dropFolder?.group === folder.group && dropFolder.name === folder.name
                ? ' is-drop'
                : ''
            }`}
            title={`文件夹：${folder.group || '未分组'} / ${folder.name}（可把快捷方式拖进来）`}
            onClick={() => onFolderFilter({ group: folder.group, name: folder.name })}
          >
            <span className="sc-folder-icon">
              <Folder size={19} />
            </span>
            <span className="sc-link-label">{folder.name}</span>
            {group === '全部' && (
              <span className="sc-folder-group">{folder.group || '未分组'}</span>
            )}
            <span className="sc-folder-count">{folder.items.length}</span>
          </button>
        ))
      )}
      {visible.map((item) => (
        <div
          key={item.id}
          data-link-id={item.id}
          className={`sc-link-wrap${dragItemId === item.id ? ' is-dragging' : ''}`}
        >
          <button
            type="button"
            className="sc-link"
            title={`${item.label} · ${item.url}`}
            onPointerDown={(event) => onStartLinkDrag(event, item)}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onOpenShortcut(item);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(event.clientX, event.clientY, item);
            }}
          >
            <SiteIcon item={item} />
            <span className="sc-link-label">{item.label}</span>
          </button>
          <span className="sc-link-actions">
            <button
              type="button"
              title="编辑"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(item);
              }}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="删除"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item);
              }}
            >
              <Trash2 size={11} />
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        className="sc-add-link"
        onClick={() => onAdd(folderFilter, group)}
      >
        <Plus size={20} />
        <span>添加</span>
      </button>
    </div>
  );
}
