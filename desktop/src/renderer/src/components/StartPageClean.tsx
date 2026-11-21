import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { X } from 'lucide-react';
import type { AppSettings, LibraryVideo, StartShortcut, TabInfo } from '../../../shared/types';
import {
  buildSearchUrl,
  isSearchEngineId,
  searchEngineLabel,
  type SearchEngineId
} from '../../../shared/searchEngines';
import {
  buildStartBackup,
  greeting,
  hostOf,
  normalizeUrl,
  parseStartBackup,
  type Weather
} from './start/model';
import { parseBookmarksHtml } from './start/bookmarks';
import { SiteIcon } from './start/SiteIcon';
import { StartPageGroupFolderManager } from './StartPageGroupFolderManager';
import { StartPageLinks } from './StartPageLinks';
import { StartPageAppearanceSettings } from './StartPageAppearanceSettings';
import { StartPageShortcutDialog } from './StartPageShortcutDialog';
import { StartPageShortcutList } from './StartPageShortcutList';
import { StartPageWidgetSettings } from './StartPageWidgetSettings';
import {
  StartPageNotesWidget,
  StartPagePomodoroWidget,
  StartPageTodoWidget
} from './StartPageSmallWidgets';
import { StartPageClock, StartPageTopbar } from './StartPageHeader';
import { StartPageSearch } from './StartPageSearch';
import { StartPageMainWidgets } from './StartPageMainWidgets';
import { StartPageContextMenu } from './StartPageContextMenu';
import {
  StartPageOpenLinks,
  StartPageSettingsTabs
} from './StartPageSettingsHeader';
import {
  StartPageBackupSettings,
  StartPageSearchSettings
} from './StartPageSettingsSmall';
import { pomodoroActions, usePomodoro } from './start/pomodoroStore';

type General = AppSettings['general'];

export interface StartPageCleanProps {
  onNavigate: (input: string) => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onOpenDownloads: () => void;
  onOpenGlobalSearch: () => void;
  onOpenCommandPalette: () => void;
  onClose: () => void;
}

const WALLPAPERS: Array<{ id: NonNullable<General['startWallpaper']>; label: string }> = [
  { id: 'aurora', label: '极光' },
  { id: 'midnight', label: '夜空' },
  { id: 'paper', label: '纸白' },
  { id: 'mint', label: '薄荷' },
  { id: 'peach', label: '蜜桃' }
];

const NOTES_KEY = 'start-clean-notes';
const SHOW_NOTES_KEY = 'start-clean-show-notes';
const RECENT_KEY = 'start-clean-recent';
const TABS_KEY = 'start-clean-tabs';
const TODO_KEY = 'start-clean-todo';
const POMODORO_KEY = 'start-clean-pomodoro-widget';
const QUOTE_KEY = 'start-clean-quote';
const LABELS_KEY = 'start-clean-labels';
const ICON_SIZE_KEY = 'start-clean-icon-size';
const SECONDS_KEY = 'start-clean-seconds';
const TODOS_KEY = 'start-clean-todos';
const DIM_KEY = 'start-clean-dim';
const HISTORY_KEY = 'start-search-history';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

const QUOTES = [
  '慢慢来，比较快。',
  '先把事情做完，再把它做好。',
  '专注不是做更多，而是少做一点。',
  '今天只推进一件最重要的事。',
  '把复杂的事拆成下一步。',
  '留一点空白给意外的好主意。'
];

function readTodos(): TodoItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TODOS_KEY) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter((item) => item && typeof item.text === 'string')
          .slice(0, 50)
          .map((item) => ({
            id: String(item.id || Math.random().toString(36).slice(2)),
            text: String(item.text).slice(0, 120),
            done: item.done === true
          }))
      : [];
  } catch {
    return [];
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw !== '0';
  } catch {
    return fallback;
  }
}

function readDim(): number {
  try {
    const value = Number(localStorage.getItem(DIM_KEY));
    return Number.isFinite(value) && value >= 0 && value <= 0.8 ? value : 0.2;
  } catch {
    return 0.2;
  }
}

function readNotes(): string {
  try {
    return localStorage.getItem(NOTES_KEY) || '';
  } catch {
    return '';
  }
}

function readHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sc-${Date.now().toString(36)}`;
  }
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('不是有效的图片'));
      image.onload = () => {
        const max = 1920;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(String(reader.result || ''));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/** 起始页：极简时钟 + 搜索 + 快捷访问，低频设置全部收进右侧抽屉。 */
export function StartPageClean({
  onNavigate,
  onOpenLibrary,
  onOpenHistory,
  onOpenTasks,
  onOpenSettings,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenGlobalSearch,
  onOpenCommandPalette,
  onClose
}: StartPageCleanProps) {
  const [general, setGeneral] = useState<General | null>(null);
  const [cityDraft, setCityDraft] = useState('上海');
  const [shortcuts, setShortcuts] = useState<StartShortcut[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [engine, setEngine] = useState<SearchEngineId>('bing');
  const [engineOpen, setEngineOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [history, setHistory] = useState<string[]>(readHistory);
  const [group, setGroup] = useState('全部');
  const [folderFilter, setFolderFilter] = useState<{
    group: string;
    name: string;
  } | null>(null);
  const [groupEdit, setGroupEdit] = useState<{ from: string; to: string } | null>(null);
  const [folderEdit, setFolderEdit] = useState<{
    group: string;
    from: string;
    to: string;
  } | null>(null);
  const [folderDraft, setFolderDraft] = useState<{ group: string; name: string } | null>(
    null
  );
  const [weather, setWeather] = useState<Weather | null>(null);
  const [hot, setHot] = useState<string[]>([]);
  const [recent, setRecent] = useState<LibraryVideo[]>([]);
  const [notes, setNotes] = useState(readNotes);
  const [showRecent, setShowRecent] = useState(() => readBool(RECENT_KEY, true));
  const [showNotes, setShowNotes] = useState(() => readBool(SHOW_NOTES_KEY, false));
  const [showTabs, setShowTabs] = useState(() => readBool(TABS_KEY, false));
  const [showTodo, setShowTodo] = useState(() => readBool(TODO_KEY, false));
  const [showPomodoro, setShowPomodoro] = useState(() => readBool(POMODORO_KEY, false));
  const [showQuote, setShowQuote] = useState(() => readBool(QUOTE_KEY, false));
  const [labels, setLabels] = useState(() => readBool(LABELS_KEY, true));
  const [iconSize, setIconSize] = useState<'small' | 'medium' | 'large'>(() => {
    const raw = localStorage.getItem(ICON_SIZE_KEY);
    return raw === 'small' || raw === 'large' ? raw : 'medium';
  });
  const [showSeconds, setShowSeconds] = useState(() => readBool(SECONDS_KEY, false));
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>(readTodos);
  const [todoDraft, setTodoDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: StartShortcut;
  } | null>(null);
  const [sheetTab, setSheetTab] = useState<'look' | 'search' | 'links' | 'widgets' | 'data'>('look');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<{
    id?: string;
    label: string;
    url: string;
    group: string;
    folder: string;
  } | null>(null);
  const [dim, setDim] = useState(readDim);
  const [dragState, setDragState] = useState<{
    item: StartShortcut;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<{
    group: string;
    name: string;
  } | null>(null);
  const dropGroupRef = useRef<string | null>(null);
  const dropFolderRef = useRef<{ group: string; name: string } | null>(null);
  const dragRef = useRef<{
    item: StartShortcut;
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const flipRef = useRef<Map<string, { left: number; top: number }> | null>(null);
  const shortcutsRef = useRef<StartShortcut[]>([]);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const noticeTimer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const bookmarkInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const pomodoro = usePomodoro();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (!response.ok) return;
      const next = response.data.settings.general;
      setGeneral(next);
      setShortcuts(Array.isArray(next.startShortcuts) ? next.startShortcuts : []);
      setEngine(isSearchEngineId(next.searchEngine) ? next.searchEngine : 'bing');
      setCityDraft(String(next.startCity || '上海'));
    });
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setRecent(response.data.videos.slice(0, 5));
    });
  }, []);

  const city = String(general?.startCity || '上海');
  const weatherOn = general?.startWeather !== false;
  const hotOn = general?.startHotSearch !== false;

  useEffect(() => {
    if (!weatherOn) return;
    let alive = true;
    void window.bsub.startWeather(city, false).then((response) => {
      if (alive && response.ok) setWeather(response.data);
    });
    return () => {
      alive = false;
    };
  }, [weatherOn, city]);

  useEffect(() => {
    if (!hotOn) return;
    let alive = true;
    void window.bsub.startHotSearch().then((response) => {
      if (alive && response.ok) setHot(response.data.slice(0, 6));
    });
    return () => {
      alive = false;
    };
  }, [hotOn]);

  useEffect(() => {
    if (!showTabs) return;
    void window.bsub.listTabs().then((items) => setTabs(items.slice(0, 6)));
  }, [showTabs]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  useEffect(() => {
    if (!engineOpen) return;
    const close = (event: MouseEvent) => {
      if (searchWrapRef.current && event.target instanceof Node && searchWrapRef.current.contains(event.target)) {
        return;
      }
      setEngineOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [engineOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (event.key === 'Escape') {
        if (sheetOpen) {
          setSheetOpen(false);
          return;
        }
        if (draft) {
          setDraft(null);
          return;
        }
        if (suggestOpen) {
          setSuggestOpen(false);
          return;
        }
        onClose();
        return;
      }

      if (editing || sheetOpen || draft) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        searchRef.current?.focus();
        setQuery(event.key);
        setSuggestOpen(true);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, draft, suggestOpen, onClose]);

  useEffect(() => {
    if (!suggestOpen) return;
    const close = (event: MouseEvent) => {
      if (
        searchWrapRef.current &&
        event.target instanceof Node &&
        searchWrapRef.current.contains(event.target)
      ) {
        return;
      }
      setSuggestOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [suggestOpen]);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const groups = useMemo(() => {
    const order = general?.startGroupOrder || [];
    const rank = (name: string) => {
      const index = order.indexOf(name);
      return index < 0 ? order.length : index;
    };
    return Array.from(
      new Set(shortcuts.map((item) => String(item.group || '').trim()).filter(Boolean))
    )
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8);
  }, [shortcuts, general?.startGroupOrder]);

  const groupShortcuts = useMemo(
    () => (group === '全部' ? shortcuts : shortcuts.filter((item) => item.group === group)),
    [shortcuts, group]
  );

  const folderEntries = useMemo(() => {
    const map = new Map<
      string,
      { key: string; group: string; name: string; count: number }
    >();
    for (const item of shortcuts) {
      const name = String(item.folder || '').trim();
      if (!name) continue;
      const groupName = String(item.group || '').trim();
      const key = `${groupName}\u0000${name}`;
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { key, group: groupName, name, count: 1 });
    }
    for (const folder of general?.startFolders || []) {
      const groupName = String(folder.group || '').trim();
      const name = String(folder.name || '').trim();
      if (!name) continue;
      const key = `${groupName}\u0000${name}`;
      if (!map.has(key)) map.set(key, { key, group: groupName, name, count: 0 });
    }
    const order = general?.startFolderOrder || [];
    const rank = (key: string) => {
      const index = order.indexOf(key);
      return index < 0 ? order.length : index;
    };
    return Array.from(map.values())
      .sort((a, b) => rank(a.key) - rank(b.key))
      .slice(0, 40);
  }, [shortcuts, general?.startFolders, general?.startFolderOrder]);

  const folders = useMemo(
    () =>
      folderEntries
        .filter((entry) => group === '全部' || entry.group === group)
        .map((entry) => ({
          ...entry,
          items: shortcuts.filter(
            (item) =>
              String(item.group || '').trim() === entry.group &&
              String(item.folder || '').trim() === entry.name
          )
        }))
        .slice(0, 24),
    [folderEntries, group, shortcuts]
  );

  const visible = useMemo(
    () =>
      folderFilter
        ? groupShortcuts.filter(
            (item) =>
              String(item.group || '').trim() === folderFilter.group &&
              String(item.folder || '').trim() === folderFilter.name
          )
        : groupShortcuts.filter((item) => !String(item.folder || '').trim()),
    [groupShortcuts, folderFilter]
  );

  const suggestions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const items: Array<{ id: string; kind: 'shortcut' | 'history' | 'search'; label: string; url?: string }> = [];
    if (!keyword) {
      for (const item of history.slice(0, 5)) {
        items.push({ id: `h-${item}`, kind: 'history', label: item });
      }
      return items;
    }
    for (const item of shortcuts) {
      if (
        item.label.toLowerCase().includes(keyword) ||
        item.url.toLowerCase().includes(keyword)
      ) {
        items.push({
          id: `s-${item.id}`,
          kind: 'shortcut',
          label: item.label,
          url: item.url
        });
      }
      if (items.length >= 5) break;
    }
    for (const item of history) {
      if (item.toLowerCase().includes(keyword) && items.length < 6) {
        items.push({ id: `h-${item}`, kind: 'history', label: item });
      }
    }
    items.push({
      id: 'search',
      kind: 'search',
      label: `用 ${searchEngineLabel(engine)} 搜索“${query.trim()}”`
    });
    return items.slice(0, 7);
  }, [query, shortcuts, history, engine]);

  const patchGeneral = async (patch: Partial<General>) => {
    const current = await window.bsub.getSettings();
    if (!current.ok) return;
    const next: AppSettings = {
      ...current.data.settings,
      general: { ...current.data.settings.general, ...patch }
    };
    const saved = await window.bsub.saveSettings(next);
    if (saved.ok) setGeneral(saved.data.settings.general);
  };

  const persistShortcuts = async (next: StartShortcut[]) => {
    setShortcuts(next);
    await patchGeneral({ startShortcuts: next });
  };

  const setFlag = (key: string, setter: (value: boolean) => void, value: boolean) => {
    setter(value);
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const writeTodos = (next: TodoItem[]) => {
    setTodos(next);
    try {
      localStorage.setItem(TODOS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const addTodo = () => {
    const text = todoDraft.trim();
    if (!text) return;
    writeTodos([...todos, { id: newId(), text, done: false }]);
    setTodoDraft('');
  };

  const openShortcut = (item: StartShortcut) => {
    onClose();
    onNavigate(item.url);
  };

  const importBookmarks = async (file: File) => {
    const parsed = parseBookmarksHtml(await file.text());
    if (!parsed.shortcuts.length) {
      showNotice('没有从书签文件里找到可用网址');
      return;
    }
    const seen = new Set(shortcuts.map((item) => item.url.toLowerCase()));
    const merged = [
      ...shortcuts,
      ...parsed.shortcuts
        .filter((item) => !seen.has(item.url.toLowerCase()))
        .map((item) => ({ ...item, id: newId() }))
    ];
    await persistShortcuts(merged);
    showNotice(
      `已导入 ${merged.length - shortcuts.length} 个书签${
        parsed.folders ? `，涉及 ${parsed.folders} 个分组/文件夹` : ''
      }`
    );
  };

  const exportBackup = () => {
    const backup = buildStartBackup({
      shortcuts,
      wallpaper,
      wallpaperImage: String(general?.startWallpaperImage || ''),
      effect: { blur: 0, dim },
      engine,
      city,
      weatherOn,
      hotOn,
      notes
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'shizi-start-backup.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice('起始页备份已导出');
  };

  const importBackup = async (file: File) => {
    const parsed = parseStartBackup(await file.text());
    if (!parsed.ok) {
      showNotice(parsed.error);
      return;
    }
    const prefs = parsed.data.prefs;
    await persistShortcuts(parsed.data.shortcuts);
    if (prefs.wallpaper || prefs.engine || prefs.city) {
      await patchGeneral({
        ...(prefs.wallpaper ? { startWallpaper: prefs.wallpaper as General['startWallpaper'] } : {}),
        ...(prefs.engine && isSearchEngineId(prefs.engine) ? { searchEngine: prefs.engine } : {}),
        ...(prefs.city ? { startCity: prefs.city } : {})
      });
    }
    if (prefs.engine && isSearchEngineId(prefs.engine)) setEngine(prefs.engine);
    if (prefs.city) setCityDraft(prefs.city);
    showNotice(`已恢复 ${parsed.data.shortcuts.length} 个快捷方式`);
  };

  const uploadWallpaper = async (file: File) => {
    try {
      const image = await readImage(file);
      setGeneral((current) =>
        current ? { ...current, startWallpaperImage: image } : current
      );
      await patchGeneral({ startWallpaperImage: image });
      showNotice('背景已更新');
    } catch (error) {
      showNotice((error as Error).message || '背景更新失败');
    }
  };

  const submitSearch = (value?: string) => {
    const text = String(value ?? query).trim();
    if (!text) return;
    const nextHistory = [text, ...history.filter((item) => item !== text)].slice(0, 8);
    setHistory(nextHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      // ignore
    }
    onClose();
    onNavigate(buildSearchUrl(engine, text, general?.searchEngineCustom || ''));
  };

  const pickSuggestion = (item: { kind: string; label: string; url?: string }) => {
    if (item.kind === 'shortcut' && item.url) {
      onClose();
      onNavigate(item.url);
      return;
    }
    submitSearch(item.label);
  };

  const saveDraft = () => {
    if (!draft) return;
    const url = normalizeUrl(draft.url);
    if (!url) return;
    const label = draft.label.trim() || hostOf(url) || url;
    const groupName = draft.group.trim();
    const folderName = draft.folder.trim();
    if (draft.id) {
      void persistShortcuts(
        shortcuts.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                label,
                url,
                group: groupName || undefined,
                folder: folderName || undefined
              }
            : item
        )
      );
    } else {
      void persistShortcuts([
        ...shortcuts,
        {
          id: newId(),
          label,
          url,
          group: groupName || undefined,
          folder: folderName || undefined
        }
      ]);
    }
    setDraft(null);
  };

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === 'add') {
        setDraft({ label: '', url: '', group: '', folder: '' });
      } else if (detail === 'customize') {
        setSheetOpen(true);
      } else if (detail === 'close') {
        onClose();
      }
    };
    window.addEventListener('shizi:start-command', onCommand);
    return () => window.removeEventListener('shizi:start-command', onCommand);
  }, [onClose]);

  const showNotice = (text: string, undo?: () => void) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ text, undo });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  };

  const commitGroupRename = () => {
    if (!groupEdit) return;
    const from = groupEdit.from;
    const to = groupEdit.to.trim();
    if (!to || to === from) {
      setGroupEdit(null);
      return;
    }
    if (groups.includes(to)) {
      showNotice(`已存在分组“${to}”`);
      return;
    }
    void persistShortcuts(
      shortcuts.map((item) =>
        item.group === from ? { ...item, group: to } : item
      )
    );
    if (group === from) setGroup(to);
    setGroupEdit(null);
    showNotice(`已重命名为“${to}”`);
  };

  const removeGroup = (name: string) => {
    const previous = shortcuts;
    void persistShortcuts(
      shortcuts.map((item) =>
        item.group === name ? { ...item, group: undefined } : item
      )
    );
    if (group === name) setGroup('全部');
    if (groupEdit?.from === name) setGroupEdit(null);
    showNotice(`已删除分组“${name}”`, () => {
      void persistShortcuts(previous);
      setNotice(null);
    });
  };

  const createFolder = async () => {
    if (!folderDraft) return;
    const groupName = folderDraft.group.trim();
    const name = folderDraft.name.trim();
    if (!name) return;
    if (
      folderEntries.some(
        (entry) => entry.group === groupName && entry.name === name
      )
    ) {
      showNotice(`已存在文件夹“${name}”`);
      return;
    }
    const next = [
      ...(general?.startFolders || []),
      { group: groupName, name }
    ].slice(0, 200);
    await patchGeneral({ startFolders: next });
    setFolderDraft(null);
    showNotice(`已创建文件夹“${name}”`);
  };

  const commitFolderRename = () => {
    if (!folderEdit) return;
    const { group: groupName, from } = folderEdit;
    const to = folderEdit.to.trim();
    if (!to || to === from) {
      setFolderEdit(null);
      return;
    }
    if (
      folderEntries.some((entry) => entry.group === groupName && entry.name === to)
    ) {
      showNotice(`已存在文件夹“${to}”`);
      return;
    }
    void persistShortcuts(
      shortcuts.map((item) =>
        String(item.group || '') === groupName &&
        String(item.folder || '') === from
          ? { ...item, folder: to }
          : item
      )
    );
    if (
      (general?.startFolders || []).some(
        (entry) =>
          String(entry.group || '') === groupName && entry.name === from
      )
    ) {
      void patchGeneral({
        startFolders: (general?.startFolders || []).map((entry) =>
          String(entry.group || '') === groupName && entry.name === from
            ? { ...entry, name: to }
            : entry
        )
      });
    }
    if (folderFilter?.group === groupName && folderFilter.name === from) {
      setFolderFilter({ group: groupName, name: to });
    }
    setFolderEdit(null);
    showNotice(`已重命名为“${to}”`);
  };

  const removeFolder = (groupName: string, name: string) => {
    const previous = shortcuts;
    void persistShortcuts(
      shortcuts.map((item) =>
        String(item.group || '') === groupName &&
        String(item.folder || '') === name
          ? { ...item, folder: undefined }
          : item
      )
    );
    if (
      (general?.startFolders || []).some(
        (entry) =>
          String(entry.group || '') === groupName && entry.name === name
      )
    ) {
      void patchGeneral({
        startFolders: (general?.startFolders || []).filter(
          (entry) =>
            !(
              String(entry.group || '') === groupName && entry.name === name
            )
        )
      });
    }
    if (folderFilter?.group === groupName && folderFilter.name === name) {
      setFolderFilter(null);
    }
    if (folderEdit?.group === groupName && folderEdit.from === name) {
      setFolderEdit(null);
    }
    showNotice(`已删除文件夹“${name}”`, () => {
      void persistShortcuts(previous);
      setNotice(null);
    });
  };

  const moveBefore = (list: string[], from: string, to: string): string[] => {
    const source = list.indexOf(from);
    const target = list.indexOf(to);
    if (source < 0 || target < 0 || source === target) return list;
    const next = [...list];
    next.splice(target, 0, next.splice(source, 1)[0]);
    return next;
  };

  const reorderGroup = (from: string, to: string) => {
    const current = groups.includes(from) ? groups : [from, ...groups];
    const next = moveBefore(current, from, to);
    if (next === current) return;
    void patchGeneral({ startGroupOrder: next });
  };

  const reorderFolder = (from: string, to: string) => {
    const allKeys = folderEntries.map((entry) => entry.key);
    const base = [
      ...(general?.startFolderOrder || []).filter((key) => allKeys.includes(key)),
      ...allKeys.filter((key) => !(general?.startFolderOrder || []).includes(key))
    ];
    const next = moveBefore(base, from, to);
    if (next === base) return;
    void patchGeneral({ startFolderOrder: next });
  };

  const removeShortcut = (item: StartShortcut) => {
    const previous = shortcuts;
    const next = shortcuts.filter((entry) => entry.id !== item.id);
    void persistShortcuts(next);
    showNotice(`已删除“${item.label}”`, () => {
      void persistShortcuts(previous);
      setNotice(null);
    });
  };

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const reorderLinks = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    const list = shortcutsRef.current;
    const from = list.findIndex((item) => item.id === fromId);
    const to = list.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0 || from === to) return;

    const first = new Map<string, { left: number; top: number }>();
    for (const node of document.querySelectorAll<HTMLElement>('.sc-link-wrap[data-link-id]')) {
      const id = node.dataset.linkId;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      first.set(id, { left: rect.left, top: rect.top });
    }
    flipRef.current = first;

    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    shortcutsRef.current = next;
    setShortcuts(next);
  };

  useLayoutEffect(() => {
    const first = flipRef.current;
    if (!first) return;
    flipRef.current = null;
    const nodes = document.querySelectorAll<HTMLElement>('.sc-link-wrap[data-link-id]');
    nodes.forEach((node) => {
      const id = node.dataset.linkId;
      const before = id ? first.get(id) : undefined;
      if (!before) return;
      const after = node.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        node.style.transform = '';
      });
    });
  }, [shortcuts]);

  function cleanDragListeners() {
    window.removeEventListener('pointermove', onLinkDragMove);
    window.removeEventListener('pointerup', onLinkDragEnd);
    window.removeEventListener('pointercancel', onLinkDragEnd);
    document.body.classList.remove('sc-dragging');
  }

  function onLinkDragMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < 6) return;
    if (!drag.active) {
      drag.active = true;
      document.body.classList.add('sc-dragging');
    }
    event.preventDefault();
    setDragState({
      item: drag.item,
      x: event.clientX,
      y: event.clientY,
      offsetX: drag.offsetX,
      offsetY: drag.offsetY
    });

    const main = document.querySelector<HTMLElement>('.sc-main');
    if (main) {
      if (event.clientY < 96) main.scrollTop -= 14;
      else if (event.clientY > window.innerHeight - 96) main.scrollTop += 14;
    }

    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const groupButton = element?.closest<HTMLElement>('.sc-groups button[data-group]');
    const nextGroup = groupButton?.dataset.group || null;
    const folderButton = element?.closest<HTMLElement>('.sc-folder[data-folder]');
    const nextFolder = folderButton
      ? {
          group: folderButton.dataset.group || '',
          name: folderButton.dataset.folder || ''
        }
      : null;
    dropGroupRef.current = nextFolder ? null : nextGroup;
    dropFolderRef.current = nextFolder;
    setDropGroup(nextFolder ? null : nextGroup);
    setDropFolder(nextFolder);

    const wrap = element?.closest<HTMLElement>('.sc-link-wrap[data-link-id]');
    const targetId = wrap?.dataset.linkId;
    if (targetId && targetId !== drag.item.id) reorderLinks(drag.item.id, targetId);
  }

  function onLinkDragEnd(event: PointerEvent) {
    const drag = dragRef.current;
    cleanDragListeners();
    dragRef.current = null;
    if (!drag) return;
    if (!drag.active) return;

    suppressClickRef.current = true;
    const group = dropGroupRef.current;
    const folder = dropFolderRef.current;
    if (
      folder &&
      (folder.name !== (drag.item.folder || '') ||
        folder.group !== String(drag.item.group || '').trim())
    ) {
      const next = shortcutsRef.current.map((item) =>
        item.id === drag.item.id
          ? { ...item, folder: folder.name, group: folder.group || undefined }
          : item
      );
      shortcutsRef.current = next;
      setShortcuts(next);
      void persistShortcuts(next);
      showNotice(`已移入文件夹“${folder.name}”`);
    } else if (group && group !== (drag.item.group || '')) {
      const next = shortcutsRef.current.map((item) =>
        item.id === drag.item.id ? { ...item, group, folder: undefined } : item
      );
      shortcutsRef.current = next;
      setShortcuts(next);
      void persistShortcuts(next);
      showNotice(`已移动到“${group}”`);
    } else {
      void persistShortcuts(shortcutsRef.current);
    }
    setDragState(null);
    setDropGroup(null);
    setDropFolder(null);
    dropGroupRef.current = null;
    dropFolderRef.current = null;
    if (event.type === 'pointercancel') suppressClickRef.current = false;
  }

  function startLinkDrag(event: ReactPointerEvent<HTMLButtonElement>, item: StartShortcut) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.sc-link-actions')) return;
    const wrap = event.currentTarget.closest<HTMLElement>('.sc-link-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    dragRef.current = {
      item,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    window.addEventListener('pointermove', onLinkDragMove, { passive: false });
    window.addEventListener('pointerup', onLinkDragEnd, { once: true });
    window.addEventListener('pointercancel', onLinkDragEnd, { once: true });
  }

  const dark =
    window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
  const wallpaper = String(general?.startWallpaper || 'aurora');
  const customWallpaper =
    general?.startWallpaperMedia?.url || general?.startWallpaperImage || '';
  const time = showSeconds
    ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateText = now.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });

  return (
    <div
      className={`start-page start-clean start-clean-${dark ? 'dark' : 'light'} start-clean-wall-${wallpaper} sc-size-${iconSize}${labels ? '' : ' sc-hide-labels'}`}
      style={
        {
          '--sc-dim': dim,
          ...(customWallpaper ? { '--sc-custom-wall': `url("${customWallpaper}")` } : {})
        } as CSSProperties
      }
    >
      <div className="sc-background" aria-hidden />
      <div className="sc-veil" aria-hidden />

      <input
        ref={bookmarkInputRef}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importBookmarks(file);
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importBackup(file);
        }}
      />
      <input
        ref={wallpaperInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadWallpaper(file);
        }}
      />

      <StartPageTopbar
        weatherOn={weatherOn}
        weather={weather}
        city={city}
        onCommand={onOpenCommandPalette}
        onSettings={() => setSheetOpen(true)}
        onClose={onClose}
      />

      <main className="sc-main">
        <section className="sc-hero">
          <StartPageClock time={time} greeting={greeting(now)} dateText={dateText} />

          <StartPageSearch
            engine={engine}
            engineOpen={engineOpen}
            query={query}
            suggestOpen={suggestOpen}
            suggestions={suggestions}
            activeSuggestion={activeSuggestion}
            searchRef={searchRef}
            wrapRef={searchWrapRef}
            onEngineToggle={() => setEngineOpen((value) => !value)}
            onEngineSelect={(id) => {
              setEngineOpen(false);
              if (isSearchEngineId(id)) {
                setEngine(id);
                void patchGeneral({ searchEngine: id });
              }
            }}
            onQuery={(value) => {
              setQuery(value);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            onActive={setActiveSuggestion}
            onSubmit={() => submitSearch()}
            onPick={(item) => {
              setSuggestOpen(false);
              pickSuggestion(item);
            }}
            onCloseSuggest={() => setSuggestOpen(false)}
          />
          <div className="sc-groups">
            <button
              type="button"
              className={group === '全部' ? 'is-active' : ''}
              onClick={() => {
                setGroup('全部');
                setFolderFilter(null);
              }}
            >
              全部
            </button>
            {groups.map((item) => (
              <button
                key={item}
                type="button"
                data-group={item}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/sc-group', item);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('text/sc-group')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(event) => {
                  const from = event.dataTransfer.getData('text/sc-group');
                  if (from) {
                    event.preventDefault();
                    reorderGroup(from, item);
                  }
                }}
                className={`${group === item ? 'is-active' : ''}${dropGroup === item ? ' is-drop' : ''}`}
                onClick={() => {
                  setGroup(item);
                  setFolderFilter(null);
                }}
              >
                {item}
              </button>
            ))}
          </div>

          <StartPageLinks
            folders={folders}
            visible={visible}
            group={group}
            folderFilter={folderFilter}
            dropFolder={dropFolder}
            dragItemId={dragState?.item.id}
            suppressClickRef={suppressClickRef}
            onFolderFilter={setFolderFilter}
            onReorderFolder={reorderFolder}
            onOpenShortcut={openShortcut}
            onStartLinkDrag={startLinkDrag}
            onEdit={(item) =>
              setDraft({
                id: item.id,
                label: item.label,
                url: item.url,
                group: item.group || '',
                folder: item.folder || ''
              })
            }
            onRemove={removeShortcut}
            onContextMenu={(x, y, item) => setContextMenu({ x, y, item })}
            onAdd={(folder, currentGroup) =>
              setDraft({
                label: '',
                url: '',
                group: folder?.group || (currentGroup === '全部' ? '' : currentGroup),
                folder: folder?.name || ''
              })
            }
          />
        </section>

        <section className="sc-widgets">
          <StartPageMainWidgets
            hotOn={hotOn}
            hot={hot}
            showRecent={showRecent}
            recent={recent}
            onGlobalSearch={onOpenGlobalSearch}
            onLibrary={onOpenLibrary}
            onClose={onClose}
            onNavigate={onNavigate}
          />
          {showNotes && (
            <StartPageNotesWidget
              value={notes}
              onChange={(value) => {
                setNotes(value);
                try {
                  localStorage.setItem(NOTES_KEY, value);
                } catch {
                  // ignore
                }
              }}
              onHide={() => setShowNotes(false)}
            />
          )}

          {showTodo && (
            <StartPageTodoWidget
              todos={todos}
              draft={todoDraft}
              onDraft={setTodoDraft}
              onAdd={addTodo}
              onToggle={(id) =>
                writeTodos(
                  todos.map((entry) =>
                    entry.id === id ? { ...entry, done: !entry.done } : entry
                  )
                )
              }
              onRemove={(id) => writeTodos(todos.filter((entry) => entry.id !== id))}
            />
          )}

          {showPomodoro && (
            <StartPagePomodoroWidget
              phase={pomodoro.phase}
              left={pomodoro.left}
              running={pomodoro.running}
              onToggle={pomodoroActions.toggle}
              onReset={pomodoroActions.reset}
            />
          )}

          {showTabs && tabs.length > 0 && (
            <article className="sc-card">
              <header>
                <span>打开的标签</span>
                <button type="button" onClick={() => setShowTabs(false)}>
                  隐藏
                </button>
              </header>
              <div className="sc-recent-list">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    onClick={() => {
                      onClose();
                      onNavigate(item.url);
                    }}
                  >
                    <span className="sc-recent-title">{item.title || item.url}</span>
                    <span className="sc-recent-meta">{hostOf(item.url)}</span>
                  </button>
                ))}
              </div>
            </article>
          )}

          {showQuote && (
            <article className="sc-card sc-quote">
              <header>
                <span>今日一句</span>
              </header>
              <p>
                {QUOTES[
                  Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000) %
                    QUOTES.length
                ]}
              </p>
            </article>
          )}
        </section>
      </main>

      {dragState && (
        <div
          className="sc-drag-ghost"
          style={{
            left: dragState.x - dragState.offsetX,
            top: dragState.y - dragState.offsetY
          }}
        >
          <SiteIcon item={dragState.item} />
          <span>{dragState.item.label}</span>
        </div>
      )}

      {contextMenu && (
        <StartPageContextMenu
          menu={contextMenu}
          onOpen={() => {
            setContextMenu(null);
            openShortcut(contextMenu.item);
          }}
          onNewTab={() => {
            setContextMenu(null);
            onClose();
            void window.bsub.newTab(contextMenu.item.url);
          }}
          onCopy={() => {
            setContextMenu(null);
            void window.bsub.writeClipboard(contextMenu.item.url);
            showNotice('链接已复制');
          }}
          onRemoveFolder={() => {
            const target = contextMenu.item;
            setContextMenu(null);
            void persistShortcuts(
              shortcuts.map((item) =>
                item.id === target.id ? { ...item, folder: undefined } : item
              )
            );
            showNotice(`已移出文件夹“${target.folder}”`);
          }}
          onEdit={() => {
            setContextMenu(null);
            setDraft({
              id: contextMenu.item.id,
              label: contextMenu.item.label,
              url: contextMenu.item.url,
              group: contextMenu.item.group || '',
              folder: contextMenu.item.folder || ''
            });
          }}
          onDelete={() => {
            const target = contextMenu.item;
            setContextMenu(null);
            removeShortcut(target);
          }}
        />
      )}
      {notice && (
        <div className="sc-toast" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <button type="button" onClick={notice.undo}>
              撤销
            </button>
          )}
        </div>
      )}

      <footer className="sc-foot">
        <span>Ctrl K 命令 · / 聚焦搜索 · 右键或悬停编辑快捷方式</span>
        <span className={`sc-wall-name`}>{WALLPAPERS.find((item) => item.id === wallpaper)?.label || '自定义'}</span>
      </footer>

      {sheetOpen && (
        <>
          <div className="sc-sheet-mask" onClick={() => setSheetOpen(false)} />
          <aside className="sc-sheet" aria-label="自定义起始页">
            <header>
              <span>自定义起始页</span>
              <button type="button" onClick={() => setSheetOpen(false)}>
                <X size={15} />
              </button>
            </header>

            <StartPageSettingsTabs value={sheetTab} onChange={setSheetTab} />

            {sheetTab === 'look' && (
              <StartPageAppearanceSettings
                wallpapers={WALLPAPERS.map((item) => ({ id: item.id, label: item.label }))}
                wallpaper={wallpaper}
                customWallpaper={Boolean(customWallpaper)}
                dim={dim}
                iconSize={iconSize}
                labels={labels}
                showSeconds={showSeconds}
                onWallpaper={(id) => {
                  const next = id as General['startWallpaper'];
                  setGeneral((current) =>
                    current ? { ...current, startWallpaper: next } : current
                  );
                  void patchGeneral({ startWallpaper: next });
                }}
                onUpload={() => wallpaperInputRef.current?.click()}
                onResetWallpaper={() => {
                  setGeneral((current) =>
                    current ? { ...current, startWallpaperImage: '' } : current
                  );
                  void patchGeneral({ startWallpaperImage: '' });
                }}
                onDim={(value) => {
                  setDim(value);
                  try {
                    localStorage.setItem(DIM_KEY, String(value));
                  } catch {
                    // ignore
                  }
                }}
                onIconSize={(value) => {
                  setIconSize(value);
                  try {
                    localStorage.setItem(ICON_SIZE_KEY, value);
                  } catch {
                    // ignore
                  }
                }}
                onLabels={(value) => setFlag(LABELS_KEY, setLabels, value)}
                onShowSeconds={(value) => setFlag(SECONDS_KEY, setShowSeconds, value)}
              />
            )}

            {sheetTab === 'search' && (
              <StartPageSearchSettings
                engine={engine}
                onChange={(next) => {
                  if (!isSearchEngineId(next)) return;
                  setEngine(next);
                  void patchGeneral({ searchEngine: next });
                }}
                onClearHistory={() => {
                  setHistory([]);
                  try {
                    localStorage.removeItem(HISTORY_KEY);
                  } catch {
                    // ignore
                  }
                  showNotice('搜索历史已清空');
                }}
              />
            )}

            {sheetTab === 'links' && (
              <>
                <StartPageGroupFolderManager
                  groups={groups}
                  shortcuts={shortcuts}
                  currentGroup={group}
                  folderEntries={folderEntries}
                  groupEdit={groupEdit}
                  folderEdit={folderEdit}
                  folderDraft={folderDraft}
                  onGroupEdit={setGroupEdit}
                  onFolderEdit={setFolderEdit}
                  onFolderDraft={setFolderDraft}
                  onCreateFolder={() => void createFolder()}
                  onCommitGroupRename={commitGroupRename}
                  onCommitFolderRename={commitFolderRename}
                  onRemoveGroup={removeGroup}
                  onRemoveFolder={removeFolder}
                />
                <StartPageShortcutList
                  shortcuts={shortcuts}
                  onEdit={(item) =>
                    setDraft({
                      id: item.id,
                      label: item.label,
                      url: item.url,
                      group: item.group || '',
                      folder: item.folder || ''
                    })
                  }
                  onRemove={removeShortcut}
                  onAdd={() => setDraft({ label: '', url: '', group: '', folder: '' })}
                  onImport={() => bookmarkInputRef.current?.click()}
                />
                <StartPageBackupSettings
                  onExport={exportBackup}
                  onImport={() => backupInputRef.current?.click()}
                />
              </>
            )}

            {sheetTab === 'widgets' && (
              <StartPageWidgetSettings
                weatherOn={weatherOn}
                city={cityDraft}
                hotOn={hotOn}
                showRecent={showRecent}
                showTabs={showTabs}
                showNotes={showNotes}
                showTodo={showTodo}
                showPomodoro={showPomodoro}
                showQuote={showQuote}
                onWeather={(value) => void patchGeneral({ startWeather: value })}
                onCity={setCityDraft}
                onCityBlur={() => {
                  const value = cityDraft.trim() || '上海';
                  setCityDraft(value);
                  void patchGeneral({ startCity: value });
                }}
                onHot={(value) => void patchGeneral({ startHotSearch: value })}
                onRecent={(value) => setFlag(RECENT_KEY, setShowRecent, value)}
                onTabs={(value) => setFlag(TABS_KEY, setShowTabs, value)}
                onNotes={(value) => setFlag(SHOW_NOTES_KEY, setShowNotes, value)}
                onTodo={(value) => setFlag(TODO_KEY, setShowTodo, value)}
                onPomodoro={(value) => setFlag(POMODORO_KEY, setShowPomodoro, value)}
                onQuote={(value) => setFlag(QUOTE_KEY, setShowQuote, value)}
              />
            )}

            {sheetTab === 'data' && (
              <StartPageOpenLinks
                onOpenSettings={onOpenSettings}
                onOpenLibrary={onOpenLibrary}
                onOpenHistory={onOpenHistory}
                onOpenBookmarks={onOpenBookmarks}
                onOpenDownloads={onOpenDownloads}
                onOpenTasks={onOpenTasks}
                onOpenGlobalSearch={onOpenGlobalSearch}
              />
            )}
          </aside>
        </>
      )}

      {draft && (
        <StartPageShortcutDialog
          draft={draft}
          groups={groups}
          folders={folders.map((item) => item.name)}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
    </div>
  );
}
