import { useRef, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Plus,
  Star,
  Tags,
  Upload,
  X,
  type LucideIcon
} from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import type { StartShortcut } from '../../../../shared/types';
import { DENSITIES, hostOf, type StartDensity } from './model';
import { SiteIcon } from './SiteIcon';

export interface BuiltInEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

interface ShortcutBoardProps {
  groups: Array<[string, StartShortcut[]]>;
  visibleGroups: Array<[string, StartShortcut[]]>;
  total: number;
  activeGroup: string;
  editMode: boolean;
  builtIn: BuiltInEntry[];
  onGroup: (group: string) => void;
  onOpen: (item: StartShortcut) => void;
  onEdit: (item: StartShortcut) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onBatchAdd: () => void;
  onRenameGroup: (from: string, to: string) => void;
  onRemoveGroup: (group: string) => void;
  onMove: (fromId: string, group: string, targetId?: string) => void;
  onMenu: (item: StartShortcut, x: number, y: number) => void;
  onDragStart: () => void;
  density: StartDensity;
  onDensity: (density: StartDensity) => void;
  collapsed: string[];
  onToggleGroup: (group: string) => void;
  frequent: StartShortcut[];
  onExport: () => void;
  onImport: () => void;
  tags: Array<{ tag: string; count: number }>;
  activeTag: string;
  onTag: (tag: string) => void;
  onDetail: (item: StartShortcut) => void;
}

export function ShortcutBoard({
  groups,
  visibleGroups,
  total,
  activeGroup,
  editMode,
  builtIn,
  onGroup,
  onOpen,
  onEdit,
  onRemove,
  onAdd,
  onBatchAdd,
  onRenameGroup,
  onRemoveGroup,
  onMove,
  onMenu,
  onDragStart,
  density,
  onDensity,
  collapsed,
  onToggleGroup,
  frequent,
  onExport,
  onImport,
  tags,
  activeTag,
  onTag,
  onDetail
}: ShortcutBoardProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const startRename = (group: string) => {
    setRenaming(group);
    setDraft(group);
    window.setTimeout(() => renameRef.current?.select(), 30);
  };

  const commitRename = (group: string) => {
    const next = draft.trim();
    setRenaming(null);
    if (next && next !== group) onRenameGroup(group, next);
  };
  const dropOn = (group: string, targetId?: string) => (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.getData('text/plain');
    if (from && from !== targetId) onMove(from, group, targetId);
  };

  return (
    <section className={`start-board is-density-${density}`} aria-label="快捷方式">
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
            className={`start-tab${activeGroup === group ? ' is-active' : ''}`}
            onClick={() => onGroup(group)}
          >
            {group}
            <span className="start-tab-count">{items.length}</span>
          </button>
        ))}
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
          <button className="start-tab start-tab-add" title="导出起始页" onClick={onExport}>
            <Download size={13} />
          </button>
          <button className="start-tab start-tab-add" title="导入起始页" onClick={onImport}>
            <Upload size={13} />
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

      {tags.length > 0 && (
        <div className="start-tag-row" aria-label="按标签筛选">
          <span className="start-tag-label">标签</span>
          <button
            className={`start-tag${activeTag ? '' : ' is-active'}`}
            onClick={() => onTag('')}
          >
            全部
          </button>
          {tags.map((item) => (
            <button
              key={item.tag}
              className={`start-tag${activeTag === item.tag ? ' is-active' : ''}`}
              onClick={() => onTag(activeTag === item.tag ? '' : item.tag)}
            >
              {item.tag}
              <span className="start-tag-count">{item.count}</span>
            </button>
          ))}
        </div>
      )}

      {(activeGroup === '全部' || activeGroup === '拾字') && (
        <div className="start-group">
          <div className="start-group-head">
            <span className="start-group-title">拾字</span>
            <span className="start-group-count">{builtIn.length}</span>
          </div>
          <div className="start-app-row">
            {builtIn.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className="start-app-btn" onClick={item.run}>
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visibleGroups.map(([group, items]) => (
        <div
          className="start-group"
          key={group}
          onDragOver={(event) => {
            if (editMode) event.preventDefault();
          }}
          onDrop={dropOn(group)}
        >
          <div className="start-group-head">
            <button
              className="start-group-toggle"
              title={collapsed.includes(group) ? '展开分组' : '折叠分组'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleGroup(group);
              }}
            >
              {collapsed.includes(group) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
            {renaming === group ? (
              <input
                ref={renameRef}
                className="start-group-rename"
                value={draft}
                maxLength={12}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitRename(group)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(group);
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="start-group-title">{group}</span>
            )}
            <span className="start-group-count">{items.length}</span>
            {editMode && renaming !== group && (
              <span className="start-group-actions">
                <button
                  className="start-tile-action"
                  title="重命名分组"
                  onClick={() => startRename(group)}
                >
                  ✎
                </button>
                <button
                  className="start-tile-action is-danger"
                  title="删除分组"
                  onClick={() => onRemoveGroup(group)}
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
          {!collapsed.includes(group) && (
          <div className="start-grid">
            {items.map((item) => (
              <div
                key={item.id}
                className={`start-tile${editMode ? ' is-editing' : ''}`}
                title={item.desc ? `${item.desc}\n${item.url}` : item.url}
                role="button"
                tabIndex={0}
                draggable={editMode}
                onDragStart={(event) => {
                  onDragStart();
                  event.dataTransfer.setData('text/plain', item.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (editMode) event.preventDefault();
                }}
                onDrop={dropOn(group, item.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onMenu(item, event.clientX, event.clientY);
                }}
                onClick={() => onOpen(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(item);
                  }
                }}
              >
                <SiteIcon item={item} />
                <span className="start-tile-label">{item.label}</span>
                <span className="start-tile-sub">{hostOf(item.url)}</span>
                <span className="start-tile-actions">
                  <button
                    className="start-tile-action"
                    title="查看详情"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDetail(item);
                    }}
                  >
                    <Info size={11} />
                  </button>
                  <button
                    className="start-tile-action"
                    title="编辑名称/网址/分组"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(item);
                    }}
                  >
                    ✎
                  </button>
                  {editMode && (
                    <button
                      className="start-tile-action is-danger"
                      title="删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(item.id);
                      }}
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          )}
        </div>
      ))}

      {visibleGroups.length === 0 && activeGroup !== '全部' && activeGroup !== '拾字' && (
        <EmptyState compact desc="这个分组还没有网址" />
      )}

      {total === 0 && (
        <EmptyState
          icon={<Plus size={22} />}
          title="还没有自定义快捷方式"
          desc="添加常用站点，或把浏览器书签粘贴进来批量导入。"
          action={
            <div className="start-empty-actions">
              <button className="mini-btn primary" onClick={onAdd}>
                添加站点
              </button>
              <button className="mini-btn" onClick={onBatchAdd}>
                批量导入
              </button>
            </div>
          }
        />
      )}
    </section>
  );
}