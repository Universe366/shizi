import { useState, type DragEvent } from 'react';
import { EmptyState } from '../ui/EmptyState';
import { Plus, X, type LucideIcon } from 'lucide-react';
import type { StartShortcut } from '../../../../shared/types';
import { faviconOf, hostOf, originOf, tileColor } from './model';

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
  onMove: (fromId: string, group: string, targetId?: string) => void;
  onMenu: (item: StartShortcut, x: number, y: number) => void;
  onDragStart: () => void;
}

/** 站点图标：优先站点自己的 /favicon.ico，失败时回退到域名生成的字母色块。 */
function Favicon({ item }: { item: StartShortcut }) {
  const [failed, setFailed] = useState(false);
  const origin = originOf(item.url);
  const color = tileColor(hostOf(item.url) || item.label);
  return (
    <span className="start-tile-icon" style={{ background: color.bg, color: color.fg }}>
      <span className="start-tile-letter">{item.label.slice(0, 1).toUpperCase()}</span>
      {origin && !failed && (
        <img
          src={faviconOf(item.url)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
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
  onMove,
  onMenu,
  onDragStart
}: ShortcutBoardProps) {
  const dropOn = (group: string, targetId?: string) => (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.getData('text/plain');
    if (from && from !== targetId) onMove(from, group, targetId);
  };

  return (
    <section className="start-board" aria-label="快捷方式">
      <div className="start-tabs">
        <button
          className={`start-tab${activeGroup === '全部' ? ' is-active' : ''}`}
          onClick={() => onGroup('全部')}
        >
          全部
          <span className="start-tab-count">{total}</span>
        </button>
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
        <button className="start-tab start-tab-add" title="添加快捷方式" onClick={onAdd}>
          <Plus size={13} />
          添加
        </button>
      </div>

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
            <span className="start-group-title">{group}</span>
            <span className="start-group-count">{items.length}</span>
          </div>
          <div className="start-grid">
            {items.map((item) => (
              <div
                key={item.id}
                className={`start-tile${editMode ? ' is-editing' : ''}`}
                title={item.url}
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
                <Favicon item={item} />
                <span className="start-tile-label">{item.label}</span>
                <span className="start-tile-sub">{hostOf(item.url)}</span>
                <span className="start-tile-actions">
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
        </div>
      ))}

      {visibleGroups.length === 0 && activeGroup !== '全部' && activeGroup !== '拾字' && (
        <EmptyState compact desc="这个分组还没有网址" />
      )}
    </section>
  );
}
