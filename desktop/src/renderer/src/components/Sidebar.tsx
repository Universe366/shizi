import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Captions,
  ListChecks,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles
} from 'lucide-react';
import type { BridgeStatus, JobRecord, Section, SidebarPage, TabInfo } from '../../../shared/types';
import { SidebarPagesDialog } from './SidebarPagesDialog';
import { PluginPanel } from './PluginPanel';
import type { PluginInfo, PluginPanelContribution } from '../../../shared/plugins';
import { pluginPanelSection } from '../../../shared/plugins';
import { SidebarPageIcon } from './SidebarPageIcon';
import { SidebarWebStage } from './SidebarWebStage';
import { SubtitlesPanel } from './SubtitlesPanel';
const ChatPanel = lazy(() =>
  import('./ChatPanel').then((module) => ({ default: module.ChatPanel }))
);
// 库与设置面板体积大、且只在首次切到对应 tab 时才需要，按需加载以缩短首屏。
const SummaryPanel = lazy(() =>
  import('./SummaryPanel').then((module) => ({ default: module.SummaryPanel }))
);
import { TaskCenter } from './TaskCenter';

type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

const items: Array<{ id: Section; label: string; icon: IconComponent; hint: string }> = [
  { id: 'subtitles', label: '字幕', icon: Captions, hint: '当前视频的字幕与翻译' },
  { id: 'summary', label: '总结', icon: Sparkles, hint: 'AI 总结、章节与问答' },
  { id: 'chat', label: '对话', icon: MessageSquare, hint: '基于字幕向 AI 提问' }
];

