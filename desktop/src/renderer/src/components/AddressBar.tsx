import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, Home, Library, MoreHorizontal, RotateCw, Settings, Star, X } from 'lucide-react';
import type { Bookmark as BookmarkItem, BrowserToolbarSettings, HistoryEntry, TabInfo } from '../../../shared/types';
import { DEFAULT_BROWSER_TOOLBAR } from '../../../shared/browserToolbar';
import { SEARCH_ENGINES, searchEngineLabel, type SearchEngineId } from '../../../shared/searchEngines';
import { canonicalUrl, compactUrl } from '../../../shared/url';
import { formatMediaRate } from '../../../shared/media';
import type { HubSection } from './BrowserHub';

export function AddressBar({
  tab,
  toolbar = DEFAULT_BROWSER_TOOLBAR,
  focusSignal = 0,
  bookmarked,
  onToggleBookmark,
  onOpenHub,
  onOpenReader,
  onOpenStart,
  onOpenLibrary,
  onOpenSettings,
  hasUpdate = false
}: {
  tab: TabInfo | null;
  toolbar?: BrowserToolbarSettings;
  focusSignal?: number;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenHub: (section: HubSection) => void;
  onOpenReader: () => void;
  onOpenStart: () => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  hasUpdate?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [engine, setEngine] = useState<SearchEngineId>('bing');
  const [engineOpen, setEngineOpen] = useState(false);
  const engineRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!editing) setValue(tab?.url ?? '');
  }, [tab?.url, editing]);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) setEngine(response.data.settings.general.searchEngine || 'bing');
    });
  }, []);

  useEffect(() => {
    if (!engineOpen) return;
    const close = (event: MouseEvent) => {
      if (engineRef.current && !engineRef.current.contains(event.target as Node)) setEngineOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [engineOpen]);

  const pickEngine = async (next: SearchEngineId) => {
    setEngine(next);
    setEngineOpen(false);
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    settings.general.searchEngine = next;
    await window.bsub.saveSettings(settings);
  };

  const engineLabel = searchEngineLabel(engine);

  const loadBookmarks = () => {
    if (bookmarks.length) return;
    void window.bsub.listBookmarks().then((response) => {
      if (response.ok) setBookmarks(response.data);
    });
  };

  const matchedBookmarks = (() => {
    const text = value.trim().toLowerCase();
    if (!text) return [];
    return bookmarks
      .filter(
        (item) =>
          item.title.toLowerCase().includes(text) || item.url.toLowerCase().includes(text)
      )
      .slice(0, 4);
  })();

  const pasteAndGo = async () => {
    const text = (await window.bsub.readClipboard()).trim();
    if (!text) return;
    void window.bsub.navigate(text);
  };

  useEffect(() => {
    if (!suggestOpen) return;
    const text = value.trim();
    if (!text) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void window.bsub.listBrowseHistory(text, 6).then((response) => {
        if (!alive) return;
        setSuggestions(response.ok ? response.data.slice(0, 6) : []);
      });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [value, suggestOpen]);

  useEffect(() => {
    if (!focusSignal) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const pickSuggestion = (item: HistoryEntry) => {
    setSuggestOpen(false);
    setSuggestions([]);
    setEditing(false);
    inputRef.current?.blur();
    void window.bsub.navigate(item.url);
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setEditing(false);
    inputRef.current?.blur();
    void window.bsub.navigate(text);
  };

  const runMenuChoice = (choice: string | null) => {
    if (!choice) return;
    if (choice === 'history') onOpenHub('history');
    else if (choice === 'bookmarks') onOpenHub('bookmarks');
    else if (choice === 'downloads') onOpenHub('downloads');
    else if (choice === 'tabs') onOpenHub('tabs');
    else if (choice === 'reader') onOpenReader();
    else if (choice === 'zoom-in') void window.bsub.zoomIn();
    else if (choice === 'zoom-out') void window.bsub.zoomOut();
    else if (choice === 'zoom') void window.bsub.zoomReset();
    else if (choice === 'copy') void window.bsub.writeClipboard(canonicalUrl(tab?.url ?? ''));
    else if (choice === 'paste') void pasteAndGo();
    else if (choice === 'external' && tab?.url) void window.bsub.openExternal(tab.url);
    else if (choice === 'start') onOpenStart();
  };

  const openMenu = async () => {
    // 网页视图是原生层，HTML 菜单会被盖住；优先用系统菜单。
    if (typeof window.bsub.popupMenu !== 'function') {
      setMenuOpen((value) => !value);
      return;
    }
    setMenuOpen(false);
    const choice = await window.bsub.popupMenu([
      { id: 'history', label: '历史记录' },
      { id: 'bookmarks', label: '书签' },
      { id: 'downloads', label: '下载' },
      { id: 'tabs', label: '标签页' },
      { type: 'separator' },
      { id: 'copy', label: '复制当前网址' },
      { id: 'paste', label: '粘贴并打开' },
      { id: 'external', label: '在外部浏览器打开' },
      { id: 'reader', label: '阅读模式（Alt+R）' },
      { id: 'zoom-in', label: '放大（Ctrl++）' },
      { id: 'zoom-out', label: '缩小（Ctrl+-）' },
      { id: 'zoom', label: `重置缩放（${Math.round((tab?.zoom ?? 1) * 100)}%）` },
      { type: 'separator' },
      { id: 'start', label: '起始页' }
    ]);
    runMenuChoice(choice);
  };

  return (
    <div className="address-bar">
      {(toolbar.back || toolbar.forward || toolbar.reload) && (
        <div className="nav-group">
          {toolbar.back && (
            <button
              className="nav-btn"
              disabled={!tab?.canGoBack}
              title="后退"
              onClick={() => void window.bsub.back()}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          {toolbar.forward && (
            <button
              className="nav-btn"
              disabled={!tab?.canGoForward}
              title="前进"
              onClick={() => void window.bsub.forward()}
            >
              <ArrowRight size={16} />
            </button>
          )}
          {toolbar.reload && (
            <button
              className="nav-btn"
              title={tab?.loading ? '停止' : '刷新'}
              onClick={() => (tab?.loading ? void window.bsub.stop() : void window.bsub.reload())}
            >
              {tab?.loading ? <X size={15} /> : <RotateCw size={15} />}
            </button>
          )}
        </div>
      )}

      {toolbar.engine && (
      <div className="address-engine" ref={engineRef}>
        <button
          className={`address-engine-btn${engineOpen ? ' is-active' : ''}`}
          title="切换搜索引擎"
          onClick={() => setEngineOpen((value) => !value)}
        >
          {engineLabel}
        </button>
        {engineOpen && (
          <div className="address-engine-menu" role="menu">
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
      )}

      <div className="address-field">
        <Globe size={13} />
        <input
          ref={inputRef}
          value={editing ? value : compactUrl(tab?.url ?? '')}
          title={tab?.url ?? ''}
          placeholder={`在${engineLabel}搜索，或输入网址 / BV 号`}
          spellCheck={false}
          onChange={(event) => {
            setEditing(true);
            setValue(event.target.value);
          }}
          onFocus={(event) => {
            setEditing(true);
            setValue(canonicalUrl(tab?.url ?? ''));
            setSuggestOpen(true);
            setSuggestIndex(-1);
            loadBookmarks();
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            setValue(tab?.url ?? '');
            window.setTimeout(() => setSuggestOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setSuggestOpen(true);
              setSuggestIndex((index) => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setSuggestIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
              return;
            }
            if (event.key === 'Enter') {
              const picked = suggestIndex >= 0 ? suggestions[suggestIndex] : null;
              if (picked) pickSuggestion(picked);
              else submit();
            }
            if (event.key === 'Escape') {
              setEditing(false);
              inputRef.current?.blur();
            }
          }}
        />
      </div>

      {suggestOpen && value.trim() && !/^https?:\/\//i.test(value) && !/^BV[0-9A-Za-z]{10}$/i.test(value.trim()) && (
        <div className="address-suggest">
          <button
            className="address-suggest-item is-search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setSuggestOpen(false);
              submit();
            }}
          >
            <span className="address-suggest-title">用{engineLabel}搜索「{value.trim()}」</span>
            <span className="address-suggest-url">Enter</span>
          </button>
        </div>
      )}

      {suggestOpen && matchedBookmarks.length > 0 && (
        <div className="address-suggest" role="listbox">
          {matchedBookmarks.map((item) => (
            <button
              key={item.id}
              className="address-suggest-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSuggestOpen(false);
                setEditing(false);
                inputRef.current?.blur();
                void window.bsub.navigate(item.url);
              }}
            >
              <span className="address-suggest-title">★ {item.title || item.url}</span>
              <span className="address-suggest-url">{item.url}</span>
            </button>
          ))}
        </div>
      )}

      {suggestOpen && suggestions.length > 0 && (
        <div className="address-suggest" role="listbox">
          {suggestions.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              className={`address-suggest-item${index === suggestIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === suggestIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickSuggestion(item)}
            >
              <span className="address-suggest-title">{item.title || item.url}</span>
              <span className="address-suggest-url">{item.url}</span>
            </button>
          ))}
        </div>
      )}

      {toolbar.speed && (
        <button
          className="nav-btn speed-btn"
          title={`播放速度 ${formatMediaRate(tab?.playbackRate ?? 1)}（Alt+Shift+S）`}
          disabled={!tab}
          onClick={() => void window.bsub.toggleMediaPanel()}
        >
          {formatMediaRate(tab?.playbackRate ?? 1)}
        </button>
      )}

      {toolbar.bookmark && (
        <button
          className={`nav-btn${bookmarked ? ' is-active' : ''}`}
          title={bookmarked ? '取消书签（Ctrl+D）' : '收藏此页（Ctrl+D）'}
          disabled={!tab}
          onClick={onToggleBookmark}
        >
          <Star size={15} fill={bookmarked ? 'currentColor' : 'none'} />
        </button>
      )}

      {toolbar.library && (
        <button className="nav-btn" title="工作台：资料库 / 成片" onClick={onOpenLibrary}>
          <Library size={15} />
        </button>
      )}

      {toolbar.home && (
        <button className="nav-btn" title="起始页" onClick={onOpenStart}>
          <Home size={15} />
        </button>
      )}

      {toolbar.settings && (
        <button className="nav-btn settings-entry" title="设置" onClick={onOpenSettings}>
          <Settings size={15} />
          {hasUpdate && <span className="settings-update-dot" />}
        </button>
      )}

      {toolbar.menu && (
      <div className="address-menu-wrap" ref={menuRef}>
        <button
          className={`nav-btn${menuOpen ? ' is-active' : ''}`}
          title="菜单"
          onClick={() => void openMenu()}
        >
          <MoreHorizontal size={17} />
        </button>
        {menuOpen && (
          <div className="address-menu" role="menu">
            <button onClick={() => { setMenuOpen(false); onOpenHub('history'); }}>历史记录</button>
            <button onClick={() => { setMenuOpen(false); onOpenHub('bookmarks'); }}>书签</button>
            <button onClick={() => { setMenuOpen(false); onOpenHub('downloads'); }}>下载</button>
            <button onClick={() => { setMenuOpen(false); onOpenHub('tabs'); }}>标签页</button>
            <div className="address-menu-sep" />
            <button onClick={() => { setMenuOpen(false); onOpenReader(); }}>阅读模式（Alt+R）</button>
            <button onClick={() => { setMenuOpen(false); void window.bsub.writeClipboard(canonicalUrl(tab?.url ?? '')); }}>
              复制当前网址
            </button>
            <button onClick={() => { setMenuOpen(false); void pasteAndGo(); }}>
              粘贴并打开
            </button>
            <button onClick={() => { setMenuOpen(false); if (tab?.url) void window.bsub.openExternal(tab.url); }}>
              在外部浏览器打开
            </button>
            <div className="address-menu-sep" />
            <button onClick={() => { setMenuOpen(false); void window.bsub.zoomIn(); }}>放大</button>
            <button onClick={() => { setMenuOpen(false); void window.bsub.zoomOut(); }}>缩小</button>
            <button onClick={() => { setMenuOpen(false); void window.bsub.zoomReset(); }}>
              重置缩放（{Math.round((tab?.zoom ?? 1) * 100)}%）
            </button>
            <button onClick={() => { setMenuOpen(false); onOpenStart(); }}>起始页</button>
          </div>
        )}
      </div>
      )}

    </div>
  );
}
