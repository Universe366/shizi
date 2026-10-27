import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Download,
  History,
  Library,
  ListChecks,
  Palette,
  Pencil,
  Settings,
  Sparkles,
  Trash2
} from 'lucide-react';
import { parseReminder } from '../../../shared/reminder';
import { searchEngineLabel, type SearchEngineId } from '../../../shared/searchEngines';
import type { HistoryEntry, LibraryVideo, PetTodo, StartShortcut } from '../../../shared/types';
import { SearchBar, type Suggestion } from './start/SearchBar';
import { ShortcutBoard, type BuiltInEntry } from './start/ShortcutBoard';
import { ShortcutDialog, type ShortcutDraft } from './start/ShortcutDialog';
import { WidgetPanel } from './start/WidgetPanel';
import { WallpaperDrawer } from './start/WallpaperDrawer';
import {
  QUICK_LINKS,
  greeting,
  hostOf,
  isUrlLike,
  matchShortcut,
  type WallpaperId,
  type Weather
} from './start/model';

const SHORTCUT_BACKUP_KEY = 'start-shortcut-backup';
const EFFECT_KEY = 'start-wallpaper-effect';
const MINIMAL_KEY = 'start-minimal';

export interface StartPageProps {
  onNavigate: (input: string) => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onOpenDownloads: () => void;
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

/** 起始页：时钟 / 搜索 / 分组快捷方式 / 小组件 / 壁纸。 */
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
  const [shortcutBackup, setShortcutBackup] = useState<StartShortcut[]>([]);
  const [activeGroup, setActiveGroup] = useState('全部');
  const [wallpaper, setWallpaper] = useState<WallpaperId>('aurora');
  const [wallpaperImage, setWallpaperImage] = useState('');
  const [bingWallpaper, setBingWallpaper] = useState<{ url: string; copyright: string } | null>(
    null
  );
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
  const [editing, setEditing] = useState<ShortcutDraft | null>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(-1);
  const [cityEditing, setCityEditing] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [hotLoading, setHotLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const patchGeneral = async (patch: Record<string, unknown>) => {
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    Object.assign(settings.general, patch);
    await window.bsub.saveSettings(settings);
  };

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
    if (wallpaper !== 'bing' || wallpaperImage) return;
    let alive = true;
    void window.bsub.startBingWallpaper().then((response) => {
      if (alive && response.ok) setBingWallpaper(response.data);
    });
    return () => {
      alive = false;
    };
  }, [wallpaper, wallpaperImage]);

  useEffect(() => {
    if (!shortcutMenu) return;
    const close = () => setShortcutMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
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
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setWallpaperOpen(false);
        setShortcutMenu(null);
        setEditing(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
    writeShortcutBackup(next);
    setShortcutBackup(next);
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

  const visibleGroups =
    activeGroup === '全部' ? groups : groups.filter(([group]) => group === activeGroup);

  useEffect(() => {
    if (activeGroup !== '全部' && !groups.some(([group]) => group === activeGroup)) {
      setActiveGroup('全部');
    }
  }, [activeGroup, groups]);

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

  const openEditor = (item?: StartShortcut, group?: string) => {
    setEditing(
      item
        ? { id: item.id, label: item.label, url: item.url, group: item.group || '常用' }
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
    }
    for (const entry of searchHistory) {
      if (value && !entry.toLowerCase().includes(value.toLowerCase())) continue;
      if (items.some((item) => item.text === entry)) continue;
      items.push({ text: entry, label: entry, kind: 'history' });
      if (items.length >= 7) break;
    }
    return items;
  }, [query, shortcuts, searchHistory, engineLabel]);

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
        setWallpaperOpen(false);
        void patchGeneral({ startWallpaperImage: dataUrl });
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
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

  const backgroundImage =
    wallpaperImage || (wallpaper === 'bing' ? bingWallpaper?.url || '' : '');

  const menuItem = shortcutMenu ? shortcuts.find((item) => item.id === shortcutMenu.id) : null;

  return (
    <div
      className={`start-page start-page-v3 start-wallpaper-${wallpaper}${minimal ? ' is-minimal' : ''}`}
      style={
        backgroundImage
          ? { backgroundImage: `url(${backgroundImage})` }
          : undefined
      }
    >
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
            className={`start-ghost-btn${minimal ? ' is-active' : ''}`}
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
          <div className="start-clock">
            {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="start-greeting">
            {greeting(now)}，
            {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </div>

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
          onMove={moveShortcutTo}
          onMenu={(item, x, y) => setShortcutMenu({ x, y, id: item.id })}
          onDragStart={() => setSearchOpen(false)}
        />

        {!minimal && (
          <WidgetPanel
            order={widgetOrder}
            isVisible={widgetVisible}
            editMode={editMode}
            onToggle={toggleWidget}
            onMove={moveWidget}
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
            todos={todos}
            todoDraft={todoDraft}
            onTodoDraft={setTodoDraft}
            onTodoAdd={addTodo}
            onTodoToggle={(id) =>
              void persistTodos(
                todos.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
              )
            }
            onTodoRemove={(id) => void persistTodos(todos.filter((item) => item.id !== id))}
            onTodoClearDone={() => void persistTodos(todos.filter((item) => !item.done))}
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

        <footer className="start-footnote">
          <span className="start-footnote-text">
            {editMode
              ? '编辑中：拖动卡片可排序或换组，✎ 改名，× 删除'
              : 'Ctrl/⌘ + K 聚焦搜索 · 右键卡片可编辑或删除'}
          </span>
          {editMode && shortcutBackup.length > shortcuts.length && (
            <button className="start-foot-link" onClick={() => void persistShortcuts(shortcutBackup)}>
              恢复上次备份（{shortcutBackup.length}）
            </button>
          )}
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

      <WallpaperDrawer
        open={wallpaperOpen}
        wallpaper={wallpaper}
        wallpaperImage={wallpaperImage}
        bingWallpaper={bingWallpaper}
        blur={effect.blur}
        dim={effect.dim}
        minimal={minimal}
        onPick={(next) => {
          setWallpaper(next);
          setWallpaperImage('');
          setWallpaperOpen(false);
          void patchGeneral({ startWallpaper: next, startWallpaperImage: '' });
        }}
        onUpload={applyWallpaperFile}
        onClear={() => {
          setWallpaperImage('');
          void patchGeneral({ startWallpaperImage: '' });
        }}
        onBlur={(value) => updateEffect({ ...effect, blur: value })}
        onDim={(value) => updateEffect({ ...effect, dim: value })}
        onMinimal={toggleMinimal}
        onClose={() => setWallpaperOpen(false)}
      />

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
          className="start-menu"
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
