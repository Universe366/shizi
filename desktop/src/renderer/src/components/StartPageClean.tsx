import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  CloudSun,
  Command,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import type { AppSettings, LibraryVideo, StartShortcut } from '../../../shared/types';
import {
  SEARCH_ENGINES,
  buildSearchUrl,
  isSearchEngineId,
  searchEngineLabel,
  type SearchEngineId
} from '../../../shared/searchEngines';
import { greeting, hostOf, normalizeUrl, type Weather } from './start/model';
import { SiteIcon } from './start/SiteIcon';

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
const DIM_KEY = 'start-clean-dim';
const HISTORY_KEY = 'start-search-history';

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
  const [weather, setWeather] = useState<Weather | null>(null);
  const [hot, setHot] = useState<string[]>([]);
  const [recent, setRecent] = useState<LibraryVideo[]>([]);
  const [notes, setNotes] = useState(readNotes);
  const [showRecent, setShowRecent] = useState(() => readBool(RECENT_KEY, true));
  const [showNotes, setShowNotes] = useState(() => readBool(SHOW_NOTES_KEY, false));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [draft, setDraft] = useState<{ id?: string; label: string; url: string; group: string } | null>(
    null
  );
  const [dim, setDim] = useState(readDim);
  const [dragId, setDragId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const noticeTimer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLInputElement>(null);

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
    if (!engineOpen) return;
    const close = (event: MouseEvent) => {
      if (engineRef.current && event.target instanceof Node && engineRef.current.contains(event.target)) {
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
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
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

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        setSheetOpen(false);
        return;
      }

      if (editing || paletteOpen || sheetOpen || draft) return;

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
  }, [paletteOpen, sheetOpen, draft, suggestOpen, onClose]);

  useEffect(() => {
    if (paletteOpen) window.setTimeout(() => paletteRef.current?.focus(), 20);
  }, [paletteOpen]);

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

  const groups = useMemo(
    () =>
      Array.from(
        new Set(shortcuts.map((item) => String(item.group || '').trim()).filter(Boolean))
      ).slice(0, 8),
    [shortcuts]
  );

  const visible = useMemo(
    () => (group === '全部' ? shortcuts : shortcuts.filter((item) => item.group === group)),
    [shortcuts, group]
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

  const openShortcut = (item: StartShortcut) => {
    onClose();
    onNavigate(item.url);
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
    if (draft.id) {
      void persistShortcuts(
        shortcuts.map((item) =>
          item.id === draft.id
            ? { ...item, label, url, group: groupName || undefined }
            : item
        )
      );
    } else {
      void persistShortcuts([
        ...shortcuts,
        { id: newId(), label, url, group: groupName || undefined }
      ]);
    }
    setDraft(null);
  };

  const showNotice = (text: string, undo?: () => void) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ text, undo });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
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

  const moveShortcut = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    const from = shortcuts.findIndex((item) => item.id === fromId);
    const to = shortcuts.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...shortcuts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistShortcuts(next);
  };

  const dark =
    window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
  const wallpaper = String(general?.startWallpaper || 'aurora');
  const customWallpaper =
    general?.startWallpaperMedia?.url || general?.startWallpaperImage || '';
  const paletteActions = [
    { id: 'add', label: '添加快捷方式', run: () => setDraft({ label: '', url: '', group: '' }) },
    { id: 'settings', label: '打开设置', run: onOpenSettings },
    { id: 'library', label: '打开工作台', run: onOpenLibrary },
    { id: 'history', label: '历史记录', run: onOpenHistory },
    { id: 'tasks', label: '任务中心', run: onOpenTasks },
    { id: 'bookmarks', label: '书签', run: onOpenBookmarks },
    { id: 'downloads', label: '下载', run: onOpenDownloads },
    { id: 'global', label: '全局搜索', run: onOpenGlobalSearch },
    { id: 'sheet', label: '自定义起始页', run: () => setSheetOpen(true) },
    { id: 'close', label: '关闭起始页', run: onClose }
  ].filter((item) =>
    paletteQuery.trim() ? item.label.includes(paletteQuery.trim()) : true
  );

  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateText = now.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });

  return (
    <div
      className={`start-page start-clean start-clean-${dark ? 'dark' : 'light'} start-clean-wall-${wallpaper}`}
      style={
        {
          '--sc-dim': dim,
          ...(customWallpaper ? { '--sc-custom-wall': `url("${customWallpaper}")` } : {})
        } as CSSProperties
      }
    >
      <div className="sc-background" aria-hidden />
      <div className="sc-veil" aria-hidden />

      <header className="sc-topbar">
        <div className="sc-weather">
          {weatherOn && weather && (
            <>
              <CloudSun size={16} />
              <span className="sc-weather-temp">{Math.round(weather.temperature)}°</span>
              <span className="sc-weather-city">{weather.city || city}</span>
              <span className="sc-weather-desc">{weather.description}</span>
            </>
          )}
        </div>
        <div className="sc-actions">
          <button
            type="button"
            className="sc-icon-btn"
            title="命令面板（Ctrl+K）"
            onClick={() => setPaletteOpen(true)}
          >
            <Command size={16} />
          </button>
          <button
            type="button"
            className="sc-icon-btn"
            title="自定义起始页"
            onClick={() => setSheetOpen(true)}
          >
            <Settings size={16} />
          </button>
          <button type="button" className="sc-icon-btn" title="关闭起始页（Esc）" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      <main className="sc-main">
        <section className="sc-hero">
          <div className="sc-clock">{time}</div>
          <div className="sc-sub">
            {greeting(now)}，{dateText}
          </div>

          <div className="sc-search-wrap" ref={(node) => {
            searchWrapRef.current = node;
            engineRef.current = node;
          }}>
            <button
              type="button"
              className="sc-engine"
              title="切换搜索引擎"
              onClick={() => setEngineOpen((value) => !value)}
            >
              {searchEngineLabel(engine)}
            </button>
            <Search size={17} className="sc-search-icon" />
            <input
              ref={searchRef}
              className="sc-search-input"
              value={query}
              placeholder="搜索，或输入网址"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestOpen(true);
                setActiveSuggestion(-1);
              }}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveSuggestion((value) => Math.min(suggestions.length - 1, value + 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveSuggestion((value) => Math.max(-1, value - 1));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const active = suggestions[activeSuggestion];
                  if (active) pickSuggestion(active);
                  else submitSearch();
                } else if (event.key === 'Escape') {
                  event.stopPropagation();
                  setSuggestOpen(false);
                }
              }}
            />
            <kbd className="sc-kbd">/</kbd>
            <button
              type="button"
              className="sc-go"
              title="搜索"
              onClick={() => submitSearch()}
            >
              <ArrowRight size={17} />
            </button>

            {engineOpen && (
              <div className="sc-engine-menu">
                {SEARCH_ENGINES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === engine ? 'is-active' : ''}
                    onClick={() => {
                      setEngineOpen(false);
                      if (isSearchEngineId(item.id)) {
                        setEngine(item.id);
                        void patchGeneral({ searchEngine: item.id });
                      }
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {suggestOpen && suggestions.length > 0 && (
              <div className="sc-suggest">
                {suggestions.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={index === activeSuggestion ? 'is-active' : ''}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSuggestOpen(false);
                      pickSuggestion(item);
                    }}
                  >
                    {item.kind === 'shortcut' ? (
                      <span className="sc-suggest-kind">站点</span>
                    ) : item.kind === 'history' ? (
                      <span className="sc-suggest-kind">历史</span>
                    ) : (
                      <Search size={12} />
                    )}
                    <span className="sc-suggest-label">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sc-groups">
            <button
              type="button"
              className={group === '全部' ? 'is-active' : ''}
              onClick={() => setGroup('全部')}
            >
              全部
            </button>
            {groups.map((item) => (
              <button
                key={item}
                type="button"
                className={group === item ? 'is-active' : ''}
                onClick={() => setGroup(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="sc-links">
            {visible.map((item) => (
              <div
                key={item.id}
                className="sc-link-wrap"
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId) moveShortcut(dragId, item.id);
                  setDragId(null);
                }}
              >
                <button
                  type="button"
                  className="sc-link"
                  title={`${item.label} · ${item.url}`}
                  onClick={() => openShortcut(item)}
                >
                  <SiteIcon item={item} />
                  <span className="sc-link-label">{item.label}</span>
                </button>
                <span className="sc-link-actions">
                  <button
                    type="button"
                    title="编辑"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDraft({
                        id: item.id,
                        label: item.label,
                        url: item.url,
                        group: item.group || ''
                      });
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeShortcut(item);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            ))}
            <button
              type="button"
              className="sc-add-link"
              onClick={() => setDraft({ label: '', url: '', group: group === '全部' ? '' : group })}
            >
              <Plus size={20} />
              <span>添加</span>
            </button>
          </div>
        </section>

        <section className="sc-widgets">
          {hotOn && hot.length > 0 && (
            <article className="sc-card">
              <header>
                <span>B 站热搜</span>
                <button type="button" onClick={() => onOpenGlobalSearch()}>
                  更多
                </button>
              </header>
              <div className="sc-rank-list">
                {hot.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigate(
                        `https://search.bilibili.com/all?keyword=${encodeURIComponent(item)}`
                      );
                    }}
                  >
                    <span className={`sc-rank${index < 3 ? ' is-hot' : ''}`}>{index + 1}</span>
                    <span>{item}</span>
                  </button>
                ))}
              </div>
            </article>
          )}

          {showRecent && recent.length > 0 && (
            <article className="sc-card">
              <header>
                <span>最近打开</span>
                <button type="button" onClick={onOpenLibrary}>
                  工作台
                </button>
              </header>
              <div className="sc-recent-list">
                {recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    onClick={() => {
                      onClose();
                      onNavigate(item.url);
                    }}
                  >
                    <span className="sc-recent-title">{item.title}</span>
                    <span className="sc-recent-meta">{item.owner || hostOf(item.url)}</span>
                  </button>
                ))}
              </div>
            </article>
          )}

          {showNotes && (
            <article className="sc-card sc-notes">
              <header>
                <span>便签</span>
                <button type="button" onClick={() => setShowNotes(false)}>
                  隐藏
                </button>
              </header>
              <textarea
                value={notes}
                placeholder="随手记点什么…"
                onChange={(event) => {
                  const value = event.target.value;
                  setNotes(value);
                  try {
                    localStorage.setItem(NOTES_KEY, value);
                  } catch {
                    // ignore
                  }
                }}
              />
            </article>
          )}
        </section>
      </main>

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

            <section>
              <h4>背景</h4>
              <div className="sc-wall-grid">
                {WALLPAPERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`sc-wall sc-wall-${item.id}${wallpaper === item.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setGeneral((current) =>
                        current ? { ...current, startWallpaper: item.id } : current
                      );
                      void patchGeneral({ startWallpaper: item.id });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="sc-field">
                <span>背景暗度 {Math.round(dim * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={0.7}
                  step={0.05}
                  value={dim}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDim(value);
                    try {
                      localStorage.setItem(DIM_KEY, String(value));
                    } catch {
                      // ignore
                    }
                  }}
                />
              </label>
            </section>

            <section>
              <h4>搜索</h4>
              <select
                className="sc-select"
                value={engine}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!isSearchEngineId(next)) return;
                  setEngine(next);
                  void patchGeneral({ searchEngine: next });
                }}
              >
                {SEARCH_ENGINES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <label className="sc-field">
                <span>天气城市</span>
                <input
                  value={cityDraft}
                  onChange={(event) => setCityDraft(event.target.value)}
                  onBlur={() => {
                    const value = cityDraft.trim() || '上海';
                    setCityDraft(value);
                    void patchGeneral({ startCity: value });
                  }}
                />
              </label>
            </section>

            <section>
              <h4>小组件</h4>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={weatherOn}
                  onChange={(event) => void patchGeneral({ startWeather: event.target.checked })}
                />
                天气
              </label>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={hotOn}
                  onChange={(event) => void patchGeneral({ startHotSearch: event.target.checked })}
                />
                B 站热搜
              </label>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={showRecent}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setShowRecent(value);
                    try {
                      localStorage.setItem(RECENT_KEY, value ? '1' : '0');
                    } catch {
                      // ignore
                    }
                  }}
                />
                最近打开
              </label>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={showNotes}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setShowNotes(value);
                    try {
                      localStorage.setItem(SHOW_NOTES_KEY, value ? '1' : '0');
                    } catch {
                      // ignore
                    }
                  }}
                />
                便签
              </label>
            </section>

            <section>
              <h4>快捷方式</h4>
              <div className="sc-edit-list">
                {shortcuts.map((item) => (
                  <div key={item.id} className="sc-edit-row">
                    <span>{item.label}</span>
                    <span>{hostOf(item.url)}</span>
                    <button
                      type="button"
                      title="编辑"
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          label: item.label,
                          url: item.url,
                          group: item.group || ''
                        })
                      }
                    >
                      <Pencil size={12} />
                    </button>
                    <button type="button" title="删除" onClick={() => removeShortcut(item)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="sc-secondary"
                onClick={() => setDraft({ label: '', url: '', group: '' })}
              >
                <Plus size={13} /> 添加快捷方式
              </button>
            </section>

            <section className="sc-sheet-actions">
              <button type="button" onClick={onOpenSettings}>
                完整设置
              </button>
              <button type="button" onClick={onOpenLibrary}>
                工作台
              </button>
              <button type="button" onClick={onOpenHistory}>
                历史记录
              </button>
            </section>
          </aside>
        </>
      )}

      {paletteOpen && (
        <div className="sc-palette-mask" onPointerDown={() => setPaletteOpen(false)}>
          <div className="sc-palette" onPointerDown={(event) => event.stopPropagation()}>
            <input
              ref={paletteRef}
              value={paletteQuery}
              placeholder="输入命令…"
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPaletteOpen(false);
                if (event.key === 'Enter' && paletteActions[0]) {
                  event.preventDefault();
                  setPaletteOpen(false);
                  paletteActions[0].run();
                }
              }}
            />
            <div className="sc-palette-list">
              {paletteActions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setPaletteOpen(false);
                    item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="sc-modal-mask" onPointerDown={() => setDraft(null)}>
          <form
            className="sc-modal"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <h3>{draft.id ? '编辑快捷方式' : '添加快捷方式'}</h3>
            <label>
              名称
              <input
                value={draft.label}
                placeholder="例如 哔哩哔哩"
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, label: event.target.value } : current))
                }
              />
            </label>
            <label>
              网址
              <input
                value={draft.url}
                placeholder="https://www.bilibili.com/"
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, url: event.target.value } : current))
                }
              />
            </label>
            <label>
              分组
              <input
                value={draft.group}
                list="sc-groups"
                placeholder="可选，例如 学习"
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, group: event.target.value } : current))
                }
              />
              <datalist id="sc-groups">
                {groups.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <div className="sc-modal-actions">
              <button type="button" onClick={() => setDraft(null)}>
                取消
              </button>
              <button type="submit" className="is-primary">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
