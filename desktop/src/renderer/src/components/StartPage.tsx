import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookOpen,
  CloudSun,
  Download,
  Flame,
  History,
  Library,
  ListChecks,
  MapPin,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { parseReminder, formatReminder } from '../../../shared/reminder';
import {
  SEARCH_ENGINES,
  searchEngineLabel,
  type SearchEngineId
} from '../../../shared/searchEngines';
import type {
  HistoryEntry,
  LibraryVideo,
  PetTodo,
  StartShortcut
} from '../../../shared/types';

type WallpaperId = 'aurora' | 'midnight' | 'paper' | 'mint' | 'peach';

const WIDGET_LABELS: Record<string, string> = {
  weather: '天气',
  todo: '待办',
  hot: '热搜',
  recent: '最近入库',
  history: '最近访问'
};
const ALL_WIDGETS = ['weather', 'todo', 'hot', 'recent', 'history'] as const;

const WALLPAPERS: Array<{ id: WallpaperId; label: string }> = [
  { id: 'aurora', label: '极光' },
  { id: 'midnight', label: '夜空' },
  { id: 'paper', label: '纸白' },
  { id: 'mint', label: '薄荷' },
  { id: 'peach', label: '蜜桃' }
];

interface StartPageProps {
  onNavigate: (input: string) => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onOpenDownloads: () => void;
  onClose: () => void;
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

interface Weather {
  city: string;
  temperature: number;
  description: string;
  high: number;
  low: number;
}

/** 新标签起始页：iTab 风格工作台（搜索 / 小组件 / 自定义快捷方式 / 壁纸）。 */
export function StartPage({
  onNavigate,
  onOpenLibrary,
  onOpenHistory,
  onOpenTasks,
  onOpenSettings,
  onOpenBookmarks,
  onOpenDownloads,
  onClose
}: StartPageProps) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<LibraryVideo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [engine, setEngine] = useState<SearchEngineId>('bing');
  const [engineOpen, setEngineOpen] = useState(false);
  const [todos, setTodos] = useState<PetTodo[]>([]);
  const [todoDraft, setTodoDraft] = useState('');
  const [shortcuts, setShortcuts] = useState<StartShortcut[]>([]);
  const [wallpaper, setWallpaper] = useState<WallpaperId>('aurora');
  const [wallpaperImage, setWallpaperImage] = useState('');
  const [widgetOrder, setWidgetOrder] = useState<string[]>([
    'weather',
    'todo',
    'hot',
    'recent',
    'history'
  ]);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherOn, setWeatherOn] = useState(true);
  const [city, setCity] = useState('上海');
  const [hot, setHot] = useState<string[]>([]);
  const [hotOn, setHotOn] = useState(true);
  const [editing, setEditing] = useState<
    { id?: string; label: string; url: string; group: string } | null
  >(null);
  const [shortcutMenu, setShortcutMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('start-search-history') || '[]');
      return Array.isArray(raw) ? raw.map(String).slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(-1);
  const [cityEditing, setCityEditing] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [hotLoading, setHotLoading] = useState(false);
  const draggedAt = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const wallpaperRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const applySettings = (general: Record<string, unknown>) => {
    setEngine((general.searchEngine as SearchEngineId) || 'bing');
    setTodos(Array.isArray(general.petTodos) ? (general.petTodos as PetTodo[]) : []);
    setShortcuts(
      Array.isArray(general.startShortcuts) ? (general.startShortcuts as StartShortcut[]) : []
    );
    setWallpaper((general.startWallpaper as WallpaperId) || 'aurora');
    setWallpaperImage(String(general.startWallpaperImage || ''));
    if (Array.isArray(general.startWidgets)) {
      setWidgetOrder(general.startWidgets.map(String));
    }
    setWeatherOn(general.startWeather !== false);
    setCity(String(general.startCity || '上海'));
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
    if (!weatherOn || !widgetOrder.includes('weather')) return;
    let alive = true;
    void window.bsub.startWeather(city).then((response) => {
      if (!alive) return;
      setWeather(response.ok ? response.data : null);
    });
    return () => {
      alive = false;
    };
  }, [weatherOn, city, widgetOrder]);

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
    if (!wallpaperOpen) return;
    const close = (event: MouseEvent) => {
      if (wallpaperRef.current && !wallpaperRef.current.contains(event.target as Node)) {
        setWallpaperOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [wallpaperOpen]);

  useEffect(() => {
    if (!shortcutMenu) return;
    const close = () => setShortcutMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [shortcutMenu]);

  const engineLabel = searchEngineLabel(engine);

  const patchGeneral = async (patch: Record<string, unknown>) => {
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    Object.assign(settings.general, patch);
    await window.bsub.saveSettings(settings);
  };

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

  const submit = () => {
    commitSearch(query);
  };

  const persistTodos = async (next: PetTodo[]) => {
    setTodos(next);
    await patchGeneral({ petTodos: next });
  };

  const addTodo = () => {
    const raw = todoDraft.trim();
    if (!raw) return;
    const { text, dueAt } = parseReminder(raw);
    void persistTodos([
      ...todos,
      { id: Date.now(), text: text.slice(0, 200), done: false, dueAt }
    ]);
    setTodoDraft('');
  };

  const removeTodo = (id: number) => {
    void persistTodos(todos.filter((todo) => todo.id !== id));
  };

  const clearDoneTodos = () => {
    void persistTodos(todos.filter((todo) => !todo.done));
  };

  const saveCity = () => {
    const next = cityDraft.trim() || city;
    setCity(next);
    setCityEditing(false);
    void patchGeneral({ startCity: next });
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

  const persistShortcuts = async (next: StartShortcut[]) => {
    setShortcuts(next);
    await patchGeneral({ startShortcuts: next });
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
    const next = editing.id
      ? shortcuts.map((item) => (item.id === editing.id ? { ...item, label, url, group } : item))
      : [...shortcuts, { id, label, url, group }];
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
    return Array.from(map.entries());
  }, [shortcuts]);

  const moveShortcutTo = (fromId: string, group: string, targetId?: string) => {
    const fromIndex = shortcuts.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return;
    const next = [...shortcuts];
    const [moved] = next.splice(fromIndex, 1);
    moved.group = group;
    if (targetId) {
      const targetIndex = next.findIndex((item) => item.id === targetId);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, moved);
    } else {
      next.push(moved);
    }
    void persistShortcuts(next);
  };

  const removeShortcut = (id: string) => {
    void persistShortcuts(shortcuts.filter((item) => item.id !== id));
  };

  const moveShortcut = (id: string, delta: number) => {
    const index = shortcuts.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= shortcuts.length) return;
    const next = [...shortcuts];
    [next[index], next[target]] = [next[target], next[index]];
    void persistShortcuts(next);
  };

  const builtIn = useMemo(
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

  const doneCount = todos.filter((todo) => todo.done).length;
  const searchSuggestions = useMemo(() => {
    const value = query.trim();
    const items: Array<{ text: string; label: string; kind: string }> = [];
    const looksUrl = /^(https?:\/\/|www\.)/i.test(value) || /^[\w-]+\.[a-z]{2,}(\/|$)/i.test(value);
    const looksVideo = /^(BV[0-9A-Za-z]{10}|av\d+)$/i.test(value);
    if (value && looksVideo) {
      items.push({
        text: `https://www.bilibili.com/video/${value}`,
        label: `打开 B 站视频 ${value}`,
        kind: 'video'
      });
    } else if (value && looksUrl) {
      items.push({ text: value, label: `打开 ${value}`, kind: 'open' });
    } else if (value) {
      items.push({ text: value, label: `在 ${engineLabel} 搜索“${value}”`, kind: 'search' });
    }
    for (const entry of searchHistory) {
      if (value && !entry.toLowerCase().includes(value.toLowerCase())) continue;
      if (items.some((item) => item.text === entry)) continue;
      items.push({ text: entry, label: entry, kind: 'history' });
      if (items.length >= 7) break;
    }
    return items;
  }, [query, searchHistory, engineLabel]);
  const orderOf = (id: string) => {
    const index = widgetOrder.indexOf(id);
    return index < 0 ? 99 : index;
  };
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
  const moveWidget = (id: string, delta: number) => {
    const index = widgetOrder.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= widgetOrder.length) return;
    const next = [...widgetOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setWidgetOrder(next);
    void patchGeneral({ startWidgets: next });
  };
  const applyWallpaperFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 2560;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setWallpaperImage(dataUrl);
        void patchGeneral({ startWallpaperImage: dataUrl });
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={`start-page start-page-v2 start-wallpaper-${wallpaper}`}
      style={
        wallpaperImage
          ? {
              backgroundImage: `linear-gradient(color-mix(in srgb, var(--bg) 18%, transparent), color-mix(in srgb, var(--bg) 45%, transparent)), url(${wallpaperImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }
          : undefined
      }
    >
      <div className="start-aurora" aria-hidden="true">
        <span className="start-blob start-blob-a" />
        <span className="start-blob start-blob-b" />
        <span className="start-blob start-blob-c" />
      </div>

      <div className="start-sheet">
        <section className="start-hero-v2">
          <div className="start-clock-row">
            <span className="start-clock-v2">
              {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="start-greeting">
              {greeting(now)}，
              {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
            </span>
            <div className="start-hero-actions" ref={wallpaperRef}>
              <button
                className={`start-edit-btn${editMode ? ' is-active' : ''}`}
                onClick={() => setEditMode((value) => !value)}
              >
                {editMode ? '完成' : '编辑'}
              </button>
              <button
                className="start-icon-btn"
                title="更换壁纸"
                onClick={() => setWallpaperOpen((value) => !value)}
              >
                <Palette size={15} />
              </button>
              {wallpaperOpen && (
                <div className="start-wallpaper-pop">
                  {WALLPAPERS.map((item) => (
                    <button
                      key={item.id}
                      className={`start-wallpaper-dot start-wallpaper-${item.id}${
                        wallpaper === item.id ? ' is-active' : ''
                      }`}
                      title={item.label}
                      onClick={() => {
                        setWallpaper(item.id);
                        setWallpaperImage('');
                        setWallpaperOpen(false);
                        void patchGeneral({ startWallpaper: item.id, startWallpaperImage: '' });
                      }}
                    />
                  ))}
                  <label className="start-wallpaper-upload" title="上传本地图片作为壁纸">
                    上传
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) applyWallpaperFile(file);
                        event.currentTarget.value = '';
                        setWallpaperOpen(false);
                      }}
                    />
                  </label>
                  {wallpaperImage && (
                    <button
                      className="start-wallpaper-clear"
                      title="清除自定义壁纸"
                      onClick={() => {
                        setWallpaperImage('');
                        void patchGeneral({ startWallpaperImage: '' });
                        setWallpaperOpen(false);
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="start-search-v2" ref={searchBoxRef}>
            <div className="start-engine">
              <button
                className="start-engine-btn"
                title="切换搜索引擎"
                onClick={() => setEngineOpen((value) => !value)}
              >
                {engineLabel}
              </button>
              {engineOpen && (
                <div className="start-engine-menu">
                  {SEARCH_ENGINES.map((item) => (
                    <button
                      key={item.id}
                      className={item.id === engine ? 'is-active' : ''}
                      onClick={() => void pickEngine(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Search size={18} className="start-search-icon" />
            <input
              ref={searchRef}
              autoFocus
              value={query}
              placeholder={`在 ${engineLabel} 搜索，或输入网址 / BV 号…`}
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
                setSearchActive(-1);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const item = searchActive >= 0 ? searchSuggestions[searchActive] : null;
                  if (item) commitSearch(item.text);
                  else submit();
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSearchOpen(true);
                  setSearchActive((index) =>
                    Math.min(searchSuggestions.length - 1, index + 1)
                  );
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSearchActive((index) => Math.max(-1, index - 1));
                }
                if (event.key === 'Escape') {
                  if (searchOpen) {
                    setSearchOpen(false);
                    setSearchActive(-1);
                  } else {
                    onClose();
                  }
                }
              }}
            />
            <button className="start-search-go" disabled={!query.trim()} onClick={submit}>
              搜索
            </button>
            {searchOpen && searchSuggestions.length > 0 && (
              <div className="start-suggest">
                {searchSuggestions.map((item, index) => (
                  <button
                    key={`${item.kind}-${item.text}`}
                    className={`start-suggest-item${searchActive === index ? ' is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSearchActive(index)}
                    onClick={() => commitSearch(item.text)}
                  >
                    {item.kind === 'history' ? <History size={12} /> : <Search size={12} />}
                    <span className="start-suggest-text">{item.label}</span>
                    <span className="start-suggest-kind">
                      {item.kind === 'open' || item.kind === 'video' ? '打开' : item.kind === 'history' ? '历史' : engineLabel}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="start-quick-chips">
            <span className="start-chip-label">常去：</span>
            {[
              { label: 'B 站热门', url: 'https://www.bilibili.com/v/popular/all' },
              { label: '稍后再看', url: 'https://www.bilibili.com/watchlater/list' },
              { label: '番剧', url: 'https://www.bilibili.com/anime/' },
              { label: '直播', url: 'https://live.bilibili.com/' }
            ].map((item) => (
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
          <div className="start-search-hint">
            Enter 搜索 · ↑↓ 选择历史 · 支持 BV 号 / av 号 / 网址直接打开
          </div>
        </section>

        {editMode && (
          <div className="start-widget-manager">
            <span className="start-widget-order-label">小组件</span>
            {[...widgetOrder, ...ALL_WIDGETS.filter((id) => !widgetOrder.includes(id))].map(
              (id) => {
                const visible = widgetVisible(id);
                const index = widgetOrder.indexOf(id);
                return (
                  <div key={id} className={`start-widget-toggle${visible ? ' is-on' : ''}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleWidget(id)}
                      />
                      {WIDGET_LABELS[id] || id}
                    </label>
                    {visible && (
                      <>
                        <button
                          title="往前移"
                          disabled={index <= 0}
                          onClick={() => moveWidget(id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          title="往后移"
                          disabled={index >= widgetOrder.length - 1}
                          onClick={() => moveWidget(id, 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}

        <section className="start-widget-grid">
          {widgetVisible('weather') && (
            <article className="start-widget-card start-weather-widget" style={{ order: orderOf('weather') }}>
              <header>
                <CloudSun size={14} />
                <span>天气</span>
                {cityEditing ? (
                  <span className="start-city-edit">
                    <input
                      autoFocus
                      value={cityDraft}
                      onChange={(event) => setCityDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveCity();
                        if (event.key === 'Escape') setCityEditing(false);
                      }}
                    />
                    <button title="保存城市" onClick={saveCity}>
                      ✓
                    </button>
                  </span>
                ) : (
                  <button
                    className="start-widget-meta start-widget-city"
                    title="点击切换城市"
                    onClick={() => {
                      setCityDraft(city);
                      setCityEditing(true);
                    }}
                  >
                    <MapPin size={10} /> {weather?.city || city}
                  </button>
                )}
              </header>
              {weather ? (
                <div className="start-weather-body">
                  <span className="start-weather-temp">{Math.round(weather.temperature)}°</span>
                  <div className="start-weather-desc">
                    <span>{weather.description}</span>
                    <span className="start-widget-meta">
                      {Math.round(weather.low)}° ~ {Math.round(weather.high)}°
                    </span>
                  </div>
                </div>
              ) : (
                <div className="start-widget-empty">天气获取失败，稍后重试</div>
              )}
            </article>
          )}

          {widgetVisible('todo') && (
          <article className="start-widget-card start-todo-widget" style={{ order: orderOf('todo') }}>
            <header>
              <ListChecks size={14} />
              <span>待办</span>
              <span className="start-widget-meta">
                {doneCount}/{todos.length}
              </span>
            </header>
            <div className="start-todo-list">
              {todos.slice(0, 4).map((todo) => (
                <label key={todo.id} className="start-todo-item">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() =>
                      void persistTodos(
                        todos.map((item) =>
                          item.id === todo.id ? { ...item, done: !item.done } : item
                        )
                      )
                    }
                  />
                  <span className={todo.done ? 'is-done' : ''}>{todo.text}</span>
                  {todo.dueAt && <span className="start-todo-due">{formatReminder(todo.dueAt)}</span>}
                  <button
                    className="start-todo-remove"
                    title="删除待办"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeTodo(todo.id);
                    }}
                  >
                    <X size={10} />
                  </button>
                </label>
              ))}
              {!todos.length && <div className="start-widget-empty">还没有待办，加一条试试</div>}
            </div>
            <div className="start-todo-add">
              <input
                value={todoDraft}
                placeholder="添加待办，如 20分钟后 喝水"
                onChange={(event) => setTodoDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTodo();
                }}
              />
              <button title="添加" onClick={addTodo} disabled={!todoDraft.trim()}>
                <Plus size={14} />
              </button>
            </div>
            {doneCount > 0 && (
              <button className="start-todo-clear" onClick={clearDoneTodos}>
                清除已完成（{doneCount}）
              </button>
            )}
          </article>
          )}

          {widgetVisible('hot') && (
            <article className="start-widget-card" style={{ order: orderOf('hot') }}>
              <header>
                <Flame size={14} />
                <span>B 站热搜</span>
                <button
                  className="start-widget-icon"
                  title="刷新热搜"
                  disabled={hotLoading}
                  onClick={() => void refreshHot()}
                >
                  <RefreshCw size={11} className={hotLoading ? 'spin' : ''} />
                </button>
                <button
                  className="start-widget-link"
                  onClick={() => onNavigate('https://www.bilibili.com')}
                >
                  去 B 站
                </button>
              </header>
              <div className="start-list">
                {hot.map((word, index) => (
                  <button
                    key={word}
                    className="start-list-item start-hot-item"
                    title={word}
                    onClick={() => {
                      onClose();
                      onNavigate(
                        `https://search.bilibili.com/all?keyword=${encodeURIComponent(word)}`
                      );
                    }}
                  >
                    <span className={`start-hot-rank${index < 3 ? ' is-top' : ''}`}>
                      {index + 1}
                    </span>
                    <span className="start-list-title">{word}</span>
                  </button>
                ))}
                {!hot.length && <div className="start-widget-empty">热搜加载中…</div>}
              </div>
            </article>
          )}

          {widgetVisible('recent') && (
          <article className="start-widget-card" style={{ order: orderOf('recent') }}>
            <header>
              <BookOpen size={14} />
              <span>最近入库</span>
              <button className="start-widget-link" onClick={onOpenLibrary}>
                全部
              </button>
            </header>
            <div className="start-list">
              {recent.map((video) => (
                <button
                  key={video.id}
                  className="start-list-item"
                  title={video.title}
                  onClick={() => {
                    onClose();
                    onNavigate(video.url);
                  }}
                >
                  <span className="start-list-title">{video.title}</span>
                  <span className="start-list-meta">{video.owner || '未知 UP'}</span>
                </button>
              ))}
              {!recent.length && <div className="start-widget-empty">库里还没有视频</div>}
            </div>
          </article>
          )}

          {widgetVisible('history') && (
          <article className="start-widget-card" style={{ order: orderOf('history') }}>
            <header>
              <History size={14} />
              <span>最近访问</span>
              <button className="start-widget-link" onClick={onOpenHistory}>
                全部
              </button>
            </header>
            <div className="start-list">
              {history.map((entry, index) => (
                <button
                  key={`${entry.url}-${index}`}
                  className="start-list-item"
                  title={entry.url}
                  onClick={() => {
                    onClose();
                    onNavigate(entry.url);
                  }}
                >
                  <span className="start-list-title">{entry.title || entry.url}</span>
                  <span className="start-list-meta">
                    {entry.url.replace(/^https?:\/\//, '').split('/')[0]}
                  </span>
                </button>
              ))}
              {!history.length && <div className="start-widget-empty">还没有浏览记录</div>}
            </div>
          </article>
          )}
        </section>

        <section className="start-shortcut-area">
          <div className="start-shortcut-grid">
            {builtIn.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`start-shortcut${editMode ? ' is-locked' : ''}`}
                  onClick={() => {
                    if (editMode) return;
                    item.run();
                  }}
                >
                  <span className="start-shortcut-icon">
                    <Icon size={18} />
                  </span>
                  <span className="start-shortcut-label">{item.label}</span>
                </button>
              );
            })}
          </div>

          {groups.map(([group, items]) => (
            <div className="start-shortcut-group" key={group}>
              <div
                className="start-shortcut-group-title"
                onDragOver={(event) => {
                  if (editMode) event.preventDefault();
                }}
                onDrop={() => {
                  const from = dragId.current;
                  dragId.current = null;
                  if (editMode && from) moveShortcutTo(from, group);
                }}
              >
                {group}
                <span className="start-shortcut-group-count">{items.length}</span>
              </div>
              <div className="start-shortcut-grid">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`start-shortcut start-shortcut-custom${editMode ? ' is-editing' : ''}`}
                    title={item.url}
                    draggable
                    onDragStart={(event) => {
                      dragId.current = item.id;
                      draggedAt.current = Date.now();
                      event.dataTransfer?.setData('text/plain', item.id);
                      event.dataTransfer?.setDragImage(event.currentTarget, 18, 18);
                    }}
                    onDragOver={(event) => {
                      if (editMode) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragId.current || event.dataTransfer?.getData('text/plain');
                      dragId.current = null;
                      if (!from || from === item.id) return;
                      moveShortcutTo(from, item.group || '常用', item.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setShortcutMenu({ x: event.clientX, y: event.clientY, id: item.id });
                    }}
                    onClick={() => {
                      if (Date.now() - draggedAt.current < 350) return;
                      if (editMode) {
                        setEditing({
                          id: item.id,
                          label: item.label,
                          url: item.url,
                          group: item.group || '常用'
                        });
                        return;
                      }
                      onClose();
                      onNavigate(item.url);
                    }}
                  >
                    <span className="start-shortcut-icon start-shortcut-favicon">
                      {item.label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="start-shortcut-label">{item.label}</span>
                    <span
                      className="start-shortcut-edit"
                      role="button"
                      title="编辑名称/网址/分组"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditing({
                          id: item.id,
                          label: item.label,
                          url: item.url,
                          group: item.group || '常用'
                        });
                      }}
                    >
                      ✎
                    </span>
                    {editMode && (
                      <span
                        className="start-shortcut-remove"
                        role="button"
                        title="删除"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeShortcut(item.id);
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="start-shortcut-grid">
            <button
              className="start-shortcut start-shortcut-add"
              title="添加快捷方式"
              onClick={() =>
                setEditing({
                  label: '',
                  url: '',
                  group: groups[groups.length - 1]?.[0] || '常用'
                })
              }
            >
              <span className="start-shortcut-icon">
                <Plus size={18} />
              </span>
              <span className="start-shortcut-label">添加</span>
            </button>
          </div>
        </section>

        <div className="start-footnote">
          <Sparkles size={12} />
          {editMode
            ? '编辑中：点图标改名称/网址/分组，拖到别的分组即可归类，× 删除；完成后点右上角「完成」'
            : '点右上角「编辑」可增删/排序快捷方式；设置会跟随导出/导入一起备份'}
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
        </div>
      </div>

      {editing && (
        <div className="start-modal-backdrop" onClick={() => setEditing(null)}>
          <div className="start-modal" onClick={(event) => event.stopPropagation()}>
            <div className="start-modal-title">{editing.id ? '编辑快捷方式' : '添加快捷方式'}</div>
            <label className="start-modal-field">
              <span>名称</span>
              <input
                autoFocus
                maxLength={20}
                value={editing.label}
                placeholder="例如：知乎"
                onChange={(event) => setEditing({ ...editing, label: event.target.value })}
              />
            </label>
            <label className="start-modal-field">
              <span>分组</span>
              <input
                list="start-groups"
                maxLength={12}
                value={editing.group}
                placeholder="常用 / 学习 / 工具"
                onChange={(event) => setEditing({ ...editing, group: event.target.value })}
              />
              <datalist id="start-groups">
                {Array.from(new Set(shortcuts.map((item) => item.group || '常用'))).map((group) => (
                  <option key={group} value={group} />
                ))}
              </datalist>
            </label>
            <label className="start-modal-field">
              <span>网址</span>
              <input
                maxLength={500}
                value={editing.url}
                placeholder="https://example.com"
                onChange={(event) => setEditing({ ...editing, url: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveShortcut();
                }}
              />
            </label>
            <div className="start-modal-actions">
              <button className="mini-btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="mini-btn primary"
                disabled={!editing.label.trim() || !editing.url.trim()}
                onClick={saveShortcut}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {shortcutMenu && (
        <div
          className="start-shortcut-menu"
          style={{ left: shortcutMenu.x, top: shortcutMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              const item = shortcuts.find((entry) => entry.id === shortcutMenu.id);
              setShortcutMenu(null);
              if (!item) return;
              onClose();
              onNavigate(item.url);
            }}
          >
            打开
          </button>
          <button
            onClick={() => {
              const item = shortcuts.find((entry) => entry.id === shortcutMenu.id);
              if (item) {
                setEditing({
                  id: item.id,
                  label: item.label,
                  url: item.url,
                  group: item.group || '常用'
                });
              }
              setShortcutMenu(null);
            }}
          >
            <Pencil size={12} /> 编辑
          </button>
          <button
            onClick={() => {
              moveShortcut(shortcutMenu.id, -1);
              setShortcutMenu(null);
            }}
          >
            左移
          </button>
          <button
            onClick={() => {
              moveShortcut(shortcutMenu.id, 1);
              setShortcutMenu(null);
            }}
          >
            右移
          </button>
          <button
            className="is-danger"
            onClick={() => {
              removeShortcut(shortcutMenu.id);
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
