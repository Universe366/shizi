import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Command,
  Copy,
  Download,
  History,
  Library,
  Info,
  ListChecks,
  Palette,
  Pencil,
  Pin,
  Settings,
  Sparkles,
  Trash2
} from 'lucide-react';
import { parseReminder } from '../../../shared/reminder';
import { searchEngineLabel, type SearchEngineId } from '../../../shared/searchEngines';
import type {
  HistoryEntry,
  LibraryVideo,
  PetTodo,
  StartShortcut,
  StartWallpaperMedia
} from '../../../shared/types';
import { SearchBar, type Suggestion } from './start/SearchBar';
import { CommandPalette } from './start/CommandPalette';
import { Dock } from './start/Dock';
import { ShortcutBoard, type BuiltInEntry } from './start/ShortcutBoard';
import { ShortcutDialog, type ShortcutDraft } from './start/ShortcutDialog';
import { BatchAddDialog } from './start/BatchAddDialog';
import { GroupNameDialog } from './start/GroupNameDialog';
import { ShortcutDetail } from './start/ShortcutDetail';
import { askConfirm } from './ui/confirm';
import { WidgetPanel } from './start/WidgetPanel';
import { WallpaperDrawer } from './start/WallpaperDrawer';
import {
  ALL_WIDGETS,
  QUICK_LINKS,
  WALLPAPERS,
  buildStartBackup,
  bumpUsage,
  formatClock,
  greeting,
  hostOf,
  lunarDate,
  isStartDensity,
  isUrlLike,
  matchShortcut,
  mergeShortcuts,
  autofillShortcuts,
  filterByTag,
  normalizeTags,
  normalizeUsage,
  parseStartBackup,
  topTags,
  topUsed,
  type StartDensity,
  type TemperatureUnit,
  type StartUsage,
  type WallpaperId
} from './start/model';
import { clearWallpaperBlob } from './start/wallpaperStore';
import { pomodoroActions, usePomodoro } from './start/pomodoroStore';
import { useReducedMotion } from './start/useReducedMotion';
import { useStartClock } from './start/useStartClock';
import { useStartWeather } from './start/useStartWeather';
import { useStartWallpaper } from './start/useStartWallpaper';
import { buildStartCommands, buildStartQueryCommands } from './start/commands';
import { parseBookmarksHtml } from './start/bookmarks';

const SHORTCUT_BACKUP_KEY = 'start-shortcut-backup';
const EFFECT_KEY = 'start-wallpaper-effect';
const MINIMAL_KEY = 'start-minimal';
const DENSITY_KEY = 'start-density';
const COLLAPSED_KEY = 'start-collapsed-groups';
const USAGE_KEY = 'start-usage';
const NOTES_KEY = 'start-notes';
const UNIT_KEY = 'start-weather-unit';
const SUGGEST_KEY = 'start-search-suggest';
const WIDGET_COLLAPSED_KEY = 'start-widget-collapsed';
const AUTO_SYNC_KEY = 'start-auto-sync';
const EXTRA_GROUPS_KEY = 'start-extra-groups';

export interface StartPageProps {
  onNavigate: (input: string) => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onOpenDownloads: () => void;
  onOpenGlobalSearch: () => void;
  onClose: () => void;
}

