import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FindResult, Section, SettingsSnapshot, TabInfo } from '../../shared/types';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { FindBar } from './components/FindBar';
import { Sidebar } from './components/Sidebar';
import { BrowserStage } from './components/BrowserStage';
import { FirstRunWizard } from './components/FirstRunWizard';
import { GlobalSearch } from './components/GlobalSearch';
import { BrowserHub, type HubSection } from './components/BrowserHub';
import { ReaderMode } from './components/ReaderMode';
import { StartPage } from './components/StartPage';
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
import { useDropImport } from './lib/dropImport';
import { overlayVisible, useBrowserOverlayAuto } from './lib/browserOverlay';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
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
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [verticalTabs, setVerticalTabs] = useState(true);
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

  // 折叠的垂直标签栏探出时是 DOM 浮层，原生网页视图会盖住它；
  // 暂时隐藏网页，收起后按现有浮层状态恢复。
  useEffect(() => {
    if (!tabPeek.open) return;
    void window.bsub.setBrowserVisible(false);
    return () => {
      void window.bsub.setBrowserVisible(!overlayVisible());
    };
  }, [tabPeek.open]);
  const [bookmarked, setBookmarked] = useState(false);
  // 供全局键盘/主进程转发调用：避免把 handleSectionSelect 的依赖塞进每个 effect。
  const sectionHandlerRef = useRef<(next: Section) => void>(() => undefined);
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
        verticalTabs?: boolean;
        assistantEnabled?: boolean;
        petEnabled?: boolean;
      };
    };
  }) => {
    setSidebarWidth(snapshot.settings.general.sidebarWidth);
    setSidebarPosition(snapshot.settings.general.sidebarPosition);
    setSidebarCollapsed(snapshot.settings.general.sidebarCollapsed);
    setVerticalTabs(snapshot.settings.general.verticalTabs === true);
    setAssistantEnabled(snapshot.settings.general.assistantEnabled === true);
  };

  useEffect(() => {
    const apply = (state: string) =>
      setHasUpdate(['available', 'downloading', 'downloaded'].includes(state));
    void window.bsub.getUpdateStatus().then((response) => {
      if (response.ok) apply(response.data.state);
    });
    return window.bsub.onUpdateStatus((status) => apply(status.state));
  }, []);

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

  const toggleBookmark = async () => {
    if (!active || !/^https?:/i.test(active.url)) return;
    const response = await window.bsub.toggleBookmark({
      url: active.url,
      title: active.title,
      favicon: active.favicon
    });
    if (response.ok) setBookmarked(response.data.bookmarked);
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

  useEffect(
    () =>
      window.bsub.onSelectionAction((payload) => {
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
      }),
    []
  );

  useEffect(
    () =>
      window.bsub.onBookmarkRequest(() => {
        void toggleBookmark();
      }),
    [active?.url]
  );

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        setFontScale(response.data.settings.general.fontScale || 1);
        setShortcutOverrides(response.data.settings.general.shortcuts || {});
        setRadialSectors(response.data.settings.general.radial?.sectors || []);
        applyAppearance(response.data.settings.general);
        applyLayout(response.data);
        if (!response.data.settings.general.wizardDone) setWizard(response.data);
      }
    });
    return window.bsub.onSettingsChanged((snapshot) => {
      setFontScale(snapshot.settings.general.fontScale || 1);
      setShortcutOverrides(snapshot.settings.general.shortcuts || {});
      setRadialSectors(snapshot.settings.general.radial?.sectors || []);
      applyAppearance(snapshot.settings.general);
      applyLayout(snapshot);
      if (snapshot.settings.general.wizardDone) setWizard(null);
      else setWizard(snapshot);
    });
  }, []);

  useEffect(() => {
    return window.bsub.onFindResult((result) => {
      if (active && result.tabId === active.id) setFindResult(result);
    });
  }, [active]);

  useEffect(() => {
    if (!findOpen) return;
    if (!findQuery) {
      setFindResult(null);
      void window.bsub.stopFind();
      return;
    }
    const timer = window.setTimeout(() => {
      void window.bsub.findInPage(findQuery);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [findQuery, findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    setFindResult(null);
    if (findQuery) void window.bsub.findInPage(findQuery);
  }, [active?.id]);

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery('');
    setFindResult(null);
    void window.bsub.stopFind();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      // 固定键位：Esc 关闭当前浮层（不参与自定义）
      if (event.key === 'Escape') {
        if (readerOpen) {
          setReaderOpen(false);
          return;
        }
        if (findOpen) {
          closeFind();
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
  }, [active, findOpen, findQuery, hub, readerOpen, shortcutMap, tabs]);

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

  const drop = useDropImport((payload) => {
    if (payload.kind === 'files') {
      setSection('library');
      return;
    }
    void window.bsub.newTab(payload.value);
  });

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
    { id: 'start-page', label: '打开起始页', hint: 'Ctrl+T', run: () => setStartOpen(true) },
    { id: 'settings-page', label: '打开设置页', hint: 'Ctrl+,', run: () => setSettingsOpen(true) },
    { id: 'hub-tabs', label: '打开面板：标签页', hint: 'Ctrl+Shift+A', run: () => setHub('tabs') },
    { id: 'hub-history', label: '打开面板：历史 / 书签 / 下载', run: () => setHub('history') },
    { id: 'reader', label: '打开阅读模式', hint: 'Alt+R', run: () => setReaderOpen(true) },
    { id: 'search', label: '全局搜索', hint: 'Ctrl+K', run: () => setSearchOpen(true) },
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
    }
  ];

  const wrappedCommands: CommandItem[] = commands.map((command) => ({
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
        setFindOpen(true);
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
        void toggleBookmark();
        break;
      case 'reload':
        void window.bsub.reload();
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
      setFindOpen(true);
    } else if (action === 'reader') {
      setReaderOpen(true);
    } else if (action === 'reload') {
      void window.bsub.reload();
    }
  };

  return (
    <div
      className={`app-shell${verticalTabs ? ' vertical-tabs' : ''}${
        tabPeek.open ? ' is-tab-peek' : ''
      }${startOpen || settingsOpen || libraryOpen || tabs.length === 0 ? ' is-page' : ''}`}
      {...drop.handlers}
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
        focusSignal={addressFocus}
        bookmarked={bookmarked}
        onToggleBookmark={() => void toggleBookmark()}
        onOpenHub={(section) => setHub(section)}
        onOpenReader={() => setReaderOpen(true)}
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
      />
      {findOpen && (
        <FindBar
          query={findQuery}
          result={findResult}
          onChange={setFindQuery}
          onNext={() => void window.bsub.findInPage(findQuery, { forward: true, findNext: true })}
          onPrev={() => void window.bsub.findInPage(findQuery, { forward: false, findNext: true })}
          onClose={closeFind}
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
            <StartPage
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
                setHub('tabs');
              }}
              onOpenSettings={() => {
                setStartOpen(false);
                setSettingsOpen(true);
              }}
              onOpenGlobalSearch={() => {
                setStartOpen(false);
                setSearchOpen(true);
              }}
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
      />
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

      {drop.dragging && (
        <div className="drop-overlay">
          <div className="drop-card">松手打开链接或 BV 号</div>
        </div>
      )}

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
  );
}