export function Sidebar({
  section,
  onSelect,
  onOpenSettings,
  activeTab,
  tabCount,
  fontScale = 1,
  sidebarWidth = 320,
  onWidthChange,
  onWidthCommit,
  collapsed = false,
  position = 'left',
  onDockChange,
  onToggleCollapse,
  onDragSnapshot,
  onOpenSummary,
  onOpenChapters,
  pages = [],
  pluginPanels = []
}: {
  onOpenSettings: () => void;
  section: Section;
  onSelect: (section: Section) => void;
  activeTab: TabInfo | null;
  tabCount: number;
  fontScale?: number;
  sidebarWidth?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
  collapsed?: boolean;
  position?: 'left' | 'right';
  onDockChange?: (position: 'left' | 'right') => void;
  onToggleCollapse?: (collapsed: boolean) => void;
  onDragSnapshot?: (snapshot: string | null) => void;
  onOpenSummary?: () => void;
  onOpenChapters?: () => void;
  pages?: SidebarPage[];
  /** 已启用插件声明的面板（按 manifest 顺序）。 */
  pluginPanels?: Array<{ plugin: PluginInfo; panel: PluginPanelContribution }>;
}) {
  const [version, setVersion] = useState('');
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dropPage, setDropPage] = useState<{ id: string; after: boolean } | null>(null);
  const [visited, setVisited] = useState<Set<Section>>(() => new Set([section]));
  const dragActiveRef = useRef(false);

  // 底部状态以前是写死的「插件未连接」；桥由设置控制，也可能中途重启，
  // 所以按真实状态展示，并定期刷新。
  useEffect(() => {
    let alive = true;
    const sync = () => {
      void window.bsub.getBridgeStatus().then((response) => {
        if (alive && response.ok) setBridge(response.data);
      });
    };
    sync();
    const timer = window.setInterval(sync, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.bsub.listJobs().then((response) => {
      if (alive && response.ok) setJobs(response.data);
    });
    const off = window.bsub.onJobsChanged((next) => setJobs(next));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(
    () => window.bsub.onTasksRequest(() => setTaskOpen(true)),
    []
  );

  useEffect(() => {
    const open = () => setTaskOpen(true);
    window.addEventListener('shizi:open-tasks', open);
    return () => window.removeEventListener('shizi:open-tasks', open);
  }, []);

  const activeJobCount = jobs.filter(
    (job) => job.status === 'running' || job.status === 'paused'
  ).length;

  const bridgeLabel = (() => {
    if (!bridge) return '桥状态未知';
    if (!bridge.enabled) return '本地桥已关闭';
    if (bridge.running) return `插件已连接 · ${bridge.port}`;
    return bridge.error ? '插件桥未启动' : '插件未连接';
  })();

  // 面板首次显示后保持挂载：切换导航只切显示，正在跑的任务/会话状态不会丢。
  useEffect(() => {
    setVisited((previous) =>
      previous.has(section) ? previous : new Set(previous).add(section)
    );
  }, [section]);

  const beginViewDrag = () => {
    dragActiveRef.current = true;
    void window.bsub.beginSidebarDrag().then((response) => {
      if (!dragActiveRef.current) return;
      if (response.ok && response.data) onDragSnapshot?.(response.data);
    });
    window.setTimeout(() => {
      if (dragActiveRef.current) endViewDrag();
    }, 12000);
  };

  const endViewDrag = () => {
    dragActiveRef.current = false;
    onDragSnapshot?.(null);
    void window.bsub.endSidebarDrag();
  };
  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setVersion(response.data.version);
    });
  }, []);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    beginViewDrag();
    let restored = false;
    const restoreView = () => {
      if (restored) return;
      restored = true;
      endViewDrag();
    };
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const startPosition = position;
    const crossedAt = (clientX: number) =>
      startPosition === 'left'
        ? clientX > window.innerWidth * 0.62
        : clientX < window.innerWidth * 0.38;
    const rawWidthAt = (clientX: number) => {
      const delta = startPosition === 'left' ? clientX - startX : startX - clientX;
      return startWidth + delta;
    };
    // 侧栏可以拖得很宽（网页模式下尤其需要），只给右侧网页区留最小可用宽度。
  const maxWidth = () => Math.max(320, Math.min(2000, window.innerWidth - 240));
    const move = (moveEvent: MouseEvent) => {
      const raw = rawWidthAt(moveEvent.clientX);
      const width = crossedAt(moveEvent.clientX)
        ? startWidth
        : Math.min(maxWidth(), Math.max(260, raw));
      onWidthChange?.(width);
    };
    const up = (upEvent: MouseEvent) => {
      const crossed = crossedAt(upEvent.clientX);
      const raw = rawWidthAt(upEvent.clientX);
      if (raw < 190) {
        onToggleCollapse?.(true);
      } else if (crossed) {
        onDockChange?.(startPosition === 'left' ? 'right' : 'left');
      } else {
        onWidthCommit?.(Math.min(maxWidth(), Math.max(260, raw)));
      }

      restoreView();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', restoreView);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', restoreView, { once: true });
  };

  const startDockDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    event.preventDefault();
    beginViewDrag();
    let restored = false;
    const restoreView = () => {
      if (restored) return;
      restored = true;
      endViewDrag();
    };
    const startX = event.clientX;
    let moved = false;
    const move = (moveEvent: MouseEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 4) moved = true;
    };
    const up = (upEvent: MouseEvent) => {
      if (moved) {
        const crossed =
          position === 'left'
            ? upEvent.clientX > window.innerWidth * 0.62
            : upEvent.clientX < window.innerWidth * 0.38;
        if (crossed) onDockChange?.(position === 'left' ? 'right' : 'left');
      }
      restoreView();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', restoreView);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', restoreView, { once: true });
  };

  const CollapseIcon = collapsed
    ? position === 'left'
      ? ChevronRight
      : ChevronLeft
    : position === 'left'
      ? ChevronLeft
      : ChevronRight;
  const webPage = section.startsWith('web:')
    ? pages.find((page) => `web:${page.id}` === section)
    : undefined;
  const layoutKey = `${sidebarWidth}-${position}-${fontScale}`;

  const movePage = (fromId: string, toId: string, after: boolean) => {
    const from = pages.findIndex((page) => page.id === fromId);
    const to = pages.findIndex((page) => page.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    const target = next.findIndex((page) => page.id === toId);
    if (target < 0) return;
    next.splice(target + (after ? 1 : 0), 0, moved);
    void window.bsub.saveSidebarPages(next);
  };

  return (
    <aside
      className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
      style={{ width: collapsed ? 56 : sidebarWidth }}
    >
      <div
        className="brand"
        onMouseDown={startDockDrag}
        title="按住标题栏拖动到另一侧"
      >
        <div className="brand-mark">字</div>
        <div className="brand-text">
          <div className="brand-name">拾字</div>
        </div>
        <button
          className="sidebar-collapse"
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapse?.(!collapsed)}
        >
          <CollapseIcon size={15} />
        </button>
      </div>

      <nav className="side-nav">
        {items.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            className={`side-nav-item${section === id ? ' is-active' : ''}`}
            title={hint}
            onClick={() => onSelect(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        {pluginPanels.map(({ plugin, panel }) => {
          const id = pluginPanelSection(plugin.id, panel.id) as Section;
          return (
            <button
              key={id}
              className={`side-nav-item${section === id ? ' is-active' : ''}`}
              title={`${plugin.name} · ${panel.title}（插件）`}
              onClick={() => onSelect(id)}
            >
              <span className="plugin-nav-icon">{panel.icon}</span>
              <span>{panel.title}</span>
            </button>
          );
        })}
      </nav>

      {(pages.length > 0 || !collapsed) && (
        <nav
          className={`side-nav side-nav-web${collapsed ? ' is-collapsed' : ''}`}
          onWheel={(event) => {
            if (collapsed) return;
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
              event.currentTarget.scrollLeft += event.deltaY;
            }
          }}
        >
          {pages.map((page) => {
            const id = `web:${page.id}` as Section;
            return (
              <button
                key={page.id}
                className={`side-nav-item${section === id ? ' is-active' : ''}${
                  dragPageId === page.id ? ' is-dragging' : ''
                }${
                  dropPage?.id === page.id
                    ? dropPage.after
                      ? ' is-drop-after'
                      : ' is-drop-before'
                    : ''
                }`}
                title={`${page.title}\n${page.url}\n点击打开；再次点击重新加载；拖动可排序`}
                aria-label={page.title}
                draggable={pages.length > 1}
                onDragStart={(event) => {
                  setDragPageId(page.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', page.id);
                  event.dataTransfer.setData('application/x-shizi-sidebar-page', page.id);
                }}
                onDragOver={(event) => {
                  if (!dragPageId || dragPageId === page.id) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = collapsed
                    ? event.clientY > rect.top + rect.height / 2
                    : event.clientX > rect.left + rect.width / 2;
                  setDropPage({ id: page.id, after });
                }}
                onDragLeave={() => {
                  setDropPage((current) => (current?.id === page.id ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const from =
                    dragPageId || event.dataTransfer.getData('application/x-shizi-sidebar-page');
                  const after = dropPage?.id === page.id ? dropPage.after : true;
                  setDropPage(null);
                  setDragPageId(null);
                  if (from) movePage(from, page.id, after);
                }}
                onDragEnd={() => {
                  setDragPageId(null);
                  setDropPage(null);
                }}
                onClick={() => {
                  if (section === id && !collapsed) {
                    window.bsub.sidebarWebReload();
                    return;
                  }
                  if (collapsed) onToggleCollapse?.(false);
                  onSelect(id);
                }}
              >
                <SidebarPageIcon page={page} />
              </button>
            );
          })}
          <button
            className="side-nav-item side-nav-add"
            title="添加侧栏网页"
            aria-label="添加侧栏网页"
            onClick={() => setPagesOpen(true)}
          >
            <Plus size={14} />
          </button>
        </nav>
      )}

      {!collapsed && (
        <div
          className="sidebar-resizer"
          onMouseDown={startResize}
          onDoubleClick={() => onToggleCollapse?.(true)}
          title="拖动调宽；拖得很窄会折叠；双击折叠；拖标题栏换边"
        />
      )}
      <div className="side-content" style={{ zoom: fontScale }}>
        <div className={`side-panel${section === 'subtitles' ? ' is-active' : ''}`}>
          {visited.has('subtitles') && (
            <SubtitlesPanel
              activeTab={activeTab}
              active={section === 'subtitles' && !collapsed}
              onOpenSummary={onOpenSummary}
              onOpenChapters={onOpenChapters}
            />
          )}
        </div>

        <div className={`side-panel${section === 'chat' ? ' is-active' : ''}`}>
          {visited.has('chat') && (
            <Suspense fallback={null}>
              <ChatPanel activeTab={activeTab} onOpenSettings={onOpenSettings} />
            </Suspense>
          )}
        </div>

        <div className={`side-panel${section === 'summary' ? ' is-active' : ''}`}>
          {visited.has('summary') && (
            <Suspense fallback={null}>
              <SummaryPanel activeTab={activeTab} onOpenSettings={onOpenSettings} />
            </Suspense>
          )}
        </div>

        {pluginPanels.map(({ plugin, panel }) => {
          const id = pluginPanelSection(plugin.id, panel.id) as Section;
          return (
            <div key={id} className={`side-panel${section === id ? ' is-active' : ''}`}>
              {visited.has(id) && <PluginPanel plugin={plugin} panel={panel} />}
            </div>
          );
        })}

        {!collapsed && webPage && (
          <div className="side-panel is-active">
            <SidebarWebStage page={webPage} layoutKey={layoutKey} side={position} />
          </div>
        )}

      </div>

      <div className="side-footer" title={bridge?.error || bridgeLabel}>
        <span className={`dot${bridge?.running ? ' is-on' : ''}`} />
        <span>{bridgeLabel}</span>
        {tabCount > 0 && <span>· {tabCount} 标签</span>}
        <button
          className={`task-toggle${activeJobCount ? ' is-active' : ''}`}
          title={activeJobCount ? `${activeJobCount} 个任务进行中` : '任务与导出'}
          onClick={() => setTaskOpen((value) => !value)}
        >
          <ListChecks size={12} />
          <span className="task-label">{activeJobCount ? `任务 ${activeJobCount}` : '任务'}</span>
        </button>
        <span className="side-version">{version ? `v${version}` : ''}</span>
      </div>

      {!collapsed && (
        <TaskCenter open={taskOpen} jobs={jobs} onClose={() => setTaskOpen(false)} />
      )}

      <SidebarPagesDialog open={pagesOpen} pages={pages} onClose={() => setPagesOpen(false)} />
    </aside>
  );
}
