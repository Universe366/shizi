import { useState, type DragEvent } from 'react';
import {
  Bookmark,
  Download,
  Folder,
  FolderPlus,
  Plus,
  Star,
  Tags,
  Upload
} from 'lucide-react';
import { DENSITIES, type StartDensity } from './model';
import type { StartShortcut } from '../../../../shared/types';

interface StartSidebarProps {
  groups: Array<[string, StartShortcut[]]>;
  total: number;
  activeGroup: string;
  onGroup: (group: string) => void;
  density: StartDensity;
  onDensity: (density: StartDensity) => void;
  selected: string[];
  onClearSelection: () => void;
  onBatchDelete: () => void;
  onBatchMove: (group: string) => void;
  onBatchFolder?: () => void;
  onNewGroupFrom: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onImportBookmarks: () => void;
  onBatchAdd: () => void;
  onAdd: () => void;
  frequent: StartShortcut[];
  onMove: (fromId: string, group: string) => void;
  onReorderGroup: (from: string, to: string) => void;
}

/** 起始页左侧导航：分组、密度、导入导出、批量与添加。 */
export function StartSidebar({
  groups,
  total,
  activeGroup,
  onGroup,
  density,
  onDensity,
  selected,
  onClearSelection,
  onBatchDelete,
  onBatchMove,
  onBatchFolder,
  onNewGroupFrom,
  onExport,
  onImport,
  onImportBookmarks,
  onBatchAdd,
  onAdd,
  frequent,
  onMove,
  onReorderGroup
}: StartSidebarProps) {
  const [dropGroup, setDropGroup] = useState<string | null>(null);

  const dropOn = (group: string) => (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.getData('text/plain');
    if (from.startsWith('group:')) onReorderGroup(from.slice(6), group);
    else if (from) onMove(from, group);
    setDropGroup(null);
  };

  return (
    <aside className="start-sidebar" aria-label="起始页导航">
      <div className="start-tabs">
        <button
          className={`start-tab${activeGroup === '全部' ? ' is-active' : ''}`}
          onClick={() => onGroup('全部')}
        >
          全部
          <span className="start-tab-count">{total}</span>
        </button>
        {frequent.length > 0 && (
          <button
            className={`start-tab${activeGroup === '常用' ? ' is-active' : ''}`}
            onClick={() => onGroup('常用')}
            title="按打开次数排序"
          >
            <Star size={12} /> 常用
            <span className="start-tab-count">{frequent.length}</span>
          </button>
        )}
        {groups.map(([group, items]) => (
          <button
            key={group}
            className={`start-tab${activeGroup === group ? ' is-active' : ''}${
              dropGroup === group ? ' is-drop' : ''
            }`}
            title="点击切换；拖动可排序；拖入快捷方式可移到该分组"
            draggable
            onClick={() => onGroup(group)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', `group:${group}`);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDropGroup(group);
            }}
            onDragLeave={() => setDropGroup((current) => (current === group ? null : current))}
            onDrop={dropOn(group)}
          >
            <Folder size={12} />
            {group}
            <span className="start-tab-count">{items.length}</span>
          </button>
        ))}
        <button
          className={`start-tab start-tab-new${dropGroup === '__new__' ? ' is-drop' : ''}`}
          title="拖一个快捷方式到这里新建分组"
          onClick={() => onNewGroupFrom('')}
          onDragOver={(event) => {
            event.preventDefault();
            setDropGroup('__new__');
          }}
          onDragLeave={() => setDropGroup((current) => (current === '__new__' ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData('text/plain');
            setDropGroup(null);
            if (id) onNewGroupFrom(id);
          }}
        >
          <FolderPlus size={12} /> 新分组
        </button>
        <span className="start-tab-actions">
          <span className="start-density" role="group" aria-label="卡片密度">
            {DENSITIES.map((item) => (
              <button
                key={item.id}
                className={`start-density-btn${density === item.id ? ' is-active' : ''}`}
                title={item.hint}
                onClick={() => onDensity(item.id)}
              >
                {item.label}
              </button>
            ))}
          </span>
          {selected.length > 0 && (
            <span className="start-selection">
              <span className="start-selection-count">已选 {selected.length}</span>
              <select
                value=""
                title="移动到分组"
                onChange={(event) => {
                  const group = event.target.value;
                  if (group) onBatchMove(group);
                }}
              >
                <option value="">移动到…</option>
                {groups.map(([group]) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <button onClick={onBatchFolder}>
                文件夹
              </button>
              <button className="is-danger" onClick={onBatchDelete}>
                删除
              </button>
              <button onClick={onClearSelection}>取消</button>
            </span>
          )}
          <button className="start-tab start-tab-add" title="导出起始页" onClick={onExport}>
            <Download size={13} />
            导出
          </button>
          <button className="start-tab start-tab-add" title="导入起始页" onClick={onImport}>
            <Upload size={13} />
            导入
          </button>
          <button
            className="start-tab start-tab-add"
            title="导入浏览器书签"
            onClick={onImportBookmarks}
          >
            <Bookmark size={13} />
            书签
          </button>
          <button className="start-tab start-tab-add" title="批量导入网址" onClick={onBatchAdd}>
            <Tags size={13} />
            批量
          </button>
          <button className="start-tab start-tab-add" title="添加快捷方式" onClick={onAdd}>
            <Plus size={13} />
            添加
          </button>
        </span>
      </div>
    </aside>
  );
}
