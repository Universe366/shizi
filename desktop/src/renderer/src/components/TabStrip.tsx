import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { TabGroup, TabInfo } from '../../../shared/types';
import { canonicalUrl } from '../../../shared/url';

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
  onNewTab,
  onPeekChange,
  onActivate
}: {
  tabs: TabInfo[];
  vertical?: boolean;
  onSearch?: () => void;
  onNewTab?: () => void;
  onPeekChange?: (peek: boolean, width: number) => void;
  onActivate?: (id: string) => void;
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
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [peekOpen, setPeekOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: TabGroup } | null>(null);
  const pendingPane = useRef<{ width?: number; collapsed?: boolean }>({});
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
  const previewSeq = useRef(0);
  const peekTimer = useRef<number | null>(null);
  const peekSuppressed = useRef(false);
  const lastPeekReport = useRef<{ open: boolean; width: number }>({ open: false, width: 0 });
  const lastActiveId = useRef<string | null>(null);
  const lastGroupKey = useRef('');
  const groupMenuRef = useRef<HTMLDivElement>(null);
  /** 原生 mouse 事件走 ref，避免折叠过程中 React 的 enter/leave 状态过期。 */
  const peekApi = useRef<{ open: () => void; close: () => void }>({
    open: () => undefined,
    close: () => undefined
  });
  const previewCache = useRef<Map<string, { at: number; dataUrl: string; title: string; url: string }>>(
    new Map()
  );
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const clearPreview = () => {
    previewSeq.current += 1;
    if (previewTimer.current) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setPreview(null);
  };

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
  // 横向模式下总是展开；折叠状态只对垂直标签栏生效。
  const expanded = !vertical || !collapsed || peekOpen;
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const pinnedTabs = visibleTabs.filter((tab) => tab.pinned);
  const normalTabs = visibleTabs.filter((tab) => !tab.pinned);
  // 分组数据还没到时，先把带 groupId 的标签当普通标签显示，避免闪一下消失。
  const ungroupedTabs = normalTabs.filter(
    (tab) => !tab.groupId || !knownGroupIds.has(tab.groupId)
  );
  // 键盘导航 / “关闭右侧”按界面上真正的显示顺序走：固定区 → 普通区 → 各分组。
  const visualTabs: TabInfo[] = [...pinnedTabs, ...ungroupedTabs];
  const groupTabs = new Map<string, TabInfo[]>();
  for (const group of groups) {
    const items = normalTabs.filter((tab) => tab.groupId === group.id);
    groupTabs.set(group.id, items);
    if (!group.collapsed || Boolean(query)) visualTabs.push(...items);
  }

  useLayoutEffect(() => {
    // 只上报“展开/收起/展开宽度”的变化；拖宽度时不要每帧都让 App 重渲染。
    // 用 layout effect：在浏览器绘制前就让地址栏/网页一起让位，避免一帧错位。
    const open = Boolean(vertical && collapsed && peekOpen);
    const last = lastPeekReport.current;
    if (open === last.open && (!open || width === last.width)) return;
    lastPeekReport.current = { open, width };
    onPeekChange?.(open, width);
  }, [vertical, collapsed, peekOpen, width, onPeekChange]);

  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useLayoutEffect(() => {
    return () => {
      if (lastPeekReport.current.open) onPeekChange?.(false, widthRef.current);
    };
  }, [onPeekChange]);

  // 折叠 / 横向模式下收起预览和搜索，避免隐藏状态残留。
  useEffect(() => {
    if (!expanded) {
      clearPreview();
      setSearchOpen(false);
      setFilter('');
      setActionsOpen(false);
    }
    if (!vertical) {
      setPeekOpen(false);
    }
    if (!collapsed) {
      // 展开后清掉悬停态；否则下次点折叠会直接以“悬停展开”的样子弹出。
      setPeekOpen(false);
      peekSuppressed.current = false;
    }
  }, [expanded, vertical, collapsed]);

  // 只在“当前标签变了”时滚动，页面标题/声音更新不再把列表拽回去。
  useEffect(() => {
    const activeId = tabs.find((tab) => tab.active)?.id ?? null;
    if (!activeId) return;
    const groupKey = groups.map((group) => `${group.id}:${group.collapsed}`).join('|');
    if (activeId === lastActiveId.current && groupKey === lastGroupKey.current) return;
    lastActiveId.current = activeId;
    lastGroupKey.current = groupKey;
    listRef.current?.querySelector('.tab.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [tabs, groups]);

  // 标签被外部关掉后，清掉已经不存在的多选项 / 预览缓存。
  useEffect(() => {
    const ids = new Set(tabs.map((tab) => tab.id));
    setSelected((current) => {
      const next = current.filter((id) => ids.has(id));
      return next.length === current.length ? current : next;
    });
    setAnchorId((current) => (current && ids.has(current) ? current : null));
    for (const key of previewCache.current.keys()) {
      if (!ids.has(key)) previewCache.current.delete(key);
    }
    while (previewCache.current.size > 40) {
      const oldest = previewCache.current.keys().next().value;
      if (!oldest) break;
      previewCache.current.delete(oldest);
    }
  }, [tabs]);

  // 预览对应的标签被关掉 / 被搜索过滤掉时，收起预览。
  useEffect(() => {
    if (!preview) return;
    if (!tabs.some((tab) => tab.id === preview.tabId)) clearPreview();
  }, [tabs, preview]);

  useEffect(() => {
    clearPreview();
  }, [filter]);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu]);

  useLayoutEffect(() => {
    if (!groupMenu || !groupMenuRef.current) return;
    const rect = groupMenuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(groupMenu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(groupMenu.y, window.innerHeight - rect.height - 8));
    if (x !== groupMenu.x || y !== groupMenu.y) setGroupMenu({ ...groupMenu, x, y });
  }, [groupMenu]);

  useEffect(() => {
    localStorage.setItem('tabs.collapsed', collapsed ? '1' : '0');
    persistPane({ collapsed });
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem('tabs.width', String(width));
    persistPane({ width });
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGroupMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
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

  const persistPane = (patch: { width?: number; collapsed?: boolean }) => {
    pendingPane.current = { ...pendingPane.current, ...patch };
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      const pending = pendingPane.current;
      pendingPane.current = {};
      // 专用通道：拖宽度/折叠时不重启插件桥，也不覆盖设置页的其他改动。
      void window.bsub?.setTabsLayout?.(pending);
    }, 350);
  };

  const activate = (id: string, fromClick = false) => {
    setSelected([]);
    setAnchorId(id);
    clearPreview();
    void window.bsub.activateTab(id);
    onActivate?.(id);
    // 点击折叠态里的标签后收起飞出层，避免它一直悬在网页上。
    if (fromClick && vertical && collapsed) {
      peekSuppressed.current = true;
      setPeekOpen(false);
    }
    // 让方向键/Delete 在点过标签后立即可用；鼠标聚焦不会出现 focus 轮廓。
    listRef.current?.focus({ preventScroll: true });
  };

  const clickTab = (event: React.MouseEvent, tab: TabInfo) => {
    listRef.current?.focus({ preventScroll: true });
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) =>
        current.includes(tab.id) ? current.filter((id) => id !== tab.id) : [...current, tab.id]
      );
      setAnchorId(tab.id);
      return;
    }
    if (event.shiftKey && anchorId) {
      const from = visualTabs.findIndex((item) => item.id === anchorId);
      const to = visualTabs.findIndex((item) => item.id === tab.id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected(visualTabs.slice(start, end + 1).map((item) => item.id));
        return;
      }
    }
    activate(tab.id, true);
  };

  const visualNeighbor = (id: string): string | undefined => {
    const index = visualTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return undefined;
    return visualTabs[index + 1]?.id ?? visualTabs[index - 1]?.id;
  };

  /** 关闭单个标签时把“视觉上的下一个”告诉主进程，避免跳到固定区/分组里的标签。 */
  const closeOne = (id: string) => {
    const next = visualNeighbor(id);
    if (next) void window.bsub.closeTab(id, next);
    else void window.bsub.closeTab(id);
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
    const index = visualTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    for (const tab of visualTabs.slice(index + 1)) void window.bsub.closeTab(tab.id);
  };

  const closeToLeft = (id: string) => {
    const index = visualTabs.findIndex((tab) => tab.id === id);
    if (index <= 0) return;
    for (const tab of visualTabs.slice(0, index)) void window.bsub.closeTab(tab.id);
  };

  const duplicateIds = () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const tab of tabs) {
      if (seen.has(tab.url)) duplicates.push(tab.id);
      else seen.add(tab.url);
    }
    return duplicates;
  };

  const dropIndex = (ids: string[], targetId: string, after: boolean): number => {
    const moving = new Set(ids);
    const rest = tabs.filter((tab) => !moving.has(tab.id));
    const target = rest.findIndex((tab) => tab.id === targetId);
    if (target < 0) return rest.length;
    return target + (after ? 1 : 0);
  };

  const readDragIds = (event: React.DragEvent): string[] => {
    if (draggingIds.length) return draggingIds;
    if (draggingId) return [draggingId];
    try {
      const raw = event.dataTransfer?.getData('application/x-shizi-tabs');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  const onDragOverTab = (event: React.DragEvent, tab: TabInfo) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = rect.height === 0 ? true : event.clientY > rect.top + rect.height / 2;
    setDropTarget({ id: tab.id, after });
    clearPreview();
    const list = listRef.current;
    if (list) {
      const box = list.getBoundingClientRect();
      if (event.clientY < box.top + 28) list.scrollTop -= 12;
      else if (event.clientY > box.bottom - 28) list.scrollTop += 12;
    }
  };

  const finishDrop = (tab: TabInfo) => {
    const ids = draggingIds.length ? draggingIds : draggingId ? [draggingId] : [];
    const after = dropTarget?.id === tab.id ? dropTarget.after : true;
    setDropTarget(null);
    setDraggingId(null);
    setDraggingIds([]);
    if (!ids.length || ids.includes(tab.id)) return;
    const dragged = tabs.find((item) => item.id === ids[0]);
    if (!dragged) return;
    if (ids.some((id) => Boolean(tabs.find((item) => item.id === id)?.pinned) !== Boolean(tab.pinned))) {
      return;
    }
    const index = dropIndex(ids, tab.id, after);
    if (ids.length > 1) window.bsub.moveTabs?.(ids, index);
    else window.bsub.moveTab(ids[0], index);
    if ((dragged.groupId || null) !== (tab.groupId || null)) {
      for (const id of ids) void window.bsub.assignTabGroup?.(id, tab.groupId || null);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const activeIndex = visualTabs.findIndex((tab) => tab.active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visualTabs.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + delta + visualTabs.length) % visualTabs.length;
      activate(visualTabs[next].id);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? visualTabs[0] : visualTabs[visualTabs.length - 1];
      if (target) activate(target.id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      const ids = selected.length
        ? selected
        : activeIndex >= 0
          ? [visualTabs[activeIndex].id]
          : [];
      closeTabs(ids);
    } else if (event.key === 'Escape') {
      setSelected([]);
      clearPreview();
    }
  };

  const batchIds = (tab: TabInfo) => (selected.includes(tab.id) ? selected : [tab.id]);

  const showPreview = (tab: TabInfo, element: HTMLElement) => {
    if (!vertical || !expanded || draggingIds.length) return;
    clearPreview();
    const seq = previewSeq.current;
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        if (seq !== previewSeq.current || !element.isConnected) return;
        const cached = previewCache.current.get(tab.id);
        let data =
          cached && Date.now() - cached.at < 15000 && cached.url === tab.url ? cached : null;
        if (!data) {
          const result = await window.bsub.tabPreview?.(tab.id);
          if (seq !== previewSeq.current || !element.isConnected || !result) return;
          data = { at: Date.now(), ...result };
          previewCache.current.set(tab.id, data);
        }
        const strip = stripRef.current?.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (!strip) return;
        const previewHeight = Math.max(120, (strip.width - 16) * (10 / 16) + 52);
        let top = box.top - strip.top - previewHeight - 6;
        if (top < 6) top = box.bottom - strip.top + 6;
        top = Math.max(6, Math.min(top, strip.height - previewHeight - 8));
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
        }${draggingIds.includes(tab.id) ? ' is-dragging' : ''}${
          drop ? (dropTarget.after ? ' is-drop-after' : ' is-drop-before') : ''
        }`}
        title={`${tab.title || '新标签页'}${tab.suspended ? '（已休眠，点击恢复）' : ''}`}
        draggable={vertical ? !collapsed || peekOpen : true}
        onDragStart={(event) => {
          const ids = selected.includes(tab.id) ? selected : [tab.id];
          setDraggingId(tab.id);
          setDraggingIds(ids);
          clearPreview();
          event.dataTransfer?.setData('text/plain', tab.id);
          event.dataTransfer?.setData('application/x-shizi-tabs', JSON.stringify(ids));
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDraggingIds([]);
          setDropTarget(null);
        }}
        onDragOver={(event) => onDragOverTab(event, tab)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          finishDrop(tab);
        }}
        onMouseEnter={(event) => showPreview(tab, event.currentTarget)}
        onMouseLeave={clearPreview}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            closeOne(tab.id);
          }
        }}
        onClick={(event) => clickTab(event, tab)}
        onContextMenu={(event) => {
          event.preventDefault();
          clearPreview();
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
              onLoad={(event) => {
                event.currentTarget.style.visibility = 'visible';
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
        {tab.muted && <span className="tab-muted-dot" aria-hidden="true" />}
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
            closeOne(tab.id);
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setFilter('');
    } else {
      setSearchOpen(true);
    }
  };

  const openPeekSoon = () => {
    if (!vertical || !collapsed || peekOpen || peekSuppressed.current || peekTimer.current) return;
    // 悬停意图：停留 ~140ms 才展开，避免鼠标路过左侧时整页跟着跳。
    peekTimer.current = window.setTimeout(() => {
      peekTimer.current = null;
      setPeekOpen(true);
    }, 140);
  };

  const closePeek = () => {
    peekSuppressed.current = false;
    if (peekTimer.current) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeekOpen(false);
    clearPreview();
  };

  useEffect(() => {
    peekApi.current = { open: openPeekSoon, close: closePeek };
  });

  useEffect(() => {
    return () => {
      if (peekTimer.current) window.clearTimeout(peekTimer.current);
    };
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onMove = () => peekApi.current.open();
    const onLeave = () => peekApi.current.close();
    strip.addEventListener('mousemove', onMove, { passive: true });
    strip.addEventListener('mouseleave', onLeave);
    return () => {
      strip.removeEventListener('mousemove', onMove);
      strip.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={stripRef}
      className={`tab-strip${vertical ? ' is-vertical' : ''}${
        vertical && collapsed ? ' is-collapsed' : ''
      }${vertical && collapsed && peekOpen ? ' is-peeking' : ''}${
        vertical && width < 190 ? ' is-narrow' : ''
      }`}
      style={vertical ? { width: collapsed && !peekOpen ? 52 : width } : undefined}
      onMouseEnter={() => {
        if (vertical && collapsed) openPeekSoon();
      }}
      onMouseMove={() => {
        if (vertical && collapsed) openPeekSoon();
      }}
      onMouseLeave={closePeek}
    >
      {vertical && (
        <div
          className="tab-vertical-head"
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget) setCollapsed((value) => !value);
          }}
          title="双击折叠/展开"
        >
          <button
            className="tab-collapse"
            title={collapsed ? '展开标签栏' : '折叠标签栏'}
            aria-label={collapsed ? '展开标签栏' : '折叠标签栏'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
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
                onClick={toggleSearch}
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
                    {duplicateIds().length > 0 && (
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          closeTabs(duplicateIds());
                        }}
                      >
                        关闭重复标签（{duplicateIds().length}）
                      </button>
                    )}
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
      {vertical && !expanded && (
        <button
          className="tab-collapsed-new"
          title="新建标签页（Ctrl+T）"
          aria-label="新建标签页"
          onClick={() => (onNewTab ? onNewTab() : void window.bsub.newTab())}
        >
          <Plus size={15} />
        </button>
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
                event.stopPropagation();
                toggleSearch();
              } else if (event.key === 'Enter') {
                const first = visualTabs[0];
                if (!first) return;
                event.preventDefault();
                toggleSearch();
                activate(first.id, true);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                listRef.current?.focus();
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
            event.preventDefault();
            clearPreview();
            dragRef.current = { startX: event.clientX, startWidth: width };
            document.body.classList.add('is-resizing-tabs');
            const move = (moveEvent: MouseEvent) => {
              const state = dragRef.current;
              if (!state) return;
              setWidth(
                Math.min(360, Math.max(160, state.startWidth + moveEvent.clientX - state.startX))
              );
            };
            const up = () => {
              dragRef.current = null;
              document.body.classList.remove('is-resizing-tabs');
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
              window.removeEventListener('blur', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            window.addEventListener('blur', up);
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
        onScroll={clearPreview}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) onNewTab?.();
        }}
        onDragOver={(event) => {
          if (!draggingId || event.target !== event.currentTarget) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!draggingId || event.target !== event.currentTarget) return;
          event.preventDefault();
          const ids = readDragIds(event);
          const dragged = tabs.find((tab) => tab.id === ids[0]);
          setDraggingId(null);
          setDraggingIds([]);
          setDropTarget(null);
          if (!ids.length || !dragged || dragged.pinned) return;
          // 拖到列表空白处 = 移出分组并放到普通标签末尾。
          const rest = tabs.filter((tab) => !ids.includes(tab.id));
          for (const id of ids) void window.bsub.assignTabGroup?.(id, null);
          if (ids.length > 1) window.bsub.moveTabs?.(ids, rest.length);
          else window.bsub.moveTab(ids[0], rest.length);
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
          const items = groupTabs.get(group.id) || [];
          if (!items.length) return null;
          const showItems = !group.collapsed || Boolean(query);
          return (
            <div className={`tab-group is-${group.color}`} key={group.id}>
              <div
                className={`tab-group-head${
                  group.collapsed && items.some((item) => item.active) ? ' is-active' : ''
                }`}
                title={`${group.name}（${items.length}）`}
                onClick={() => {
                  clearPreview();
                  void window.bsub.toggleTabGroupCollapsed?.(group.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  clearPreview();
                  setGroupMenu({ x: event.clientX, y: event.clientY, group });
                }}
                onDragOver={(event) => {
                  if (!draggingId) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const ids = readDragIds(event);
                  const dragged = tabs.find((tab) => tab.id === ids[0]);
                  setDraggingId(null);
                  setDraggingIds([]);
                  setDropTarget(null);
                  if (!ids.length || !dragged || dragged.pinned) return;
                  const rest = tabs.filter((tab) => !ids.includes(tab.id));
                  for (const id of ids) void window.bsub.assignTabGroup?.(id, group.id);
                  if (ids.length > 1) window.bsub.moveTabs?.(ids, rest.length);
                  else window.bsub.moveTab(ids[0], rest.length);
                }}
              >
                {group.collapsed && !query ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="tab-group-dot" />
                <span className="tab-group-name">{group.name}</span>
                <span className="tab-group-count">{items.length}</span>
              </div>
              {showItems && items.map(renderTab)}
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
                if (ids.length === 1) closeOne(ids[0]);
                else closeTabs(ids);
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
                    void window.bsub.duplicateTab?.(menu.tab.id);
                    setMenu(null);
                  }}
                >
                  复制标签页
                </button>
                <button
                  className="tab-menu-item"
                  onClick={() => {
                    void window.bsub.reloadTab?.(menu.tab.id);
                    setMenu(null);
                  }}
                >
                  重新加载
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
                closeToLeft(menu.tab.id);
                setMenu(null);
              }}
            >
              关闭左侧
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                void window.bsub.writeClipboard(canonicalUrl(menu.tab.url));
                setMenu(null);
              }}
            >
              复制链接
            </button>
            <button
              className="tab-menu-item"
              onClick={() => {
                void window.bsub.writeClipboard(menu.tab.title || '');
                setMenu(null);
              }}
            >
              复制标题
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
          ref={groupMenuRef}
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
