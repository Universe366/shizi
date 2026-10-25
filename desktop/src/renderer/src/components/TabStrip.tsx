import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, MoreHorizontal, Moon, Plus, Search, X } from 'lucide-react';
import type { TabInfo } from '../../../shared/types';
import { moveIndexFor } from '../lib/tabs';

interface TabMenuState {
  x: number;
  y: number;
  tab: TabInfo;
}

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
  const actionsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tabs.collapsed') === '1');
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('tabs.width'));
    return Number.isFinite(saved) && saved >= 160 ? Math.min(360, saved) : 220;
  });
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const visibleTabs = filter.trim()
    ? tabs.filter((tab) =>
        `${tab.title} ${tab.url}`.toLowerCase().includes(filter.trim().toLowerCase())
      )
    : tabs;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('tabs.collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (!searchOpen) return;
    filterRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    listRef.current?.querySelector('.tab.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem('tabs.width', String(width));
  }, [width]);

  useEffect(() => {
    if (!actionsOpen) return;
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

  const closeOthers = (keepId: string) => {
    for (const tab of tabs) {
      if (tab.id !== keepId) void window.bsub.closeTab(tab.id);
    }
  };

  const closeToRight = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    for (const tab of tabs.slice(index + 1)) void window.bsub.closeTab(tab.id);
  };

  return (
    <div
      className={`tab-strip${vertical ? ' is-vertical' : ''}${collapsed ? ' is-collapsed' : ''}`}
      style={vertical ? { width: collapsed ? 52 : width } : undefined}
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
          {!collapsed && (
            <span className="tab-vertical-title">
              标签<span className="tab-count">{tabs.length}</span>
            </span>
          )}
          {!collapsed && (
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
                        void window.bsub.reopenClosedTab();
                      }}
                    >
                      重新打开关闭的标签
                    </button>
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        setSearchOpen(true);
                      }}
                    >
                      搜索标签
                    </button>
                    <div className="tab-menu-sep" />
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
                        for (const tab of tabs) void window.bsub.closeTab(tab.id);
                      }}
                    >
                      关闭全部标签
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {vertical && !collapsed && searchOpen && (
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
      {vertical && !collapsed && (
        <div
          className="tab-resize"
          title="拖动调整宽度"
          onMouseDown={(event) => {
            dragRef.current = { startX: event.clientX, startWidth: width };
            const move = (moveEvent: MouseEvent) => {
              const state = dragRef.current;
              if (!state) return;
              setWidth(Math.min(360, Math.max(160, state.startWidth + moveEvent.clientX - state.startX)));
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
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) onNewTab?.();
        }}
      >
        {visibleTabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.active ? ' is-active' : ''}${tab.suspended ? ' is-suspended' : ''}`}
            title={`${tab.title}${tab.suspended ? '（已休眠，点击恢复）' : ''}`}
            draggable
            onDragStart={() => setDraggingId(tab.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingId && draggingId !== tab.id) {
                void window.bsub.moveTab(draggingId, moveIndexFor(tabs, draggingId, tab.id));
              }
              setDraggingId(null);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void window.bsub.closeTab(tab.id);
              }
            }}
            onClick={() => void window.bsub.activateTab(tab.id)}
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
            {!collapsed && <span className="tab-title">{tab.title || '新标签页'}</span>}
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
        ))}
      </div>
      {!vertical && (
        <>
          <button
            className="tab-search"
            title="全局搜索（Ctrl+K）"
            onClick={() => onSearch?.()}
          >
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

      {menu && (
        <div
          ref={menuRef}
          className="tab-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            className="tab-menu-item"
            onClick={() => {
              void window.bsub.closeTab(menu.tab.id);
              setMenu(null);
            }}
          >
            关闭
          </button>
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
      )}
    </div>
  );
}
