import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { StartShortcut } from '../../../shared/types';

export interface StartFolderEntry {
  key: string;
  group: string;
  name: string;
  count: number;
}

interface Props {
  groups: string[];
  shortcuts: StartShortcut[];
  currentGroup: string;
  folderEntries: StartFolderEntry[];
  groupEdit: { from: string; to: string } | null;
  folderEdit: { group: string; from: string; to: string } | null;
  folderDraft: { group: string; name: string } | null;
  onGroupEdit: (value: { from: string; to: string } | null) => void;
  onFolderEdit: (value: { group: string; from: string; to: string } | null) => void;
  onFolderDraft: (value: { group: string; name: string } | null) => void;
  onCreateFolder: () => void;
  onCommitGroupRename: () => void;
  onCommitFolderRename: () => void;
  onRemoveGroup: (name: string) => void;
  onRemoveFolder: (group: string, name: string) => void;
}

/** 起始页设置里的分组 / 文件夹管理，独立于主页面渲染。 */
export function StartPageGroupFolderManager({
  groups,
  shortcuts,
  currentGroup,
  folderEntries,
  groupEdit,
  folderEdit,
  folderDraft,
  onGroupEdit,
  onFolderEdit,
  onFolderDraft,
  onCreateFolder,
  onCommitGroupRename,
  onCommitFolderRename,
  onRemoveGroup,
  onRemoveFolder
}: Props) {
  return (
    <>
      {groups.length > 0 && (
        <section>
          <h4>分组</h4>
          <div className="sc-edit-list">
            {groups.map((name) => (
              <div key={name} className="sc-edit-row">
                {groupEdit?.from === name ? (
                  <input
                    className="sc-group-input"
                    autoFocus
                    value={groupEdit.to}
                    onChange={(event) => onGroupEdit({ from: name, to: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onCommitGroupRename();
                      } else if (event.key === 'Escape') {
                        onGroupEdit(null);
                      }
                    }}
                    onBlur={onCommitGroupRename}
                  />
                ) : (
                  <span>{name}</span>
                )}
                <span>{shortcuts.filter((item) => item.group === name).length} 个</span>
                <button
                  type="button"
                  title="重命名分组"
                  onClick={() => onGroupEdit({ from: name, to: name })}
                >
                  <Pencil size={12} />
                </button>
                <button type="button" title="删除分组" onClick={() => onRemoveGroup(name)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="sc-hint">删除分组只取消分组，不会删除快捷方式。</div>
        </section>
      )}

      <section>
        <h4>文件夹</h4>
        <div className="sc-folder-create">
          <input
            value={folderDraft?.group ?? (currentGroup === '全部' ? '' : currentGroup)}
            placeholder="分组（可选）"
            onChange={(event) =>
              onFolderDraft({
                group: event.target.value,
                name: folderDraft?.name || ''
              })
            }
          />
          <input
            value={folderDraft?.name || ''}
            placeholder="文件夹名"
            onChange={(event) =>
              onFolderDraft({
                group: folderDraft?.group ?? (currentGroup === '全部' ? '' : currentGroup),
                name: event.target.value
              })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCreateFolder();
              }
            }}
          />
          <button
            type="button"
            className="sc-secondary"
            disabled={!folderDraft?.name.trim()}
            onClick={onCreateFolder}
          >
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="sc-edit-list">
          {folderEntries.map((entry) => (
            <div key={entry.key} className="sc-edit-row">
              {folderEdit?.group === entry.group && folderEdit.from === entry.name ? (
                <input
                  className="sc-group-input"
                  autoFocus
                  value={folderEdit.to}
                  onChange={(event) =>
                    onFolderEdit({
                      group: entry.group,
                      from: entry.name,
                      to: event.target.value
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onCommitFolderRename();
                    } else if (event.key === 'Escape') {
                      onFolderEdit(null);
                    }
                  }}
                  onBlur={onCommitFolderRename}
                />
              ) : (
                <span>
                  {entry.group || '未分组'} / {entry.name}
                </span>
              )}
              <span>{entry.count} 个</span>
              <button
                type="button"
                title="重命名文件夹"
                onClick={() =>
                  onFolderEdit({
                    group: entry.group,
                    from: entry.name,
                    to: entry.name
                  })
                }
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title="删除文件夹"
                onClick={() => onRemoveFolder(entry.group, entry.name)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="sc-hint">删除文件夹只取消归类，不会删除快捷方式。</div>
      </section>
    </>
  );
}