function readShortcutBackup(): StartShortcut[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SHORTCUT_BACKUP_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter(
          (item): item is StartShortcut =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof item.label === 'string' &&
            typeof item.url === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

function writeShortcutBackup(items: StartShortcut[]): void {
  try {
    localStorage.setItem(SHORTCUT_BACKUP_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function readEffect(): { blur: number; dim: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(EFFECT_KEY) || '{}');
    return {
      blur: Math.min(24, Math.max(0, Number(raw?.blur) || 0)),
      dim: Math.min(0.8, Math.max(0, Number(raw?.dim) || 0.18))
    };
  } catch {
    return { blur: 0, dim: 0.18 };
  }
}

function readDensity(): StartDensity {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return isStartDensity(value) ? value : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function readCollapsed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function readUsage(): StartUsage {
  try {
    return normalizeUsage(JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')) || {};
  } catch {
    return {};
  }
}

function readNotes(): string {
  try {
    return localStorage.getItem(NOTES_KEY) || '';
  } catch {
    return '';
  }
}

function readWidgetCollapsed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_COLLAPSED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function readExtraGroups(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTRA_GROUPS_KEY) || '[]');
    return Array.isArray(raw)
      ? raw
          .map(String)
          .filter((item) => Boolean(item.trim()))
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function readSearchSuggest(): boolean {
  try {
    return localStorage.getItem(SUGGEST_KEY) !== '0';
  } catch {
    return true;
  }
}

function readWeatherUnit(): TemperatureUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'f' ? 'f' : 'c';
  } catch {
    return 'c';
  }
}

/** 起始页：时钟 / 搜索 / 分组快捷方式 / 小组件 / 壁纸。 */
export function StartPage({
  onNavigate,
  onOpenLibrary,
  onOpenHistory,
  onOpenTasks,
  onOpenSettings,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenGlobalSearch,
  onClose
}: StartPageProps) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<LibraryVideo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const { now, clock, changeClock } = useStartClock();
  const [engine, setEngine] = useState<SearchEngineId>('bing');
  const [engineOpen, setEngineOpen] = useState(false);
  const [todos, setTodos] = useState<PetTodo[]>([]);
  const [todoDraft, setTodoDraft] = useState('');
  const [shortcuts, setShortcuts] = useState<StartShortcut[]>([]);
  const [shortcutBackup, setShortcutBackup] = useState<StartShortcut[]>([]);
  const [selectedShortcuts, setSelectedShortcuts] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState('全部');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupSeed, setGroupSeed] = useState<string | null>(null);
  const [extraGroups, setExtraGroups] = useState<string[]>(readExtraGroups);
  const [dockIds, setDockIds] = useState<string[]>([]);
  const [weatherUnit, setWeatherUnit] = useState<TemperatureUnit>(readWeatherUnit);
  const pomodoro = usePomodoro();
  const reducedMotion = useReducedMotion();
  const [widgetOrder, setWidgetOrder] = useState<string[]>([
    'weather',
    'todo',
    'pomodoro',
    'notes',
    'hot',
    'recent',
    'history',
    'quote'
  ]);
  const {
    weather,
    weatherAt,
    weatherOn,
    setWeatherOn,
    city,
    setCity,
    refresh: refreshWeather,
    apply: applyWeather
  } = useStartWeather(() => showNotice('天气刷新失败'));
  const [hot, setHot] = useState<string[]>([]);
  const [hotOn, setHotOn] = useState(true);
  const [editing, setEditing] = useState<ShortcutDraft | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [shortcutMenu, setShortcutMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [minimal, setMinimal] = useState(() => {
    try {
      return localStorage.getItem(MINIMAL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [effect, setEffect] = useState(readEffect);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('start-search-history') || '[]');
      return Array.isArray(raw) ? raw.map(String).slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const [remoteSuggest, setRemoteSuggest] = useState<string[]>([]);
  const [searchSuggestOn, setSearchSuggestOn] = useState(readSearchSuggest);
  const [autoSync, setAutoSync] = useState(() => {
    try {
      return localStorage.getItem(AUTO_SYNC_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [collapsedWidgets, setCollapsedWidgets] = useState<string[]>(readWidgetCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(-1);
  const [cityEditing, setCityEditing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [hotLoading, setHotLoading] = useState(false);
  const [density, setDensity] = useState<StartDensity>(readDensity);
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [usage, setUsage] = useState<StartUsage>(readUsage);
  const [notes, setNotes] = useState(readNotes);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [activeTag, setActiveTag] = useState('');
  const [detail, setDetail] = useState<StartShortcut | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(() => {
    try {
      return localStorage.getItem('start-onboarding-done') !== '1';
    } catch {
      return false;
    }
  });
  const importRef = useRef<HTMLInputElement>(null);
  const bookmarkRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const patchGeneral = async (patch: Record<string, unknown>) => {
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    Object.assign(settings.general, patch);
    await window.bsub.saveSettings(settings);
  };

  const showNotice = (text: string, undo?: () => void) => {
    setNotice({ text, undo });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), undo ? 6000 : 2600);
  };

  const {
    wallpaper,
    setWallpaper,
    wallpaperImage,
    setWallpaperImage,
    wallpaperMedia,
    setWallpaperMedia,
    inkMode,
    bingWallpaper,
    bingGallery,
    bingGalleryState,
    gallerySource,
    changeGallerySource,
    bingSelection,
    setBingSelection,
    bingFavorites,
    rotateMinutes,
    wallpaperOpen,
    setWallpaperOpen,
    effectiveInk,
    displayBackground,
    displayVideo,
    wallpaperPreview,
    wallpaperPreviewKind,
    setWallpaperBroken,
    applyWallpaperFile,
    applyWallpaperUrl,
    pickBingImage,
    resetBingImage,
    toggleBingFavorite,
    changeRotateMinutes,
    changeInkMode,
    clearCustomWallpaper,
    pickWallpaper,
    applyBackup,
    retryBingGallery
  } = useStartWallpaper({ patchGeneral, showNotice });

  const applySettings = (general: Record<string, unknown>) => {
    setEngine((general.searchEngine as SearchEngineId) || 'bing');
    setTodos(Array.isArray(general.petTodos) ? (general.petTodos as PetTodo[]) : []);
    const fromSettings = Array.isArray(general.startShortcuts)
      ? (general.startShortcuts as StartShortcut[])
      : [];
    const backup = readShortcutBackup();
    setShortcutBackup(backup);
    if (!fromSettings.length && backup.length) {
      // 设置文件被重置/更新覆盖时，用本地备份兜底，避免用户保存的网址直接消失。
      setShortcuts(backup);
      void patchGeneral({ startShortcuts: backup });
    } else {
      setShortcuts(fromSettings);
      if (fromSettings.length >= backup.length) writeShortcutBackup(fromSettings);
    }
    setWallpaper((general.startWallpaper as WallpaperId) || 'aurora');
    setWallpaperImage(String(general.startWallpaperImage || ''));
    const bingImage = String(general.startBingImage || '');
    setBingSelection(
      bingImage
        ? { url: bingImage, copyright: String(general.startBingCopyright || '') }
        : null
    );
    setDockIds(
      Array.isArray(general.startDockIds)
        ? (general.startDockIds as unknown[]).map(String).slice(0, 8)
        : []
    );
    const media = general.startWallpaperMedia as StartWallpaperMedia | undefined;
    setWallpaperMedia(
      media &&
        (media.kind === 'image' || media.kind === 'gif' || media.kind === 'video') &&
        (media.source === 'file' || media.source === 'url')
        ? media
        : null
    );
    if (Array.isArray(general.startWidgets)) {
      setWidgetOrder(general.startWidgets.map(String));
    }
    applyWeather(general);
    setHotOn(general.startHotSearch !== false);
  };

  useEffect(() => {
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setRecent(response.data.videos.slice(0, 4));
    });
    void window.bsub.listBrowseHistory('', 5).then((response) => {
      if (response.ok) setHistory(response.data.slice(0, 5));
    });
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        applySettings(response.data.settings.general as unknown as Record<string, unknown>);
      }
    });
  }, []);

  useEffect(() => {
    if (!hotOn || !widgetOrder.includes('hot')) return;
    let alive = true;
    void window.bsub.startHotSearch().then((response) => {
      if (alive && response.ok) setHot(response.data.slice(0, 8));
    });
    return () => {
      alive = false;
    };
  }, [hotOn, widgetOrder]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, notes);
      } catch {
        setNotice({ text: '便签保存失败：本地存储空间不足' });
        window.setTimeout(() => setNotice(null), 2600);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notes]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  useEffect(() => {
    const value = query.trim();
    if (!searchSuggestOn || value.length < 2) {
      setRemoteSuggest([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void window.bsub.startSuggest?.(value).then((response) => {
        if (alive) setRemoteSuggest(response?.ok ? response.data.slice(0, 6) : []);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, searchSuggestOn]);

  useEffect(() => {
    if (!editMode) setSelectedShortcuts([]);
  }, [editMode]);

  useEffect(() => {
    if (!searchOpen) return;
    const close = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [searchOpen]);

  useEffect(() => {
    if (!shortcutMenu) return;
    const close = () => setShortcutMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [shortcutMenu]);

  useEffect(() => {
    if (!shortcutMenu) return;
    const previous = document.activeElement as HTMLElement | null;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      const buttons = menu
        ? [...menu.querySelectorAll<HTMLButtonElement>('button')]
        : [];
      if (!buttons.length) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setShortcutMenu(null);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : index <= 0
            ? buttons.length - 1
            : index - 1;
      buttons[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [shortcutMenu]);

  useEffect(() => {
    if (!engineOpen) return;
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('.start-engine-wrap')) return;
      setEngineOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [engineOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target!.tagName) || target!.isContentEditable);
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        setSearchOpen(false);
        return;
      }
      if (paletteOpen) return;
      if (!typing && !meta && event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (!typing && !meta && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setEditMode((value) => !value);
        setShortcutMenu(null);
      }
      if (!typing && !meta && event.key === '?') {
        event.preventDefault();
        setOnboarding(true);
        return;
      }
      if (
        !typing &&
        !meta &&
        !event.altKey &&
        !event.isComposing &&
        event.key.length === 1 &&
        event.key !== '/' &&
        event.key !== ' ' &&
        event.key.toLowerCase() !== 'e' &&
        !editMode &&
        !paletteOpen &&
        !wallpaperOpen &&
        !shortcutMenu &&
        !editing
      ) {
        event.preventDefault();
        setQuery(event.key);
        setSearchOpen(true);
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        setWallpaperOpen(false);
        setShortcutMenu(null);
        setEditing(null);
        setSearchOpen(false);
        if (minimal) {
          setMinimal(false);
          try {
            localStorage.setItem(MINIMAL_KEY, '0');
          } catch {
            // ignore
          }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, minimal, editMode, wallpaperOpen, shortcutMenu, editing]);

  const engineLabel = searchEngineLabel(engine);

  const pickEngine = async (next: SearchEngineId) => {
    setEngine(next);
    setEngineOpen(false);
    await patchGeneral({ searchEngine: next });
  };

  const rememberSearch = (text: string) => {
    const value = text.trim();
    if (!value) return;
    const next = [value, ...searchHistory.filter((item) => item !== value)].slice(0, 8);
    setSearchHistory(next);
    try {
      localStorage.setItem('start-search-history', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const commitSearch = (text: string) => {
    const value = text.trim();
    if (!value) return;
    rememberSearch(value);
    onClose();
    onNavigate(value);
  };

  const openShortcut = (item: StartShortcut) => {
    setUsage((current) => {
      const next = bumpUsage(current, item.id);
      try {
        localStorage.setItem(USAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    onClose();
    onNavigate(item.url);
  };

  /** 回车：完全匹配某个快捷方式名称时直接打开，否则按网址 / BV 号 / 搜索处理。 */
  const submitSearch = () => {
    const value = query.trim();
    if (!value) return;
    const exact = shortcuts.find((item) => item.label.toLowerCase() === value.toLowerCase());
    if (exact) {
      rememberSearch(value);
      openShortcut(exact);
      return;
    }
    commitSearch(value);
  };

  const persistTodos = async (next: PetTodo[]) => {
    setTodos(next);
    await patchGeneral({ petTodos: next });
  };

  const addTodo = () => {
    const raw = todoDraft.trim();
    if (!raw) return;
    const { text, dueAt } = parseReminder(raw);
    void persistTodos([...todos, { id: Date.now(), text: text.slice(0, 200), done: false, dueAt }]);
    setTodoDraft('');
  };

  const removeTodo = (id: number) => {
    const previous = todos;
    void persistTodos(todos.filter((item) => item.id !== id));
    showNotice('已删除待办', () => {
      void persistTodos(previous);
    });
  };

  const clearDoneTodos = () => {
    const previous = todos;
    const next = todos.filter((item) => !item.done);
    if (next.length === previous.length) return;
    void persistTodos(next);
    showNotice(`已清除 ${previous.length - next.length} 条已完成`, () => {
      void persistTodos(previous);
    });
  };

  const reorderTodos = (fromId: number, toId: number) => {
    const from = todos.findIndex((item) => item.id === fromId);
    const to = todos.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const previous = todos;
    const next = [...todos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistTodos(next);
    showNotice('已调整待办顺序', () => {
      void persistTodos(previous);
    });
  };

  const dismissOnboarding = () => {
    setOnboarding(false);
    try {
      localStorage.setItem('start-onboarding-done', '1');
    } catch {
      // ignore
    }
  };

  const updateNotes = (value: string) => {
    setNotes(value.slice(0, 20000));
  };

  const clearNotes = () => {
    const previous = notes;
    setNotes('');
    showNotice('便签已清空', () => setNotes(previous));
  };

  const saveCity = () => {
    const next = cityDraft.trim() || city;
    setCity(next);
    setCityEditing(false);
    void patchGeneral({ startCity: next });
  };

  const locateCity = async () => {
    setLocating(true);
    try {
      const response = await window.bsub.startLocate?.();
      if (!response?.ok) {
        showNotice(response?.error || '定位失败');
        return;
      }
      const next = response.data.city;
      setCity(next);
      setCityEditing(false);
      void patchGeneral({ startCity: next });
      showNotice(`已定位到 ${next}`);
    } finally {
      setLocating(false);
    }
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    try {
      localStorage.removeItem('start-search-history');
    } catch {
      // ignore
    }
    showNotice('搜索历史已清空');
  };

  const changeAutoSync = (value: boolean) => {
    setAutoSync(value);
    try {
      localStorage.setItem(AUTO_SYNC_KEY, value ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const changeSearchSuggest = (value: boolean) => {
    setSearchSuggestOn(value);
    try {
      localStorage.setItem(SUGGEST_KEY, value ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const toggleWeatherUnit = () => {
    const next: TemperatureUnit = weatherUnit === 'c' ? 'f' : 'c';
    setWeatherUnit(next);
    try {
      localStorage.setItem(UNIT_KEY, next);
    } catch {
      // ignore
    }
  };

  const refreshHot = async () => {
    if (hotLoading) return;
    setHotLoading(true);
    try {
      const response = await window.bsub.startHotSearch(true);
      if (response.ok) setHot(response.data.slice(0, 8));
    } finally {
      setHotLoading(false);
    }
  };

  const persistShortcuts = async (
    next: StartShortcut[],
    extra?: Record<string, unknown>
  ) => {
    setShortcuts(next);
    writeShortcutBackup(next);
    setShortcutBackup(next);
    await patchGeneral({ startShortcuts: next, ...extra });
  };

  const saveShortcut = () => {
    if (!editing) return;
    const label = editing.label.trim();
    const group = editing.group.trim() || '常用';
    let url = editing.url.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return;
    const id = editing.id || `s-${Date.now().toString(36)}`;
    const desc = String(editing.desc || '').trim().slice(0, 120);
    const tags = normalizeTags(editing.tagsText || '');
    const patch = {
      label,
      url,
      group,
      ...(desc ? { desc } : {}),
      ...(tags.length ? { tags } : {})
    };
    const next = editing.id
      ? shortcuts.map((item) => (item.id === editing.id ? { ...item, ...patch } : item))
      : [...shortcuts, { id, ...patch }];
    setEditing(null);
    void persistShortcuts(next);
  };

  const groups = useMemo(() => {
    const map = new Map<string, StartShortcut[]>();
    for (const item of shortcuts) {
      const key = item.group || '常用';
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    for (const group of extraGroups) {
      if (!map.has(group)) map.set(group, []);
    }
    return Array.from(map.entries());
  }, [shortcuts, extraGroups]);

  const frequent = useMemo(() => topUsed(shortcuts, usage, 8), [shortcuts, usage]);
  const dockShortcuts = useMemo(() => {
    if (dockIds.length) {
      return dockIds
        .map((id) => shortcuts.find((item) => item.id === id))
        .filter((item): item is StartShortcut => Boolean(item));
    }
    return frequent.length ? frequent : shortcuts.slice(0, 6);
  }, [dockIds, shortcuts, frequent]);
  const tags = useMemo(() => topTags(shortcuts, 12), [shortcuts]);

  const visibleGroups = useMemo(() => {
    const base: Array<[string, StartShortcut[]]> =
      activeGroup === '全部'
        ? groups
        : activeGroup === '常用'
          ? [['常用', frequent]]
          : groups.filter(([group]) => group === activeGroup);
    return base
      .map(
        ([group, items]) => [group, filterByTag(items, activeTag)] as [string, StartShortcut[]]
      )
      .filter(([, items]) => !activeTag || items.length > 0);
  }, [activeGroup, activeTag, frequent, groups]);

  useEffect(() => {
    if (activeGroup !== '全部' && !groups.some(([group]) => group === activeGroup)) {
      setActiveGroup('全部');
    }
  }, [activeGroup, groups]);

  const moveShortcutTo = (fromId: string, group: string, targetId?: string) => {
    const fromIndex = shortcuts.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return;
    const toIndex = targetId ? shortcuts.findIndex((item) => item.id === targetId) : -1;
    const next = [...shortcuts];
    const [moved] = next.splice(fromIndex, 1);
    moved.group = group;
    if (toIndex >= 0) {
      const targetIndex = next.findIndex((item) => item.id === targetId);
      // 向后拖时插到目标之后，避免「拖到下一张却回到原位」。
      const insertAt = fromIndex < toIndex ? targetIndex + 1 : targetIndex;
      next.splice(Math.max(0, insertAt), 0, moved);
    } else {
      next.push(moved);
    }
    void persistShortcuts(next);
  };

  const toggleDockShortcut = (id: string) => {
    const pinned = dockIds.includes(id);
    const next = pinned ? dockIds.filter((item) => item !== id) : [...dockIds, id].slice(0, 8);
    setDockIds(next);
    void patchGeneral({ startDockIds: next });
    showNotice(pinned ? '已从 Dock 移除' : '已固定到 Dock');
  };

  const reorderDock = (fromId: string, toId: string) => {
    const base = dockIds.length ? dockIds : dockShortcuts.map((item) => item.id);
    const from = base.indexOf(fromId);
    const to = base.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDockIds(next);
    void patchGeneral({ startDockIds: next });
  };

  const toggleShortcutSelection = (id: string) => {
    setSelectedShortcuts((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const batchDeleteShortcuts = () => {
    const ids = new Set(selectedShortcuts);
    if (!ids.size) return;
    const previous = shortcuts;
    const previousDock = dockIds;
    const next = shortcuts.filter((item) => !ids.has(item.id));
    const nextDock = dockIds.filter((id) => !ids.has(id));
    setDockIds(nextDock);
    setSelectedShortcuts([]);
    void persistShortcuts(next, { startDockIds: nextDock });
    showNotice(`已删除 ${ids.size} 个快捷方式`, () => {
      setDockIds(previousDock);
      void persistShortcuts(previous, { startDockIds: previousDock });
    });
  };

  const requestNewGroup = (id: string) => {
    setGroupSeed(id || null);
    setGroupDialogOpen(true);
  };

  const createGroup = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const seed = groupSeed;
    setGroupDialogOpen(false);
    setGroupSeed(null);
    saveExtraGroups([...extraGroups, trimmed]);
    if (seed) {
      void persistShortcuts(
        shortcuts.map((item) => (item.id === seed ? { ...item, group: trimmed } : item))
      );
    }
    setActiveGroup(trimmed);
    showNotice(`已创建分组「${trimmed}」`);
  };

  const batchMoveShortcuts = (group: string) => {
    const ids = new Set(selectedShortcuts);
    if (!ids.size) return;
    const next = shortcuts.map((item) => (ids.has(item.id) ? { ...item, group } : item));
    setSelectedShortcuts([]);
    void persistShortcuts(next);
    showNotice(`已移动 ${ids.size} 个到「${group}」`);
  };

  const removeShortcut = (id: string) => {
    const previous = shortcuts;
    const previousDock = dockIds;
    const nextDock = dockIds.filter((item) => item !== id);
    const target = shortcuts.find((item) => item.id === id);
    if (nextDock.length !== dockIds.length) setDockIds(nextDock);
    void persistShortcuts(
      shortcuts.filter((item) => item.id !== id),
      nextDock.length !== dockIds.length ? { startDockIds: nextDock } : undefined
    );
    showNotice(target ? `已删除「${target.label}」` : '已删除', () => {
      if (previousDock.length !== dockIds.length) setDockIds(previousDock);
      void persistShortcuts(previous, { startDockIds: previousDock });
    });
  };

  const addShortcuts = (items: Array<{ label: string; url: string; group: string }>) => {
    const stamp = Date.now().toString(36);
    const created = items.map((item, index) => ({ ...item, id: `s-${stamp}-${index}` }));
    void (async () => {
      const result = await autofillShortcuts(
        created,
        async (url) => {
          const response = await window.bsub.startProbeSite?.(url);
          return response?.ok
            ? { title: response.data.title, description: response.data.description }
            : { title: '', description: '' };
        },
        8
      );
      if (result.filled) showNotice(`已自动补全 ${result.filled} 个站点`);
      void persistShortcuts([...shortcuts, ...result.items]);
    })();
  };

  const saveExtraGroups = (next: string[]) => {
    const unique = Array.from(new Set(next.map((item) => item.trim()).filter(Boolean))).slice(
      0,
      30
    );
    setExtraGroups(unique);
    try {
      localStorage.setItem(EXTRA_GROUPS_KEY, JSON.stringify(unique));
    } catch {
      // ignore
    }
  };

  const renameGroup = (from: string, to: string) => {
    const next = shortcuts.map((item) =>
      (item.group || '常用') === from ? { ...item, group: to } : item
    );
    if (extraGroups.includes(from)) {
      saveExtraGroups(extraGroups.map((group) => (group === from ? to : group)));
    }
    if (activeGroup === from) setActiveGroup(to);
    void persistShortcuts(next);
  };

  const removeGroup = async (group: string) => {
    const items = shortcuts.filter((item) => (item.group || '常用') === group);
    if (!items.length) {
      saveExtraGroups(extraGroups.filter((item) => item !== group));
      if (activeGroup === group) setActiveGroup('全部');
      return;
    }
    const ok = await askConfirm({
      title: `删除分组「${group}」？`,
      description: `${items.length} 个站点会移到「常用」，不会丢失。`,
      confirmText: '删除分组'
    });
    if (!ok) return;
    if (activeGroup === group) setActiveGroup('全部');
    void persistShortcuts(
      shortcuts.map((item) => ((item.group || '常用') === group ? { ...item, group: '常用' } : item))
    );
  };

  const openEditor = (item?: StartShortcut, group?: string) => {
    setEditing(
      item
        ? {
          id: item.id,
          label: item.label,
          url: item.url,
          group: item.group || '常用',
          desc: item.desc || '',
          tagsText: (item.tags || []).join(', ')
        }
        : { label: '', url: '', group: group || (activeGroup === '全部' ? '常用' : activeGroup) }
    );
  };

  const builtIn: BuiltInEntry[] = useMemo(
    () => [
      { id: 'library', label: '字幕库', icon: Library, run: onOpenLibrary },
      { id: 'history', label: '历史记录', icon: History, run: onOpenHistory },
      { id: 'tasks', label: '任务中心', icon: ListChecks, run: onOpenTasks },
      { id: 'bookmarks', label: '书签', icon: Bookmark, run: onOpenBookmarks },
      { id: 'downloads', label: '下载', icon: Download, run: onOpenDownloads },
      { id: 'settings', label: '设置', icon: Settings, run: onOpenSettings }
    ],
    [onOpenLibrary, onOpenHistory, onOpenTasks, onOpenBookmarks, onOpenDownloads, onOpenSettings]
  );

  const suggestions = useMemo<Suggestion[]>(() => {
    const value = query.trim();
    const items: Suggestion[] = [];
    if (value) {
      const local = shortcuts.filter((item) => matchShortcut(item, value)).slice(0, 4);
      for (const item of local) {
        items.push({ text: item.url, label: item.label, kind: 'shortcut', hint: hostOf(item.url) });
      }
      const looksVideo = /^(BV[0-9A-Za-z]{10}|av\d+)$/i.test(value);
      if (looksVideo) {
        items.push({
          text: `https://www.bilibili.com/video/${value}`,
          label: `打开 B 站视频 ${value}`,
          kind: 'video'
        });
      } else if (isUrlLike(value)) {
        items.push({ text: value, label: `打开 ${value}`, kind: 'open' });
      } else {
        items.push({
          text: value,
          label: `在 ${engineLabel} 搜索“${value}”`,
          kind: 'search'
        });
      }
      for (const text of remoteSuggest) {
        if (!text || items.some((item) => item.text === text)) continue;
        items.push({ text, label: text, kind: 'search', hint: engineLabel });
        if (items.length >= 7) break;
      }
    }
    for (const entry of searchHistory) {
      if (value && !entry.toLowerCase().includes(value.toLowerCase())) continue;
      if (items.some((item) => item.text === entry)) continue;
      items.push({ text: entry, label: entry, kind: 'history' });
      if (items.length >= 7) break;
    }
    return items;
  }, [query, shortcuts, searchHistory, remoteSuggest, engineLabel]);

  const widgetVisible = (id: string) => {
    if (!widgetOrder.includes(id)) return false;
    if (id === 'weather') return weatherOn;
    if (id === 'hot') return hotOn;
    return true;
  };

  const toggleWidget = (id: string) => {
    const visible = widgetVisible(id);
    const next = visible
      ? widgetOrder.filter((item) => item !== id)
      : widgetOrder.includes(id)
        ? widgetOrder
        : [...widgetOrder, id];
    setWidgetOrder(next);
    const patch: Record<string, unknown> = { startWidgets: next };
    if (id === 'weather') {
      setWeatherOn(!visible);
      patch.startWeather = !visible;
    }
    if (id === 'hot') {
      setHotOn(!visible);
      patch.startHotSearch = !visible;
    }
    void patchGeneral(patch);
  };

  const toggleWidgetCollapsed = (id: string) => {
    setCollapsedWidgets((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      try {
        localStorage.setItem(WIDGET_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const moveWidgetTo = (fromId: string, toId: string) => {
    const from = widgetOrder.indexOf(fromId);
    const to = widgetOrder.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...widgetOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWidgetOrder(next);
    void patchGeneral({ startWidgets: next });
  };

  const moveWidget = (id: string, delta: number) => {
    const index = widgetOrder.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= widgetOrder.length) return;
    const next = [...widgetOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setWidgetOrder(next);
    void patchGeneral({ startWidgets: next });
  };

  const updateEffect = (next: { blur: number; dim: number }) => {
    setEffect(next);
    try {
      localStorage.setItem(EFFECT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleMinimal = (value: boolean) => {
    setMinimal(value);
    try {
      localStorage.setItem(MINIMAL_KEY, value ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const changeDensity = (next: StartDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // ignore
    }
  };

  const toggleGroupCollapsed = (group: string) => {
    setCollapsed((current) => {
      const next = current.includes(group)
        ? current.filter((item) => item !== group)
        : [...current, group];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const buildBackup = () =>
    buildStartBackup({
      shortcuts,
      wallpaper,
      wallpaperImage,
      wallpaperMedia: wallpaperMedia || undefined,
      effect,
      minimal,
      engine,
      city,
      widgets: widgetOrder,
      weatherOn,
      hotOn,
      notes,
      usage,
      pomodoroRounds: pomodoro.rounds,
      bingImage: bingSelection?.url,
      bingCopyright: bingSelection?.copyright,
      dockIds,
      clock,
      weatherUnit,
      bingFavorites,
      rotateMinutes
    });

  const exportStart = () => {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shizi-start-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice(`已导出 ${backup.shortcuts.length} 个快捷方式`);
  };

  const syncStartToFolder = async () => {
    const result = await window.bsub.startSync?.('push', buildBackup());
    if (result?.ok) showNotice(`已同步到 ${result.data.path || '同步文件夹'}`);
    else showNotice(result?.error || '同步失败');
  };

  const syncStartFromFolder = async () => {
    const result = await window.bsub.startSync?.('pull');
    if (!result?.ok) {
      showNotice(result?.error || '同步失败');
      return;
    }
    const file = new File([JSON.stringify(result.data.data)], 'shizi-start.json', {
      type: 'application/json'
    });
    await importStart(file);
  };

  const backupGetter = useRef(buildBackup);
  backupGetter.current = buildBackup;
  const autoSyncPrimed = useRef(false);
  const autoSyncSignature = autoSync ? JSON.stringify(buildBackup()) : '';

  useEffect(() => {
    if (!autoSync) {
      autoSyncPrimed.current = false;
      return;
    }
    if (!autoSyncPrimed.current) {
      autoSyncPrimed.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void window.bsub.startSync?.('push', backupGetter.current());
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [autoSync, autoSyncSignature]);

  const importBookmarks = async (file: File) => {
    let text = '';
    try {
      text = await file.text();
    } catch {
      showNotice('读取书签文件失败');
      return;
    }
    const parsed = parseBookmarksHtml(text);
    if (!parsed.shortcuts.length) {
      showNotice('没有识别到可导入的网址');
      return;
    }
    const ok = await askConfirm({
      title: '导入浏览器书签？',
      description: `识别到 ${parsed.shortcuts.length} 个网址、${parsed.folders} 个分组，按网址去重后合并。`,
      confirmText: '合并导入'
    });
    if (!ok) return;
    void persistShortcuts(mergeShortcuts(shortcuts, parsed.shortcuts));
    showNotice(`已导入 ${parsed.shortcuts.length} 个书签`);
  };

  const importStart = async (file: File) => {
    let text = '';
    try {
      text = await file.text();
    } catch {
      showNotice('读取文件失败');
      return;
    }
    const parsed = parseStartBackup(text);
    if (!parsed.ok) {
      showNotice(parsed.error);
      return;
    }
    const incoming = parsed.data.shortcuts;
    const ok = await askConfirm({
      title: '导入起始页数据？',
      description: `将合并 ${incoming.length} 个快捷方式（按网址去重），并应用备份里的外观设置。`,
      confirmText: '合并导入'
    });
    if (!ok) return;
    void persistShortcuts(mergeShortcuts(shortcuts, incoming));

    const prefs = parsed.data.prefs;
    if (prefs.wallpaper && WALLPAPERS.some((item) => item.id === prefs.wallpaper)) {
      const next = prefs.wallpaper as WallpaperId;
      setWallpaper(next);
      void patchGeneral({ startWallpaper: next });
    }
    if (typeof prefs.wallpaperImage === 'string' && prefs.wallpaperImage.startsWith('data:image/')) {
      setWallpaperImage(prefs.wallpaperImage);
      void patchGeneral({ startWallpaperImage: prefs.wallpaperImage });
    }
    if (prefs.wallpaperMedia) {
      if (prefs.wallpaperMedia.source === 'file') {
        showNotice('备份里的本地壁纸文件无法随备份迁移，已跳过');
      } else {
        setWallpaperMedia(prefs.wallpaperMedia);
        setWallpaperImage('');
        void clearWallpaperBlob().catch(() => undefined);
        void patchGeneral({ startWallpaperMedia: prefs.wallpaperMedia, startWallpaperImage: '' });
      }
    }
    if (prefs.effect) {
      const next = {
        blur: Math.min(24, Math.max(0, prefs.effect.blur)),
        dim: Math.min(0.8, Math.max(0, prefs.effect.dim))
      };
      updateEffect(next);
    }
    if (typeof prefs.minimal === 'boolean') toggleMinimal(prefs.minimal);
    if (prefs.city) {
      setCity(prefs.city);
      void patchGeneral({ startCity: prefs.city });
    }
    if (prefs.widgets?.length) {
      const widgets = prefs.widgets.filter((item) => (ALL_WIDGETS as readonly string[]).includes(item));
      if (widgets.length) {
        setWidgetOrder(widgets);
        void patchGeneral({ startWidgets: widgets });
      }
    }
    if (typeof prefs.weatherOn === 'boolean') {
      setWeatherOn(prefs.weatherOn);
      void patchGeneral({ startWeather: prefs.weatherOn });
    }
    if (typeof prefs.hotOn === 'boolean') {
      setHotOn(prefs.hotOn);
      void patchGeneral({ startHotSearch: prefs.hotOn });
    }
    if (typeof prefs.notes === 'string') setNotes(prefs.notes);
    if (prefs.usage) {
      setUsage((current) => {
        const merged = { ...current };
        for (const [key, count] of Object.entries(prefs.usage || {})) {
          merged[key] = Math.max(merged[key] || 0, count);
        }
        try {
          localStorage.setItem(USAGE_KEY, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      });
    }
    if (typeof prefs.pomodoroRounds === 'number') {
      pomodoroActions.setRounds(prefs.pomodoroRounds);
    }
    if (prefs.bingImage) {
      setWallpaper('bing');
      setBingSelection({
        url: prefs.bingImage,
        copyright: prefs.bingCopyright || ''
      });
      void patchGeneral({
        startWallpaper: 'bing',
        startBingImage: prefs.bingImage,
        startBingCopyright: prefs.bingCopyright || ''
      });
    }
    applyBackup({
      bingFavorites: prefs.bingFavorites,
      rotateMinutes: prefs.rotateMinutes
    });
    if (prefs.dockIds) {
      setDockIds(prefs.dockIds);
      void patchGeneral({ startDockIds: prefs.dockIds });
    }
    if (prefs.clock) changeClock(prefs.clock);
    if (prefs.weatherUnit) {
      setWeatherUnit(prefs.weatherUnit);
      try {
        localStorage.setItem(UNIT_KEY, prefs.weatherUnit);
      } catch {
        // ignore
      }
    }
    showNotice(`已合并导入 ${incoming.length} 个快捷方式`);
  };

  const menuItem = shortcutMenu ? shortcuts.find((item) => item.id === shortcutMenu.id) : null;
  const groupNames = groups.map(([group]) => group);

  const lunar = lunarDate(now);
  const commands = buildStartCommands({
    minimal,
    editMode,
    toggleMinimal: () => toggleMinimal(!minimal),
    toggleEdit: () => setEditMode((value) => !value),
    focusSearch: () => {
      searchRef.current?.focus();
      setSearchOpen(true);
    },
    openGlobalSearch: onOpenGlobalSearch,
    openOnboarding: () => setOnboarding(true),
    openWallpaper: () => setWallpaperOpen(true),
    exportStart,
    importStart: () => importRef.current?.click(),
    builtIn,
    widgetVisible,
    toggleWidget,
    engineLabel,
    shortcuts,
    openShortcut
  });

  return (
    <div
      className={`start-page start-page-v3 start-wallpaper-${wallpaper}${minimal ? ' is-minimal' : ''}${
        effectiveInk ? ` is-ink-${effectiveInk}` : ''
      }`}
    >
      {!displayVideo && displayBackground && (
        <div
          key={displayBackground}
          className="start-wallpaper-layer"
          style={{ backgroundImage: `url(${displayBackground})` }}
          aria-hidden="true"
        />
      )}
      {displayVideo && (
        <video
          className="start-wallpaper-video"
          src={displayVideo}
          onError={() => setWallpaperBroken(true)}
          autoPlay={!reducedMotion}
          preload="metadata"
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      )}

      <div
        className="start-veil"
        aria-hidden="true"
        style={{
          backdropFilter: effect.blur ? `blur(${effect.blur}px)` : undefined,
          background: `color-mix(in srgb, var(--start-veil) ${Math.round(effect.dim * 100)}%, transparent)`
        }}
      />

      <header className="start-topbar">
        <div className="start-topbar-brand">
          <span className="start-brand-dot" />
          拾字
        </div>
        <div className="start-topbar-actions">
          <button
            className="start-ghost-btn"
            title="指令面板"
            onClick={() => setPaletteOpen(true)}
          >
            <Command size={14} />
          </button>
          <button
            className={`start-ghost-btn start-zen-toggle${minimal ? ' is-active' : ''}`}
            title="极简模式"
            onClick={() => toggleMinimal(!minimal)}
          >
            <Sparkles size={14} />
          </button>
          <button
            className={`start-pill${editMode ? ' is-active' : ''}`}
            onClick={() => {
              setEditMode((value) => !value);
              setShortcutMenu(null);
            }}
          >
            {editMode ? '完成' : '编辑'}
          </button>
          <button
            className="start-icon-btn"
            title="更换壁纸"
            onClick={() => setWallpaperOpen(true)}
          >
            <Palette size={15} />
          </button>
        </div>
      </header>

      <main className="start-main">
        <section className="start-hero">
          <div className="start-clock">{formatClock(now, clock)}</div>
          <div className="start-meta">
            {lunar && <span className="start-lunar">{lunar.text}</span>}
            <span className="start-greeting">
              {greeting(now)}，
              {now.toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'long'
              })}
            </span>
          </div>
          {minimal && <div className="start-zen-hint">按 Esc 退出禅模式</div>}

          <SearchBar
            query={query}
            engine={engine}
            engineLabel={engineLabel}
            engineOpen={engineOpen}
            searchOpen={searchOpen}
            active={searchActive}
            suggestions={suggestions}
            inputRef={searchRef}
            boxRef={searchBoxRef}
            onChange={(value) => {
              setQuery(value);
              setSearchOpen(true);
              setSearchActive(-1);
            }}
            onFocus={() => setSearchOpen(true)}
            onToggleEngine={() => setEngineOpen((value) => !value)}
            onPickEngine={(next) => void pickEngine(next)}
            onCommit={commitSearch}
            onSubmit={submitSearch}
            onActive={setSearchActive}
            onHover={setSearchActive}
            onEscape={() => {
              if (searchOpen) {
                setSearchOpen(false);
                setSearchActive(-1);
                if (query) setQuery('');
              } else {
                onClose();
              }
            }}
          />

          {!minimal && (
            <div className="start-chips">
              <span className="start-chips-label">常去</span>
              {QUICK_LINKS.map((item) => (
                <button
                  key={item.label}
                  className="start-chip"
                  onClick={() => {
                    onClose();
                    onNavigate(item.url);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <ShortcutBoard
          groups={groups}
          visibleGroups={visibleGroups}
          total={shortcuts.length}
          activeGroup={activeGroup}
          editMode={editMode}
          builtIn={builtIn}
          onGroup={setActiveGroup}
          onOpen={openShortcut}
          onEdit={(item) => openEditor(item)}
          onRemove={removeShortcut}
          onAdd={() => openEditor()}
          onBatchAdd={() => setBatchOpen(true)}
          onRenameGroup={renameGroup}
          onRemoveGroup={(group) => void removeGroup(group)}
          onMove={moveShortcutTo}
          onMenu={(item, x, y) => setShortcutMenu({ x, y, id: item.id })}
          onDragStart={() => setSearchOpen(false)}
          density={density}
          onDensity={changeDensity}
          collapsed={collapsed}
          onToggleGroup={toggleGroupCollapsed}
          frequent={frequent}
          onExport={exportStart}
          onImport={() => importRef.current?.click()}
          onImportBookmarks={() => bookmarkRef.current?.click()}
          selected={selectedShortcuts}
          onSelect={toggleShortcutSelection}
          onClearSelection={() => setSelectedShortcuts([])}
          onBatchDelete={batchDeleteShortcuts}
          onBatchMove={batchMoveShortcuts}
          onNewGroupFrom={requestNewGroup}
          tags={tags}
          activeTag={activeTag}
          onTag={setActiveTag}
          onDetail={setDetail}
        />

        {!minimal && (
          <WidgetPanel
            order={widgetOrder}
            isVisible={widgetVisible}
            editMode={editMode}
            onToggle={toggleWidget}
            onMove={moveWidget}
            onMoveTo={moveWidgetTo}
            collapsedWidgets={collapsedWidgets}
            onToggleCollapse={toggleWidgetCollapsed}
            weather={weather}
            city={city}
            cityEditing={cityEditing}
            cityDraft={cityDraft}
            onCityDraft={setCityDraft}
            onCityStart={() => {
              setCityDraft(city);
              setCityEditing(true);
            }}
            onCitySave={saveCity}
            onCityCancel={() => setCityEditing(false)}
            onLocate={() => void locateCity()}
            locating={locating}
            onWeatherRefresh={() => void refreshWeather()}
            weatherAt={weatherAt}
            weatherUnit={weatherUnit}
            onWeatherUnit={toggleWeatherUnit}
            pomodoro={{
              ...pomodoro,
              onToggle: pomodoroActions.toggle,
              onReset: pomodoroActions.reset,
              onPhase: pomodoroActions.setPhase
            }}
            notes={notes}
            onNotes={updateNotes}
            onNotesClear={clearNotes}
            todos={todos}
            todoDraft={todoDraft}
            onTodoDraft={setTodoDraft}
            onTodoAdd={addTodo}
            onTodoToggle={(id) =>
              void persistTodos(
                todos.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
              )
            }
            onTodoRemove={removeTodo}
            onTodoClearDone={clearDoneTodos}
            onTodoReorder={reorderTodos}
            hot={hot}
            hotLoading={hotLoading}
            onHotRefresh={() => void refreshHot()}
            recent={recent}
            history={history}
            onOpenLibrary={onOpenLibrary}
            onOpenHistory={onOpenHistory}
            onNavigate={(url) => {
              onClose();
              onNavigate(url);
            }}
          />
        )}

        {notice && (
          <div className="start-toast" role="status">
            <span>{notice.text}</span>
            {notice.undo && (
              <button
                className="start-toast-undo"
                onClick={() => {
                  const undo = notice.undo;
                  setNotice(null);
                  undo?.();
                }}
              >
                撤销
              </button>
            )}
          </div>
        )}

        <footer className="start-footnote">
          <span className="start-footnote-text">
            {editMode
              ? '编辑中：拖动卡片可排序或换组，✎ 改名，× 删除'
              : '拖动卡片 / 小组件排序 · 拖到分组标签归组 · 右键更多 · Ctrl/⌘+K 指令面板'}
          </span>
          {editMode && shortcutBackup.length > shortcuts.length && (
            <button className="start-foot-link" onClick={() => void persistShortcuts(shortcutBackup)}>
              恢复上次备份（{shortcutBackup.length}）
            </button>
          )}
          <button
            className="start-foot-link"
            onClick={() => void syncStartToFolder()}
            disabled={busy}
            title="写入设置里的同步文件夹"
          >
            同步到文件夹
          </button>
          <button
            className="start-foot-link"
            onClick={() => void syncStartFromFolder()}
            disabled={busy}
            title="从设置里的同步文件夹读取"
          >
            从文件夹恢复
          </button>
          <button
            className="start-foot-link"
            onClick={async () => {
              setBusy(true);
              await window.bsub.exportSettings();
              setBusy(false);
            }}
            disabled={busy}
          >
            导出设置
          </button>
          <button
            className="start-foot-link"
            onClick={async () => {
              setBusy(true);
              const result = await window.bsub.importSettings();
              if (result.ok) {
                const snapshot = await window.bsub.getSettings();
                if (snapshot.ok) {
                  applySettings(
                    snapshot.data.settings.general as unknown as Record<string, unknown>
                  );
                }
              }
              setBusy(false);
            }}
            disabled={busy}
          >
            导入设置
          </button>
        </footer>
      </main>

      {!minimal && (
        <Dock
          shortcuts={dockShortcuts}
          onReorder={reorderDock}
          onMenu={(item, x, y) => setShortcutMenu({ x, y, id: item.id })}
          builtIn={builtIn}
          weather={weather}
          pomodoro={{
            phase: pomodoro.phase,
            left: pomodoro.left,
            running: pomodoro.running,
            onToggle: pomodoroActions.toggle
          }}
          zen={minimal}
          onOpenShortcut={openShortcut}
          onBuiltIn={(entry) => entry.run()}
          onPalette={() => setPaletteOpen(true)}
          onZen={() => toggleMinimal(!minimal)}
        />
      )}

      <WallpaperDrawer
        open={wallpaperOpen}
        wallpaper={wallpaper}
        wallpaperImage={wallpaperImage}
        wallpaperMedia={wallpaperMedia}
        wallpaperPreview={wallpaperPreview}
        wallpaperPreviewKind={wallpaperPreviewKind}
        bingGallery={bingGallery}
        bingGalleryState={bingGalleryState}
        gallerySource={gallerySource}
        onGallerySource={changeGallerySource}
        onRetryBingGallery={retryBingGallery}
        bingSelection={bingSelection}
        onPickBing={pickBingImage}
        onResetBing={resetBingImage}
        bingFavorites={bingFavorites}
        onToggleBingFavorite={toggleBingFavorite}
        rotateMinutes={rotateMinutes}
        onRotateMinutes={changeRotateMinutes}
        inkMode={inkMode}
        onInkMode={changeInkMode}
        clock={clock}
        onClock={changeClock}
        searchSuggest={searchSuggestOn}
        onSearchSuggest={changeSearchSuggest}
        autoSync={autoSync}
        onAutoSync={changeAutoSync}
        searchHistoryCount={searchHistory.length}
        onClearSearchHistory={clearSearchHistory}
        bingWallpaper={bingWallpaper}
        blur={effect.blur}
        dim={effect.dim}
        minimal={minimal}
        onPick={pickWallpaper}
        onUpload={applyWallpaperFile}
        onUploadUrl={applyWallpaperUrl}
        onClear={clearCustomWallpaper}
        onBlur={(value) => updateEffect({ ...effect, blur: value })}
        onDim={(value) => updateEffect({ ...effect, dim: value })}
        onMinimal={toggleMinimal}
        onClose={() => setWallpaperOpen(false)}
      />

      {onboarding && (
        <aside className="start-onboarding" aria-label="起始页提示">
          <div className="start-onboarding-title">起始页快捷操作</div>
          <ul>
            <li>
              <kbd>Ctrl/⌘ + K</kbd> 打开指令面板
            </li>
            <li>
              <kbd>E</kbd> 进入编辑模式
            </li>
            <li>右键卡片查看更多操作</li>
          </ul>
          <button className="start-onboarding-go" onClick={dismissOnboarding}>
            开始使用
          </button>
        </aside>
      )}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        buildQueryCommands={(value) => buildStartQueryCommands(value, engineLabel, commitSearch)}
        onClose={() => setPaletteOpen(false)}
      />

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importStart(file);
        }}
      />
      <input
        ref={bookmarkRef}
        type="file"
        accept=".html,text/html"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importBookmarks(file);
        }}
      />

      <GroupNameDialog
        open={groupDialogOpen}
        onCancel={() => {
          setGroupDialogOpen(false);
          setGroupSeed(null);
        }}
        onSubmit={createGroup}
      />

      <BatchAddDialog
        open={batchOpen}
        groups={groupNames}
        defaultGroup={activeGroup === '全部' ? '常用' : activeGroup}
        onCancel={() => setBatchOpen(false)}
        onAdd={addShortcuts}
      />

      {detail && (
        <ShortcutDetail
          item={detail}
          usage={usage[detail.id] || 0}
          onOpen={(item) => {
            setDetail(null);
            openShortcut(item);
          }}
          onEdit={(item) => {
            setDetail(null);
            openEditor(item);
          }}
          onCopy={(url) => {
            void navigator.clipboard?.writeText(url).then(
              () => showNotice('链接已复制'),
              () => showNotice('复制失败')
            );
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {editing && (
        <ShortcutDialog
          draft={editing}
          groups={Array.from(new Set([...groups.map(([group]) => group), '常用', '学习', '工具']))}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={saveShortcut}
        />
      )}

      {shortcutMenu && menuItem && (
        <div
          ref={menuRef}
          className="start-menu"
          role="menu"
          style={{ left: shortcutMenu.x, top: shortcutMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              setShortcutMenu(null);
              openShortcut(menuItem);
            }}
          >
            打开
          </button>
          <button
            onClick={() => {
              setShortcutMenu(null);
              setDetail(menuItem);
            }}
          >
            <Info size={12} /> 详情
          </button>
          <button
            onClick={() => {
              const id = menuItem.id;
              setShortcutMenu(null);
              toggleDockShortcut(id);
            }}
          >
            <Pin size={12} /> {dockIds.includes(menuItem.id) ? '取消固定' : '固定到 Dock'}
          </button>
          <button
            onClick={() => {
              setShortcutMenu(null);
              void navigator.clipboard?.writeText(menuItem.url).then(
                () => showNotice('链接已复制'),
                () => showNotice('复制失败')
              );
            }}
          >
            <Copy size={12} /> 复制链接
          </button>
          <button
            onClick={() => {
              setShortcutMenu(null);
              openEditor(menuItem);
            }}
          >
            <Pencil size={12} /> 编辑
          </button>
          <button
            className="is-danger"
            onClick={() => {
              removeShortcut(menuItem.id);
              setShortcutMenu(null);
            }}
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      )}

    </div>
  );
}