import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  BrowserToolbarSettings,
  PanelLayout,
  Section,
  SettingsSnapshot,
  SidebarPage,
  TabInfo
} from '../../shared/types';
import { BUILTIN_PANELS, normalizePanelLayout, orderPanelKeys } from '../../shared/panels';
import { DEFAULT_BROWSER_TOOLBAR, normalizeBrowserToolbar } from '../../shared/browserToolbar';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { BrowserStage } from './components/BrowserStage';
import { SpeechBar } from './components/SpeechBar';
import { FirstRunWizard } from './components/FirstRunWizard';
import { GlobalSearch } from './components/GlobalSearch';
import { BrowserHub, type HubSection } from './components/BrowserHub';
import { BookmarkDialog } from './components/BookmarkDialog';
import { BookmarkBar } from './components/BookmarkBar';
import { ClearBrowsingDataDialog } from './components/ClearBrowsingDataDialog';
import { ReaderMode } from './components/ReaderMode';
import { StartPageClean } from './components/StartPageClean';
import { RadialMenu } from './components/RadialMenu';
import type { WheelActionId } from '../../shared/types';
import { lazy, Suspense } from 'react';
import { requestSummaryPanel } from './lib/summaryRequest';
import { speakText } from './lib/speech';

const SettingsPage = lazy(() =>
  import('./SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const LibraryPage = lazy(() =>
  import('./components/LibraryPage').then((module) => ({ default: module.LibraryPage }))
);
import { nextTabId, tabIdByNumber } from './lib/tabs';

import { useBrowserOverlayAuto } from './lib/browserOverlay';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import type { PluginInfo } from '../../shared/plugins';
import { pluginEntryUrl, pluginPanelSection } from '../../shared/plugins';
import { CloseDialog } from './components/CloseDialog';
import { ConfirmHost } from './components/ui/confirm';
import { DictationListener } from './components/DictationListener';
import { applyAppearance } from './lib/appearance';
import { actionForStroke, effectiveShortcuts, type ShortcutActionId } from '../../shared/shortcuts';
import { strokeFromEvent } from '../../shared/shortcutKeys';

export default function App() {
  const initialSection = new URLSearchParams(window.location.search).get('section');
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [section, setSection] = useState<Section>(() => {
    return initialSection === 'chat' || initialSection === 'summary' || initialSection === 'subtitles'
      ? initialSection
      : 'subtitles';
  });
  const [addressFocus, setAddressFocus] = useState(0);
  const [fontScale, setFontScale] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPages, setSidebarPages] = useState<SidebarPage[]>([]);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({ order: [], hidden: [] });
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [appDark, setAppDark] = useState(
    () => Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches)
  );
  const [maximized, setMaximized] = useState(false);
  const [zoomValue, setZoomValue] = useState(1);
  const [zoomPulse, setZoomPulse] = useState(0);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [verticalTabs, setVerticalTabs] = useState(true);
  const [browserToolbar, setBrowserToolbar] = useState<BrowserToolbarSettings>(DEFAULT_BROWSER_TOOLBAR);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [dragSnapshot, setDragSnapshot] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [wizard, setWizard] = useState<SettingsSnapshot | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hub, setHub] = useState<HubSection | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [siteDarkDisabled, setSiteDarkDisabled] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(initialSection === 'library');
  const [closeOpen, setCloseOpen] = useState(false);
  // 垂直标签栏折叠后悬停展开时，地址栏和网页一起让位，避免标签栏盖住前进/后退按钮。
  const [tabPeek, setTabPeek] = useState<{ open: boolean; width: number }>({
    open: false,
    width: 220
  });
  const handlePeekChange = useCallback((peek: boolean, width: number) => {
    setTabPeek({ open: peek, width });
  }, []);

  // 垂直标签栏折叠/探出会改变网页可用区域；原生视图偶发停在旧坐标，
  // 这里在布局变化后主动重报一次，避免页面被推到窗口外。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('bsub:layout-refresh'));
      window.bsub.refreshView();
    });
    return () => cancelAnimationFrame(frame);
  }, [tabPeek.open, tabPeek.width, verticalTabs, tabs.length]);

  // 折叠标签栏悬停展开时通过主区 padding 让位，不再隐藏网页，
  // 否则展开期间会看到整片空白。
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkTarget, setBookmarkTarget] = useState<{ url: string; title: string } | null>(null);
  const [bookmarkBar, setBookmarkBar] = useState(true);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  // 供全局键盘/主进程转发调用：避免把 handleSectionSelect 的依赖塞进每个 effect。
  const sectionHandlerRef = useRef<(next: Section) => void>(() => undefined);
  // 插件列表是侧栏、命令面板和后续拆窗共用的数据源；安装/启停后由主进程广播刷新。
  useEffect(() => {
    let alive = true;
    const loadPlugins = () => {
      void window.bsub.listPlugins().then((response) => {
        if (alive && response.ok) setPlugins(response.data.plugins);
      });
    };
    loadPlugins();
    const off = window.bsub.onPluginsChanged(loadPlugins);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const pluginPanels = useMemo(
    () =>
      plugins
        .filter((plugin) => plugin.enabled && !plugin.error)
        .flatMap((plugin) => plugin.panels.map((panel) => ({ plugin, panel }))),
    [plugins]
  );

  const panelKeys = useMemo(
    () => [
      ...BUILTIN_PANELS.map((panel) => panel.id as string),
      ...pluginPanels.map(({ plugin, panel }) => pluginPanelSection(plugin.id, panel.id))
    ],
    [pluginPanels]
  );
  const visiblePanelKeys = useMemo(
    () => orderPanelKeys(panelKeys, panelLayout),
    [panelKeys, panelLayout]
  );

  // 当前面板被隐藏时自动切到第一个可见面板，避免只剩空白侧栏。
  useEffect(() => {
    const tracked = section.startsWith('plugin:') || BUILTIN_PANELS.some((item) => item.id === section);
    if (!tracked || !visiblePanelKeys.length) return;
    if (!visiblePanelKeys.includes(section)) setSection(visiblePanelKeys[0] as Section);
  }, [section, visiblePanelKeys]);

  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string>>({});
  const [radialOpen, setRadialOpen] = useState(false);
  const [radialSectors, setRadialSectors] = useState<WheelActionId[]>([
    'summary',
    'chat',
    'newChat',
    'library',
    'settings',
    'start',
    'find',
    'reader'
  ]);
  const shortcutMap = useMemo(() => effectiveShortcuts(shortcutOverrides), [shortcutOverrides]);
  const runShortcutRef = useRef<(action: ShortcutActionId) => void>(() => undefined);

  // 网页视图的显隐统一由 useBrowserOverlayAuto 按「DOM 里有没有浮层」决定，
  // 不再在这里再用 pageOpen 写一遍：两个来源各说各的时，后到的调用会把
  // 另一个的隐藏覆盖掉（例如关闭框刚弹出又被显示回来的网页盖住）。
  useEffect(() => window.bsub.onCloseRequest(() => setCloseOpen(true)), []);

  // 以窗口真实状态为准，避免设置文件和实际窗口不一致时按钮显示错误。
  useEffect(() => {
    let alive = true;
    void window.bsub.getAlwaysOnTop().then((result) => {
      if (alive && result.ok) setAlwaysOnTop(result.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleAlwaysOnTop = () => {
    void window.bsub.setAlwaysOnTop(!alwaysOnTop).then((result) => {
      if (result.ok) setAlwaysOnTop(result.data);
    });
  };

  const toggleAppDark = () => {
    void persistGeneral({ theme: appDark ? 'light' : 'dark' });
  };

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const sync = () => setAppDark(media.matches);
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    void window.bsub.isWindowMaximized().then((result) => {
      if (result.ok) setMaximized(result.data);
    });
    return window.bsub.onWindowMaximized(setMaximized);
  }, []);

  useEffect(() => window.bsub.onCloseCancel(() => setCloseOpen(false)), []);

  useBrowserOverlayAuto();

  useEffect(() => {
    return window.bsub.onChatHandoff?.((payload) => {
      try {
        localStorage.setItem('chat-handoff', JSON.stringify(payload));
      } catch {
        // ignore
      }
      setSection('chat');
    });
  }, []);

  const applyLayout = (snapshot: {
    settings: {
      general: {
        sidebarWidth: number;
        sidebarPosition: 'left' | 'right';
        sidebarCollapsed: boolean;
        sidebarPages?: SidebarPage[];
        panelLayout?: PanelLayout;
        alwaysOnTop?: boolean;
        verticalTabs?: boolean;
        assistantEnabled?: boolean;
        petEnabled?: boolean;
        siteDarkDisabled?: string[];
      };
    };
  }) => {
    setSidebarWidth(snapshot.settings.general.sidebarWidth);
    setSidebarPosition(snapshot.settings.general.sidebarPosition);
    setSidebarCollapsed(snapshot.settings.general.sidebarCollapsed);
    setSidebarPages(snapshot.settings.general.sidebarPages || []);
    setPanelLayout(normalizePanelLayout(snapshot.settings.general.panelLayout));
    setAlwaysOnTop(snapshot.settings.general.alwaysOnTop === true);
    setVerticalTabs(snapshot.settings.general.verticalTabs === true);
    setBrowserToolbar(
      normalizeBrowserToolbar(
        (snapshot.settings.general as { browserToolbar?: unknown }).browserToolbar
      )
    );
    setAssistantEnabled(snapshot.settings.general.assistantEnabled === true);
    setSiteDarkDisabled(snapshot.settings.general.siteDarkDisabled || []);
  };

  useEffect(() => {
    const apply = (state: string) =>
      setHasUpdate(['available', 'downloading', 'downloaded'].includes(state));
    void window.bsub.getUpdateStatus().then((response) => {
      if (response.ok) apply(response.data.state);
    });
    return window.bsub.onUpdateStatus((status) => apply(status.state));
  }, []);

  // 删掉当前正在看的侧栏网页时，回到对话，避免停在一个不存在的视图上。
  useEffect(() => {
    if (
      section.startsWith('web:') &&
      !sidebarPages.some((page) => `web:${page.id}` === section)
    ) {
      setSection('chat');
    }
  }, [section, sidebarPages]);

  const commitSidebarWidth = (width: number) => {
    setSidebarWidth(width);
    void window.bsub.setSidebarLayout({ width }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
  };

  const commitSidebarPosition = (position: 'left' | 'right') => {
    setSidebarPosition(position);
    void window.bsub.setSidebarLayout({ position }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
  };

  const commitSidebarToggle = (collapsed: boolean) => {
    void window.bsub.exitFullscreen();
    setSidebarCollapsed(collapsed);
    void window.bsub.setSidebarLayout({ collapsed }).then((response) => {
      if (response.ok) applyLayout(response.data);
    });
    window.setTimeout(() => {
      window.dispatchEvent(new Event('bsub:layout-refresh'));
      window.bsub.refreshView();
    }, 80);
  };

  const active = useMemo(() => tabs.find((tab) => tab.active) ?? null, [tabs]);
  const zoom = Number(active?.zoom) || 1;

  useEffect(() => {
    setZoomValue(zoom);
  }, [zoom]);

  useEffect(() => {
    return window.bsub.onPageZoomChanged((event) => {
      setZoomValue(event.zoom);
      setZoomPulse((value) => value + 1);
    });
  }, []);

  // 星标不再是「点一下直接切换」：和 Chrome / Edge 一样先打开收藏弹窗，
  // 可以改名 / 选文件夹；已收藏时打开就是编辑。
  const openBookmarkDialog = () => {
    if (!active || !/^https?:/i.test(active.url)) return;
    setBookmarkTarget({ url: active.url, title: active.title || active.url });
  };

  useEffect(() => {
    let alive = true;
    if (!active || !/^https?:/i.test(active.url)) {
      setBookmarked(false);
      return;
    }
    void window.bsub.isBookmarked(active.url).then((response) => {
      if (alive && response.ok) setBookmarked(response.data.bookmarked);
    });
    return () => {
      alive = false;
    };
  }, [active?.url]);

  useEffect(() => {
    let alive = true;
    window.bsub
      .listTabs()
      .then((list) => {
        if (alive) setTabs(list);
      })
      .catch(() => {
        // 主进程尚未就绪时忽略，后续事件会补上
      });
    const off = window.bsub.onTabs((list) => setTabs(list));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 焦点在网页（原生 WebContentsView）里时，renderer 收不到 Ctrl+K，
  // 由主进程 before-input-event 转发过来。
  useEffect(() => window.bsub.onSearchRequest(() => setSearchOpen(true)), []);

  useEffect(
    () =>
      window.bsub.onAskSelectionRequest(() => {
        setSection('chat');
        window.setTimeout(() => window.dispatchEvent(new Event('bsub:ask-selection')), 150);
      }),
    []
  );

  useEffect(() => window.bsub.onTabSearchRequest(() => setHub('tabs')), []);
  useEffect(() => window.bsub.onReaderRequest(() => setReaderOpen(true)), []);
  // 桌宠里的「打开设置」：主进程把窗口叫到前台后，这里负责真的切到设置页。
  useEffect(() => window.bsub.onOpenSettings(() => setSettingsOpen(true)), []);
  useEffect(() => window.bsub.onRadialOpen(() => setRadialOpen(true)), []);
  useEffect(
    () =>
      window.bsub.onWebContextAction(({ action, text }) => {
        const openChat = (prompt: string) => {
          setStartOpen(false);
          setSettingsOpen(false);
          setLibraryOpen(false);
          setSection('chat');
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent('bsub:chat-prefill', { detail: prompt })),
            160
          );
        };
        if (action === 'explain') openChat(`请解释这段内容：\n\n${text}`);
        else if (action === 'translate')
          openChat(`请把这段内容翻译成中文（若原文是中文则翻译成英文），保留结构：\n\n${text}`);
        else if (action === 'summarize') openChat(`请总结这段内容，给出要点与结论：\n\n${text}`);
        else if (action === 'ask') openChat(`关于这段内容，请帮我分析：\n\n${text}`);
        else if (action === 'speak') void speakText(text);
        else if (action === 'search') void window.bsub.newTab(text);
        else if (action === 'summarize-page') {
          setStartOpen(false);
          setSettingsOpen(false);
          setLibraryOpen(false);
          setSection('summary');
          window.setTimeout(() => requestSummaryPanel('summary'), 60);
        } else if (action === 'ask-page') openChat('请基于当前页面内容，提炼核心观点并指出值得继续追问的问题。');
      }),
    []
  );
  useEffect(
    () =>
      window.bsub.onTrayAction((action) => {
        if (action === 'start') {
          setSettingsOpen(false);
          setLibraryOpen(false);
          setStartOpen(true);
        } else if (action === 'library') {
          setSettingsOpen(false);
          setStartOpen(false);
          setLibraryOpen(true);
        } else if (action === 'settings') {
          setStartOpen(false);
          setLibraryOpen(false);
          setSettingsOpen(true);
        }
      }),
    []
  );

  const handleSelectionAction = useCallback(
    (payload: { action: string; text: string }) => {
      if (payload.action === 'copy') {
        void window.bsub.writeClipboard(payload.text);
        return;
      }
      if (payload.action === 'speak') {
        void speakText(payload.text);
        return;
      }
      if (payload.action === 'search') {
        void window.bsub.newTab(payload.text);
        return;
      }
      setSection('chat');
      window.setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent('bsub:selection-action', { detail: payload })
          ),
        150
      );
    },
    []
  );

  useEffect(() => window.bsub.onSelectionAction(handleSelectionAction), [handleSelectionAction]);

  const navigateAddress = useCallback(
    (input: string) => {
      const text = String(input || '').trim();
      if (!text) return;
      if (startOpen || !active) {
        setStartOpen(false);
        setSettingsOpen(false);
        setLibraryOpen(false);
        void window.bsub.newTab(text);
        return;
      }
      void window.bsub.navigate(text);
    },
    [startOpen, active]
  );

  useEffect(
    () =>
      window.bsub.onBookmarkRequest(() => {
        openBookmarkDialog();
      }),
    [active?.url]
  );

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        setFontScale(response.data.settings.general.fontScale || 1);
        setShortcutOverrides(response.data.settings.general.shortcuts || {});
        setRadialSectors(response.data.settings.general.radial?.sectors || []);
        setBookmarkBar(response.data.settings.general.bookmarkBar !== false);
        applyAppearance(response.data.settings.general);
        applyLayout(response.data);
        if (!response.data.settings.general.wizardDone) setWizard(response.data);
      }
    });
    return window.bsub.onSettingsChanged((snapshot) => {
      setFontScale(snapshot.settings.general.fontScale || 1);
      setShortcutOverrides(snapshot.settings.general.shortcuts || {});
      setRadialSectors(snapshot.settings.general.radial?.sectors || []);
      setBookmarkBar(snapshot.settings.general.bookmarkBar !== false);
      applyAppearance(snapshot.settings.general);
      applyLayout(snapshot);
      if (snapshot.settings.general.wizardDone) setWizard(null);
      else setWizard(snapshot);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      // 固定键位：Esc 关闭当前浮层（不参与自定义）
      if (event.key === 'Escape') {
        if (readerOpen) {
          setReaderOpen(false);
          return;
        }
        if (hub) setHub(null);
        return;
      }
      // 固定：缩放
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        void window.bsub.zoomIn();
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        void window.bsub.zoomOut();
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        void window.bsub.zoomReset();
        return;
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void window.bsub.reload();
        return;
      }
      // 固定：Alt+数字 / Alt+左右
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const target = tabs[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          void window.bsub.activateTab(target.id);
        }
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void window.bsub.back();
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void window.bsub.forward();
        return;
      }
      // 固定：Ctrl+1..9 定位标签（可自定义的是 Ctrl+Shift+1..4 面板）
      if (mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const target = tabIdByNumber(tabs, Number(event.key));
        if (target) void window.bsub.activateTab(target);
        return;
      }

      // 可自定义动作：主界面和网页焦点共用同一套键位。
      const action = actionForStroke(strokeFromEvent(event), shortcutMap, 'app');
      if (!action) return;
      event.preventDefault();
      runShortcutRef.current(action);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, hub, readerOpen, shortcutMap, tabs]);

  // 焦点在网页里时，主进程把配置好的快捷键以动作 id 转发过来。
  useEffect(
    () => window.bsub.onShortcut?.((action) => runShortcutRef.current(action as ShortcutActionId)),
    []
  );

  const handleSectionSelect = (next: Section) => {
    // 库已经升级成独立整页：不再占用侧栏，也不再切换侧栏 section。
    if (next === 'library') {
      void window.bsub.exitFullscreen();
      setStartOpen(false);
      setSettingsOpen(false);
      setLibraryOpen(true);
      return;
    }
    setLibraryOpen(false);
    void window.bsub.exitFullscreen();
    setSection(next);
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      void persistGeneral({ sidebarCollapsed: false });
    }
    window.setTimeout(() => {
      window.dispatchEvent(new Event('bsub:layout-refresh'));
      window.bsub.refreshView();
    }, 80);
  };
  sectionHandlerRef.current = handleSectionSelect;

  const persistGeneral = async (patch: Record<string, unknown>) => {
    const response = await window.bsub.getSettings();
    if (!response.ok) return;
    const settings = {
      ...response.data.settings,
      general: { ...response.data.settings.general, ...patch }
    };
    await window.bsub.saveSettings(settings);
  };

  const finishWizard = (openSettings: boolean) => {
    setWizard(null);
    if (openSettings) setSettingsOpen(true);
    void window.bsub.finishWizard();
  };

  const commands: CommandItem[] = [
    { id: 'section-subtitles', label: '打开面板：字幕', hint: 'Ctrl+Shift+1', run: () => setSection('subtitles') },
    { id: 'section-summary', label: '打开面板：总结', run: () => setSection('summary') },
    { id: 'section-chat', label: '打开面板：对话', run: () => setSection('chat') },
    { id: 'section-library', label: '打开工作台', run: () => handleSectionSelect('library') },
    { id: 'section-settings', label: '打开设置', hint: 'Ctrl+,', run: () => setSettingsOpen(true) },
    { id: 'start-page', label: '打开起始页', run: () => setStartOpen(true) },
    { id: 'hub-tabs', label: '打开面板：标签页', hint: 'Ctrl+Shift+A', run: () => setHub('tabs') },
    { id: 'hub-history', label: '浏览历史', hint: 'Ctrl+H', run: () => setHub('history') },
    { id: 'hub-bookmarks', label: '书签管理', hint: 'Ctrl+Shift+O', run: () => setHub('bookmarks') },
    { id: 'hub-downloads', label: '下载记录', hint: 'Ctrl+J', run: () => setHub('downloads') },
    { id: 'clear-data', label: '清除浏览数据…', run: () => setClearDataOpen(true) },
    { id: 'reader', label: '打开阅读模式', hint: 'Alt+R', run: () => setReaderOpen(true) },
    { id: 'search', label: '全局搜索', hint: 'Ctrl+K', run: () => setSearchOpen(true) },
    { id: 'print', label: '打印页面', hint: 'Ctrl+P', run: () => void window.bsub.printPage?.() },
    { id: 'save-pdf', label: '另存为 PDF', run: () => void window.bsub.savePagePdf?.() },
    { id: 'new-tab', label: '新建标签页', hint: 'Ctrl+T', run: () => void window.bsub.newTab() },
    {
      id: 'reopen-tab',
      label: '重新打开关闭的标签页',
      hint: 'Ctrl+Shift+T',
      run: () => void window.bsub.reopenClosedTab()
    },
    {
      id: 'toggle-sidebar',
      label: '折叠 / 展开侧栏',
      run: () => {
        setSidebarCollapsed((value) => !value);
        void persistGeneral({ sidebarCollapsed: !sidebarCollapsed });
      }
    },
    {
      id: 'swap-sidebar',
      label: '左右切换侧栏位置',
      run: () => {
        const next = sidebarPosition === 'left' ? 'right' : 'left';
        setSidebarPosition(next);
        void persistGeneral({ sidebarPosition: next });
      }
    },
    {
      id: 'toggle-vertical-tabs',
      label: verticalTabs ? '切换为水平标签栏' : '切换为垂直标签栏',
      run: () => {
        const next = !verticalTabs;
        setVerticalTabs(next);
        void persistGeneral({ verticalTabs: next });
      }
    },
    ...(startOpen
      ? [
          {
            id: 'start-add-shortcut',
            label: '起始页：添加快捷方式',
            run: () =>
              window.dispatchEvent(
                new CustomEvent('shizi:start-command', { detail: 'add' })
              )
          },
          {
            id: 'start-customize',
            label: '起始页：自定义',
            run: () =>
              window.dispatchEvent(
                new CustomEvent('shizi:start-command', { detail: 'customize' })
              )
          },
          {
            id: 'start-close',
            label: '起始页：关闭',
            run: () =>
              window.dispatchEvent(
                new CustomEvent('shizi:start-command', { detail: 'close' })
              )
          }
        ]
      : [])
  ];

  // 插件命令：能定位到面板就切侧栏，否则在新标签页打开插件入口。
  const pluginCommands: CommandItem[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled || plugin.error) continue;
    const firstPanel = plugin.panels[0];
    for (const command of plugin.commands) {
      pluginCommands.push({
        id: `plugin:${plugin.id}:${command.id}`,
        label: command.title,
        hint: command.hint || `插件 · ${plugin.name}`,
        run: () => {
          if (firstPanel) {
            handleSectionSelect(pluginPanelSection(plugin.id, firstPanel.id) as Section);
          } else {
            void window.bsub.newTab(pluginEntryUrl(plugin.id, command.entry));
          }
        }
      });
    }
  }

  const wrappedCommands: CommandItem[] = [...commands, ...pluginCommands].map((command) => ({
    ...command,
    run: () => {
      setPaletteOpen(false);
      command.run();
    }
  }));

  runShortcutRef.current = (action) => {
    switch (action) {
      case 'new-tab':
        void window.bsub.newTab();
        break;
      case 'close-tab':
        if (active) void window.bsub.closeTab(active.id);
        break;
      case 'reopen-tab':
        void window.bsub.reopenClosedTab();
        break;
      case 'next-tab':
      case 'prev-tab': {
        const target = nextTabId(tabs, active?.id, action === 'next-tab' ? 1 : -1);
        if (target) void window.bsub.activateTab(target);
        break;
      }
      case 'focus-address':
        setAddressFocus((value) => value + 1);
        break;
      case 'find':
        void window.bsub.showFindOverlay();
        break;
      case 'search':
        setSearchOpen(true);
        break;
      case 'palette':
        setPaletteOpen((value) => !value);
        break;
      case 'settings':
        setSettingsOpen(true);
        break;
      case 'reader':
        setReaderOpen(true);
        break;
      case 'bookmark':
        openBookmarkDialog();
        break;
      case 'history':
        setHub('history');
        break;
      case 'bookmarks':
        setHub('bookmarks');
        break;
      case 'downloads':
        setHub('downloads');
        break;
      case 'reload':
        void window.bsub.reload();
        break;
      case 'print':
        void window.bsub.printPage?.();
        break;
      case 'tab-search':
        setHub('tabs');
        break;
      case 'section-subtitles':
        sectionHandlerRef.current('subtitles');
        break;
      case 'section-summary':
        sectionHandlerRef.current('summary');
        break;
      case 'section-chat':
        sectionHandlerRef.current('chat');
        break;
      case 'section-library':
        sectionHandlerRef.current('library');
        break;
      case 'ask-selection':
        setSection('chat');
        window.setTimeout(() => window.dispatchEvent(new Event('bsub:ask-selection')), 150);
        break;
      default:
        break;
    }
  };

  const runRadial = (action: WheelActionId) => {
    setRadialOpen(false);
    if (action === 'summary') {
      setSettingsOpen(false);
      setLibraryOpen(false);
      setStartOpen(false);
      setSection('summary');
      window.setTimeout(() => requestSummaryPanel('summary'), 80);
    } else if (action === 'chat') {
      setSettingsOpen(false);
      setLibraryOpen(false);
      setStartOpen(false);
      setSection('chat');
    } else if (action === 'newChat') {
      setSettingsOpen(false);
      setLibraryOpen(false);
      setStartOpen(false);
      setSection('chat');
      window.setTimeout(() => window.dispatchEvent(new Event('bsub:chat-new')), 120);
    } else if (action === 'library') {
      setSettingsOpen(false);
      setStartOpen(false);
      setLibraryOpen(true);
    } else if (action === 'settings') {
      setLibraryOpen(false);
      setStartOpen(false);
      setSettingsOpen(true);
    } else if (action === 'start') {
      setSettingsOpen(false);
      setLibraryOpen(false);
      setStartOpen(true);
    } else if (action === 'find') {
      void window.bsub.showFindOverlay();
    } else if (action === 'reader') {
      setReaderOpen(true);
    } else if (action === 'reload') {
      void window.bsub.reload();
    }
  };

  return (
    <div className="app-window">
      <TitleBar
        pinned={alwaysOnTop}
        onTogglePinned={toggleAlwaysOnTop}
        maximized={maximized}
        onToggleMaximize={() => {
          void window.bsub.toggleMaximizeWindow().then((result) => {
            if (result.ok) setMaximized(result.data);
          });
        }}
      />
      <div
      className={`app-shell${verticalTabs ? ' vertical-tabs' : ''}${
        tabPeek.open ? ' is-tab-peek' : ''
      }${startOpen || settingsOpen || libraryOpen || tabs.length === 0 ? ' is-page' : ''}`}
      style={
        verticalTabs
          ? ({ '--tab-peek-width': `${tabPeek.width}px` } as CSSProperties)
          : undefined
      }
    >
      {!settingsOpen && (
        <TabStrip
          tabs={tabs}
          vertical={verticalTabs}
          onSearch={() => setSearchOpen(true)}
          onNewTab={() => setStartOpen(true)}
          onPeekChange={handlePeekChange}
          onActivate={() => {
            setStartOpen(false);
            setSettingsOpen(false);
            setLibraryOpen(false);
          }}
        />
      )}
      <div className="app-main">
      <AddressBar
        tab={active}
        toolbar={browserToolbar}
        focusSignal={addressFocus}
        bookmarked={bookmarked}
        onToggleBookmark={() => openBookmarkDialog()}
        onSelectionAction={handleSelectionAction}
        onNavigate={navigateAddress}
        onOpenHub={(section) => setHub(section)}
        onOpenClearData={() => setClearDataOpen(true)}
        onOpenReader={() => setReaderOpen(true)}
        onOpenFind={() => void window.bsub.showFindOverlay()}
        siteDarkDisabled={siteDarkDisabled}
        onOpenStart={() => {

          setSettingsOpen(false);
          setLibraryOpen(false);
          setStartOpen(true);
        }}
        onOpenLibrary={() => handleSectionSelect('library')}
        onOpenSettings={() => {
          setLibraryOpen(false);
          setSettingsOpen(true);
        }}
        hasUpdate={hasUpdate}
        appDark={appDark}
        onToggleDark={toggleAppDark}
        zoom={zoomValue}
        zoomPulse={zoomPulse}
        onOpenZoom={(rect) => {
          void window.bsub.showZoomMenu(rect);
        }}
      />
      {bookmarkBar && !settingsOpen && (
        <BookmarkBar
          onOpen={(url) => void window.bsub.newTab(url)}
          onManage={() => setHub('bookmarks')}
        />
      )}
      <div className={`app-body sidebar-${sidebarPosition}${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <Sidebar
          section={section}
          onSelect={handleSectionSelect}
          onOpenSettings={() => setSettingsOpen(true)}
          activeTab={active}
          tabCount={tabs.length}
          fontScale={fontScale}
          sidebarWidth={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onWidthCommit={commitSidebarWidth}
          collapsed={sidebarCollapsed}
          position={sidebarPosition}
          onDockChange={commitSidebarPosition}
          onToggleCollapse={commitSidebarToggle}
          onDragSnapshot={setDragSnapshot}
          onOpenSummary={() => {
            void window.bsub.exitFullscreen();
            setSection('summary');
            window.setTimeout(() => requestSummaryPanel('summary'), 0);
          }}
          onOpenChapters={() => {
            void window.bsub.exitFullscreen();
            setSection('summary');
            window.setTimeout(() => requestSummaryPanel('chapters'), 0);
          }}
          pages={sidebarPages}
          pluginPanels={pluginPanels}
          panelLayout={panelLayout}
        />
        <BrowserStage
          hasTab={Boolean(active)}
          sidebarPosition={sidebarPosition}
          sidebarCollapsed={sidebarCollapsed}
          sidebarWidth={sidebarWidth}
          snapshot={dragSnapshot}
        />
      </div>
      {(startOpen || settingsOpen || libraryOpen || tabs.length === 0) && (
        <div className="page-host">
          {settingsOpen ? (
            <Suspense fallback={null}>
              <SettingsPage onClose={() => setSettingsOpen(false)} />
            </Suspense>
          ) : libraryOpen ? (
            <Suspense fallback={null}>
              <LibraryPage onClose={() => setLibraryOpen(false)} />
            </Suspense>
          ) : (
            <StartPageClean
              onNavigate={(input) => {
                setStartOpen(false);
                void window.bsub.newTab(input);
              }}
              onOpenLibrary={() => {
                setStartOpen(false);
                handleSectionSelect('library');
              }}
              onOpenHistory={() => {
                setStartOpen(false);
                setHub('history');
              }}
              onOpenBookmarks={() => {
                setStartOpen(false);
                setHub('bookmarks');
              }}
              onOpenDownloads={() => {
                setStartOpen(false);
                setHub('downloads');
              }}
              onOpenTasks={() => {
                setStartOpen(false);
                setHub(null);
                window.dispatchEvent(new Event('shizi:open-tasks'));
              }}
              onOpenSettings={() => {
                setStartOpen(false);
                setSettingsOpen(true);
              }}
              onOpenGlobalSearch={() => {
                setStartOpen(false);
                setSearchOpen(true);
              }}
              onOpenCommandPalette={() => setPaletteOpen(true)}
              onClose={() => setStartOpen(false)}
            />
          )}
        </div>
      )}

      <BrowserHub
        open={Boolean(hub)}
        initial={hub || 'history'}
        tabs={tabs}
        onClose={() => setHub(null)}
        onOpenUrl={(url) => void window.bsub.openUrl(url)}
        onSelectTab={(id) => void window.bsub.activateTab(id)}
        onEditBookmark={(item) => setBookmarkTarget({ url: item.url, title: item.title })}
      />
      {clearDataOpen && <ClearBrowsingDataDialog onClose={() => setClearDataOpen(false)} />}
      {bookmarkTarget && (
        <BookmarkDialog
          url={bookmarkTarget.url}
          initialTitle={bookmarkTarget.title}
          onClose={() => setBookmarkTarget(null)}
          onChanged={(saved) => setBookmarked(saved)}
        />
      )}
      <RadialMenu
        open={radialOpen}
        sectors={radialSectors}
        onAction={runRadial}
        onClose={() => setRadialOpen(false)}
      />
      <ReaderMode
        open={readerOpen}
        onClose={() => setReaderOpen(false)}
        onAskAi={(text) => {
          setSection('chat');
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent('bsub:reader-summary', { detail: { text } })),
            180
          );
        }}
      />
      {wizard && <FirstRunWizard snapshot={wizard} onFinish={finishWizard} />}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenItem={(videoId, tab) => {
          setSearchOpen(false);
          setSection('library');
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent('bsub:library-item', { detail: { videoId, tab } })
              ),
            220
          );
        }}
        onOpenLine={(url, start) => {
          setSearchOpen(false);
          void window.bsub.openUrl(url, start);
        }}
        onOpenCollection={(collectionId) => {
          setSearchOpen(false);
          setSection('library');
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent('bsub:collection-summary', { detail: collectionId })
              ),
            220
          );
        }}
      />

      {assistantEnabled && (
        <button
          className="assistant-ball"
          title="拾字 AI 助手"
          onClick={() => {
            setSettingsOpen(false);
            setStartOpen(false);
            handleSectionSelect('chat');
          }}
        >
          AI
        </button>
      )}

      <SpeechBar />
      <CommandPalette
        open={paletteOpen}
        commands={wrappedCommands}
        onClose={() => setPaletteOpen(false)}
      />
      <DictationListener />
      </div>
      <CloseDialog
        open={closeOpen}
        onChoose={(choice, remember) => {
          setCloseOpen(false);
          window.bsub.closeDecision(choice, remember);
        }}
      />
      <ConfirmHost />
    </div>
    </div>
  );
}
