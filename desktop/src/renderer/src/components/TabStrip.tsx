import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { TabGroup, TabInfo } from '../../../shared/types';

interface TabMenuState {
  x: number;
  y: number;
  tab: TabInfo;
}

interface ClosedTab {
  url: string;
  title: string;
}

const GROUP_COLORS: Array<{ id: TabGroup['color']; label: string }> = [
  { id: 'blue', label: '蓝' },
  { id: 'green', label: '绿' },
  { id: 'red', label: '红' },
  { id: 'yellow', label: '黄' },
  { id: 'purple', label: '紫' },
  { id: 'gray', label: '灰' }
];

const DEFAULT_WIDTH = 220;

export function TabStrip({
  tabs,
  vertical = false,
  onSearch,
  onNewTab
}: {
  tabs: TabInfo[];
  vertical?: boolean;
  onSearch?: () => void;
  onNewTab?: () => void;
}) {
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const [filter, setFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [closed, setClosed] = useState<ClosedTab[]>([]);
  const actionsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const persistTimer = useRef<number | null>(null);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tabs.collapsed') === '1');
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('tabs.width'));
    return Number.isFinite(saved) && saved >= 160 ? Math.min(360, Math.max(160, saved)) : DEFAULT_WIDTH;
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [peekOpen, setPeekOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: TabGroup } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    mode: 'create' | 'rename';
    id?: string;
    name: string;
    color: TabGroup['color'];
    seed?: string[];
  } | null>(null);
  const [preview, setPreview] = useState<{
    tabId: string;
    title: string;
    url: string;
    dataUrl: string;
    top: number;
  } | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewCache = useRef<Map<string, { at: number; dataUrl: string; title: string; url: string }>>(
    new Map()
  );
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const query = filter.trim().toLowerCase();
  const matches = (tab: TabInfo) => {
    if (!query) return true;
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = '';
    }
    return `${tab.title} ${tab.url} ${host}`.toLowerCase().includes(query);
  };
  const visibleTabs = tabs.filter(matches);
  const expanded = !collapsed || peekOpen;
  const pinnedTabs = visibleTabs.filter((tab) => tab.pinned);
  const normalTabs = visibleTabs.filter((tab) => !tab.pinned);
  const ungroupedTabs = normalTabs.filter((tab) => !tab.groupId);

  useEffect(() => {
    localStorage.setItem('tabs.collapsed', collapsed ? '1' : '0');
    persistPane({ verticalTabsCollapsed: collapsed });
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem('tabs.width', String(width));
    persistPane({ verticalTabsWidth: width });
  }, [width]);

  useEffect(() => {
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, []);

  useEffect(() => {
    const api = window.bsub;
    void api.getTabGroups?.().then((list) => setGroups(Array.isArray(list) ? list : []));
    return api.onTabGroups?.((list) => setGroups(Array.isArray(list) ? list : []));
  }, []);

  useEffect(() => {
    // 首次挂载时用设置里的值覆盖 localStorage 旧值。
    void (async () => {
      const getSettings = window.bsub?.getSettings;
      if (typeof getSettings !== 'function') return;
      const snapshot = await getSettings();
      if (!snapshot.ok) return;
      const general = snapshot.data.settings.general;
      if (typeof general.verticalTabsWidth === 'number') {
        setWidth(Math.min(360, Math.max(160, general.verticalTabsWidth)));
      }
      if (typeof general.verticalTabsCollapsed === 'boolean') {
        setCollapsed(general.verticalTabsCollapsed);
      }
    })();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    filterRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    listRef.current?.querySelector('.tab.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [tabs]);

  useEffect(() => {
    if (!actionsOpen) return;
    void (async () => {
      const listClosedTabs = window.bsub?.listClosedTabs;
      if (typeof listClosedTabs !== 'function') return;
      const list = await listClosedTabs();
      setClosed(Array.isArray(list) ? list.slice(0, 5) : []);
    })();
    const close = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen]);

  useEffect(() => {
    if (!groupMenu) return;
    const close = () => setGroupMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [groupMenu]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const persistPane = (patch: Record<string, unknown>) => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void (async () => {
        const getSettings = window.bsub?.getSettings;
        const saveSettings = window.bsub?.saveSettings;
        if (typeof getSettings !== 'function' || typeof saveSettings !== 'function') return;
        const snapshot = await getSettings();
        if (!snapshot.ok) return;
        const settings = snapshot.data.settings;
        Object.assign(settings.general, patch);
        await saveSettings(settings);
      })();
    }, 350);
  };

  const activate = (id: string) => {
    setSelected([]);
    setAnchorId(id);
    void window.bsub.activateTab(id);
  };

  const clickTab = (event: React.MouseEvent, tab: TabInfo) => {
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) =>
        current.includes(tab.id) ? current.filter((id) => id !== tab.id) : [...current, tab.id]
      );
      setAnchorId(tab.id);
      return;
    }
    if (event.shiftKey && anchorId) {
      const from = tabs.findIndex((item) => item.id === anchorId);
      const to = tabs.findIndex((item) => item.id === tab.id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected(tabs.slice(start, end + 1).map((item) => item.id));
        return;
      }
    }
    activate(tab.id);
  };

  const closeTabs = (ids: string[]) => {
    for (const id of ids) void window.bsub.closeTab(id);
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  };

  const sleepTabs = (ids: string[]) => {
    for (const id of ids) void window.bsub.sleepTab?.(id);
  };

  const closeOthers = (keepId: string) => {
    for (const tab of tabs) {
      if (tab.id !== keepId) void window.bsub.closeTab(tab.id);
    }
  };

  const closeToRight = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    for (const tab of tabs.slice(index + 1)) void window.bsub.closeTab(tab.id);
  };

  const dropIndex = (fromId: string, targetId: string, after: boolean): number => {
    const rest = tabs.filter((tab) => tab.id !== fromId);
    const target = rest.findIndex((tab) => tab.id === targetId);
    if (target < 0) return rest.length;
    return target + (after ? 1 : 0);
  };

  const onDragOverTab = (event: React.DragEvent, tab: TabInfo) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = rect.height === 0 ? true : event.clientY > rect.top + rect.height / 2;
    setDropTarget({ id: tab.id, after });
    const list = listRef.current;
    if (list) {
      const box = list.getBoundingClientRect();
      if (event.clientY < box.top + 28) list.scrollTop -= 12;
      else if (event.clientY > box.bottom - 28) list.scrollTop += 12;
    }
  };

  const finishDrop = (tab: TabInfo) => {
    const from = draggingId;
    const after = dropTarget?.id === tab.id ? dropTarget.after : true;
    setDropTarget(null);
    setDraggingId(null);
    if (!from || from === tab.id) return;
    const dragged = tabs.find((item) => item.id === from);
    if (dragged && Boolean(dragged.pinned) !== Boolean(tab.pinned)) return;
    void window.bsub.moveTab(from, dropIndex(from, tab.id, after));
    if ((dragged?.groupId || null) !== (tab.groupId || null)) {
      void window.bsub.assignTabGroup?.(from, tab.groupId || null);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const activeIndex = tabs.findIndex((tab) => tab.active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + delta + tabs.length) % tabs.length;
      if (tabs[next]) activate(tabs[next].id);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
      if (target) activate(target.id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      const ids = selected.length ? selected : activeIndex >= 0 ? [tabs[activeIndex].id] : [];
      closeTabs(ids);
    } else if (event.key === 'Escape') {
      setSelected([]);
    }
  };

  const batchIds = (tab: TabInfo) => (selected.includes(tab.id) ? selected : [tab.id]);

  const hidePreview = () => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreview(null);
  };

  const showPreview = (tab: TabInfo, element: HTMLElement) => {
    if (!vertical || !expanded || draggingId) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        const cached = previewCache.current.get(tab.id);
        let data = cached && Date.now() - cached.at < 15000 ? cached : null;
        if (!data) {
          const result = await window.bsub.tabPreview?.(tab.id);
          if (!result) return;
          data = { at: Date.now(), ...result };
          previewCache.current.set(tab.id, data);
        }
        const strip = stripRef.current?.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        const top = strip ? Math.max(6, box.top - strip.top) : 6;
        setPreview({
          tabId: tab.id,
          title: data.title || tab.title,
          url: data.url || tab.url,
          dataUrl: data.dataUrl,
          top
        });
      })();
    }, 450);
  };

  const saveGroupDialog = async () => {
    if (!groupDialog) return;
    const name = groupDialog.name.trim() || '新分组';
    if (groupDialog.mode === 'rename' && groupDialog.id) {
      await window.bsub.renameTabGroup?.(groupDialog.id, name);
    } else {
      const group = await window.bsub.createTabGroup?.(name, groupDialog.color);
      if (group && groupDialog.seed?.length) {
        for (const tabId of groupDialog.seed) {
          await window.bsub.assignTabGroup?.(tabId, group.id);
        }
      }
    }
    setGroupDialog(null);
  };

  const renderTab = (tab: TabInfo) => {
    const isSelected = selected.includes(tab.id);
    const drop = dropTarget?.id === tab.id;
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.active}
        tabIndex={-1}
        className={`tab${tab.active ? ' is-active' : ''}${tab.suspended ? ' is-suspended' : ''}${
          isSelected ? ' is-selected' : ''
        }${draggingId === tab.id ? ' is-dragging' : ''}${
          drop ? (dropTarget.after ? ' is-drop-after' : ' is-drop-before') : ''
        }`}
        title={`${tab.title || '新标签页'}${tab.suspended ? '（已休眠，点击恢复）' : ''}`}
        draggable={!collapsed || peekOpen}
        onDragStart={(event) => {
          setDraggingId(tab.id);
          event.dataTransfer?.setData('text/plain', tab.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
        onDragOver={(event) => onDragOverTab(event, tab)}
        onDrop={(event) => {
          event.preventDefault();
          finishDrop(tab);
        }}
        onMouseEnter={(event) => showPreview(tab, event.currentTarget)}
        onMouseLeave={hidePreview}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            void window.bsub.closeTab(tab.id);
          }
        }}
        onClick={(event) => clickTab(event, tab)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, tab });
        }}
      >
        <span className="tab-icon">
          {tab.loading ? (
            <Loader2 size={13} className="spin" />
          ) : tab.suspended ? (
            <Moon size={13} />
          ) : tab.favicon ? (
            <img
              className="tab-favicon"
              src={tab.favicon}
              alt=""
              draggable={false}
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <Globe size={13} />
          )}
        </span>
        {tab.pinned && (
          <span className="tab-pin" title="已固定">
            ★
          </span>
        )}
        {expanded && <span className="tab-title">{tab.title || '新标签页'}</span>}
        {(tab.audible || tab.muted) && (
          <button
            className={`tab-audio${tab.muted ? ' is-muted' : ''}`}
            title={tab.muted ? '取消静音' : '静音此标签'}
            aria-label={tab.muted ? '取消静音' : '静音此标签'}
            onClick={(event) => {
              event.stopPropagation();
              void window.bsub.setTabMuted?.(tab.id, !tab.muted);
            }}
          >
            {tab.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
        )}
        <button
          className="tab-close"
          title="关闭标签页"
          onClick={(event) => {
            event.stopPropagation();
            void window.bsub.closeTab(tab.id);
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  return (
    <div
      ref={stripRef}
      className={`tab-strip${vertical ? ' is-vertical' : ''}${
        collapsed ? ' is-collapsed' : ''
      }${collapsed && peekOpen ? ' is-peeking' : ''}`}
      style={vertical ? { width: collapsed && !peekOpen ? 52 : width } : undefined}
      onMouseEnter={() => {
        if (collapsed) setPeekOpen(true);
      }}
      onMouseLeave={() => {
        setPeekOpen(false);
        setPreview(null);
      }}
    >
      {vertical && (
        <div
          className="tab-vertical-head"
          onDoubleClick={() => setCollapsed((value) => !value)}
          title="双击折叠/展开"
        >
          <button
            className="tab-collapse"
            title={collapsed ? '展开标签栏' : '折叠标签栏'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '»' : '«'}
          </button>
          {expanded && (
            <span className="tab-vertical-title">
              标签<span className="tab-count">{tabs.length}</span>
            </span>
          )}
          {expanded && (
            <div className="tab-head-actions">
              <button
                className={`tab-head-new${searchOpen ? ' is-active' : ''}`}
                title="搜索标签"
                onClick={() => setSearchOpen((value) => !value)}
              >
                <Search size={13} />
              </button>
              <button
                className="tab-head-new"
                title="新建标签页（Ctrl+T）"
                onClick={() => (onNewTab ? onNewTab() : void window.bsub.newTab())}
              >
                <Plus size={14} />
              </button>
              <div className="tab-actions-wrap" ref={actionsRef}>
                <button
                  className={`tab-head-new${actionsOpen ? ' is-active' : ''}`}
                  title="标签操作"
                  onClick={() => setActionsOpen((value) => !value)}
                >
                  <MoreHorizontal size={14} />
                </button>
                {actionsOpen && (
                  <div className="tab-actions-menu" role="menu">
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        if (onNewTab) onNewTab();
                        else void window.bsub.newTab();
                      }}
                    >
                      新建标签页
                    </button>
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        setSearchOpen(true);
                      }}
                    >
                      搜索标签
                    </button>
                    {selected.length > 0 && (
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          closeTabs(selected);
                        }}
                      >
                        关闭所选（{selected.length}）
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        const activeTab = tabs.find((tab) => tab.active);
                        for (const tab of tabs) {
                          if (!activeTab || tab.id !== activeTab.id) void window.bsub.closeTab(tab.id);
                        }
                      }}
                    >
                      关闭其他标签
                    </button>
                    <button
                      className="is-danger"
                      onClick={() => {
                        setActionsOpen(false);
                        closeTabs(tabs.map((tab) => tab.id));
                      }}
                    >
                      关闭全部标签
                    </button>
                    <div className="tab-menu-sep" />
                    <div className="tab-menu-label">最近关闭</div>
                    {closed.length === 0 && <div className="tab-menu-empty">没有已关闭的标签</div>}
                    {closed.map((item, index) => (
                      <button
                        key={`${item.url}-${index}`}
                        title={item.url}
                        onClick={() => {
                          setActionsOpen(false);
                          void window.bsub.reopenClosedAt?.(index);
                        }}
                      >
                        {item.title || item.url}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {vertical && expanded && searchOpen && (
        <div className="tab-filter">
          <Search size={12} />
          <input
            ref={filterRef}
            value={filter}
            placeholder="搜索标签…"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('');
                setSearchOpen(false);
              }
            }}
          />
          {filter && (
            <button className="tab-filter-clear" title="清空" onClick={() => setFilter('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
      {vertical && expanded && (
        <div
          className="tab-resize"
          title="拖动调整宽度（双击恢复默认）"
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          onMouseDown={(event) => {
            dragRef.current = { startX: event.clientX, startWidth: width };
            const move = (moveEvent: MouseEvent) => {
              const state = dragRef.current;
              if (!state) return;
              setWidth(
                Math.min(360, Math.max(160, state.startWidth + moveEvent.clientX - state.startX))
              );
            };
            const up = () => {
              dragRef.current = null;
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
        />
      )}
      <div
        ref={listRef}
        className="tab-strip-list"
        role="tablist"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) onNewTab?.();
        }}
      >
        {pinnedTabs.length > 0 && (
          <div className="tab-section-label" aria-hidden="true">
            已固定
          </div>
        )}
        {pinnedTabs.map(renderTab)}
        {pinnedTabs.length > 0 && normalTabs.length > 0 && <div className="tab-section-sep" />}
        {ungroupedTabs.map(renderTab)}
        {groups.map((group) => {
          const items = normalTabs.filter((tab) => tab.groupId === group.id);
          if (query && !items.length) return null;
          return (
            <div className={`tab-group is-${group.color}`} key={group.id}>
              <div
                className="tab-group-head"
                title={`${group.name}（${items.length}）`}
                onClick={() => void window.bsub.toggleTabGroupCollapsed?.(group.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setGroupMenu({ x: event.clientX, y: event.clientY, group });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = draggingId || event.dataTransfer?.getData('text/plain');
                  setDraggingId(null);
                  setDropTarget(null);
                  if (!from) return;
                  void window.bsub.assignTabGroup?.(from, group.id);
                  void window.bsub.moveTab(from, tabs.length - 1);
                }}
              >
                {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="tab-group-dot" />
                <span className="tab-group-name">{group.name}</span>
                <span className="tab-group-count">{items.length}</span>
              </div>
              {!group.collapsed && items.map(renderTab)}
            </div>
          );
        })}
        {!visibleTabs.length && <div className="tab-empty">没有匹配的标签</div>}
      </div>
      {preview && (
        <div className="tab-preview" style={{ top: preview.top }}>
          <img className="tab-preview-image" src={preview.dataUrl} alt="" draggable={false} />
          <div className="tab-preview-meta">
            <strong>{preview.title}</strong>
            <span>{preview.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
          </div>
        </div>
      )}
      {!vertical && (
        <>
          <button className="tab-search" title="全局搜索（Ctrl+K）" onClick={() => onSearch?.()}>
            <Search size={14} />
          </button>
          <button
            className="tab-new"
            title="新建标签页（起始页）"
            onClick={() => (onNewTab ? onNewTab() : void window.bsub.newTab())}
          >
            <Plus size={15} />
          </button>
        </>
      )}

      {menu && (() => {
        const ids = batchIds(menu.tab);
        return (
          <div
            ref={menuRef}
            className="tab-menu"
            style={{ position: 'fixed', left: menu.x, top: menu.y }}
            role="menu"
          >
            <button
              className="tab-menu-item"
              onClick={() => {
                closeTabs(ids);
                setMenu(null);
              }}
            >
              {ids.length > 1 ? `关闭所选（${ids.length}）` : '关闭'}
            </button>
            {ids.length === 1 && (
              <>
                <button
                  className="tab-menu-item"
                  onClick={() => {
                    void window.bsub.pinTab(menu.tab.id, !menu.tab.pinned);
                    setMenu(null);
                  }}
                >
                  {menu.tab.pinned ? '取消固定' : '固定标签'}
                </button>
                <button
                  className="tab-menu-item"
                  onClick={() => {
                    void window.bsub.setTabMuted?.(menu.tab.id, !menu.tab.muted);
                    setMenu(null);
                  }}
                >
                  {menu.tab.muted ? '取消静音' : '静音标签'}
                </button>
                <button
                  className="tab-menu-item"
                  onClick={() => {
                    if (menu.tab.suspended) void window.bsub.wakeTab?.(menu.tab.id);
                    else void window.bsub.sleepTab?.(menu.tab.id);
                    setMenu(null);
                  }}
                >
                  {menu.tab.suspended ? '唤醒标签' : '休眠标签'}
                </button>
              </>
            )}
            {ids.length > 1 && (
              <button
                className="tab-menu-item"
                onClick={() => {
                  sleepTabs(ids);
                  setMenu(null);
                }}
              >
                休眠所选（{ids.length}）
              </button>
            )}
            <div className="tab-menu-sep" />
            {groups.map((group) => (
              <button
                key={group.id}
                className="tab-menu-item"
                onClick={() => {
                  for (const id of ids) void window.bsub.assignTabGroup?.(id, group.id);
                  setMenu(null);
                }}
              >
                加入分组：{group.name}
              </button>
            ))}
            {menu.tab.groupId && (
              <button
                className="tab-menu-item"
                onClick={() => {
                  for (const id of ids) void window.bsub.assignTabGroup?.(id, null);
                  setMenu(null);
                }}
              >
                移出分组
              </button>
            )}
            <button
              className="tab-menu-item"
              onClick={() => {
                setMenu(null);
                setGroupDialog({
                  mode: 'create',
                  name: '',
                  color: 'blue',
                  seed: ids
                });
              }}
            >
              新建分组…
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                closeOthers(menu.tab.id);
                setMenu(null);
              }}
            >
              关闭其他
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                closeToRight(menu.tab.id);
                setMenu(null);
              }}
            >
              关闭右侧
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                void window.bsub.writeClipboard(menu.tab.url);
                setMenu(null);
              }}
            >
              复制链接
            </button>
            <div className="tab-menu-sep" />
            <button
              className="tab-menu-item"
              onClick={() => {
                setMenu(null);
                onNewTab?.();
              }}
            >
              新建标签页
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                setMenu(null);
                void window.bsub.reopenClosedTab();
              }}
            >
              重新打开关闭的标签
            </button>
          </div>
        );
      })()}

      {groupMenu && (
        <div
          className="tab-actions-menu tab-group-menu"
          style={{ position: 'fixed', left: groupMenu.x, top: groupMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="tab-menu-label">{groupMenu.group.name}</div>
          <div className="tab-group-colors">
            {GROUP_COLORS.map((color) => (
              <button
                key={color.id}
                className={`tab-group-color is-${color.id}${
                  groupMenu.group.color === color.id ? ' is-active' : ''
                }`}
                title={color.label}
                onClick={() => {
                  void window.bsub.setTabGroupColor?.(groupMenu.group.id, color.id);
                  setGroupMenu(null);
                }}
              />
            ))}
          </div>
          <button
            className="tab-menu-item"
            onClick={() => {
              setGroupDialog({
                mode: 'rename',
                id: groupMenu.group.id,
                name: groupMenu.group.name,
                color: groupMenu.group.color
              });
              setGroupMenu(null);
            }}
          >
            重命名…
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              void window.bsub.toggleTabGroupCollapsed?.(groupMenu.group.id);
              setGroupMenu(null);
            }}
          >
            {groupMenu.group.collapsed ? '展开分组' : '折叠分组'}
          </button>
          <button
            className="tab-menu-item is-danger"
            onClick={() => {
              void window.bsub.closeTabGroup?.(groupMenu.group.id);
              setGroupMenu(null);
            }}
          >
            关闭分组
          </button>
        </div>
      )}

      {groupDialog && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGroupDialog(null);
          }}
        >
          <div className="confirm-card tab-group-dialog" role="dialog" aria-modal="true">
            <div className="confirm-title">
              {groupDialog.mode === 'rename' ? '重命名分组' : '新建分组'}
            </div>
            <input
              className="settings-input"
              autoFocus
              maxLength={24}
              value={groupDialog.name}
              placeholder="分组名称，例如：论文"
              onChange={(event) => setGroupDialog({ ...groupDialog, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveGroupDialog();
              }}
            />
            <div className="tab-group-colors">
              {GROUP_COLORS.map((color) => (
                <button
                  key={color.id}
                  className={`tab-group-color is-${color.id}${
                    groupDialog.color === color.id ? ' is-active' : ''
                  }`}
                  title={color.label}
                  onClick={() => setGroupDialog({ ...groupDialog, color: color.id })}
                />
              ))}
            </div>
            <div className="confirm-actions">
              <button className="mini-btn" onClick={() => setGroupDialog(null)}>
                取消
              </button>
              <button className="mini-btn primary" onClick={() => void saveGroupDialog()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
