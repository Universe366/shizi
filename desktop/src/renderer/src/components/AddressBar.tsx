import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Globe, Home, Library, MoreHorizontal, RotateCw, Settings, Star, X } from 'lucide-react';
import type { Bookmark as BookmarkItem, BrowserToolbarSettings, HistoryEntry, TabInfo } from '../../../shared/types';
import { DEFAULT_BROWSER_TOOLBAR } from '../../../shared/browserToolbar';
import { SEARCH_ENGINES, searchEngineLabel, type SearchEngineId } from '../../../shared/searchEngines';
import { canonicalUrl, compactUrl } from '../../../shared/url';
import { formatMediaRate } from '../../../shared/media';
import type { HubSection } from './BrowserHub';

/** 地址栏下拉的一行：搜索、直接打开、书签或历史。 */
type AddressRow = {
  key: string;
  kind: 'search' | 'open' | 'bookmark' | 'history';
  title: string;
  hint: string;
  target: string;
};

export function AddressBar({
  tab,
  toolbar = DEFAULT_BROWSER_TOOLBAR,
  focusSignal = 0,
  bookmarked,
  onToggleBookmark,
  onSelectionAction,
  onNavigate,
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
  onSelectionAction: (payload: { action: string; text: string }) => void;
  /** 地址栏导航；起始页/无标签时由上层决定新建标签 */
  onNavigate?: (input: string) => void;
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
  const [selectionMenu, setSelectionMenu] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showSelectionMenu = () => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const text = String(input.value || '').slice(start, end).trim();
    // 聚焦时浏览器会全选整个地址；这不是“划词”，不要把 7 个 AI 按钮弹出来。
    const wholeValue = start === 0 && end === input.value.length;
    if (text.length < 2 || wholeValue) {
      setSelectionMenu(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    const width = 360;
    // 开始划词时收起地址建议，两个浮层不要叠在一起。
    setSuggestOpen(false);
    setSelectionMenu({
      text: text.slice(0, 4000),
      left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 52)
    });
  };

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
    // 在设置页/起始页切换引擎后，地址栏标签也要跟着变。
    return window.bsub.onSettingsChanged((snapshot) => {
      const next = snapshot.settings.general.searchEngine;
      if (next) setEngine(next);
    });
  }, []);

  useEffect(() => {
    if (!engineOpen) return;
    const close = (event: MouseEvent) => {
      if (engineRef.current && !engineRef.current.contains(event.target as Node)) setEngineOpen(false);
    };
    const timer = window.setTimeout(() => {
      const menu = engineRef.current;
      menu
        ?.querySelector<HTMLButtonElement>('.address-engine-menu button.is-active')
        ?.focus();
      if (!menu?.querySelector('.address-engine-menu button.is-active')) {
        menu?.querySelector<HTMLButtonElement>('.address-engine-menu button')?.focus();
      }
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      const buttons = engineRef.current
        ? [...engineRef.current.querySelectorAll<HTMLButtonElement>('.address-engine-menu button')]
        : [];
      if (!buttons.length) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setEngineOpen(false);
        engineRef.current?.querySelector<HTMLButtonElement>('.address-engine-btn')?.focus();
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
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
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
    // 每次聚焦都刷新，书签刚增删后回来能看到最新列表。
    void window.bsub.listBookmarks().then((response) => {
      if (response.ok) setBookmarks(response.data);
    });
  };

  const suggestRows = useMemo<AddressRow[]>(() => {
    const text = value.trim();
    if (!text) return [];
    const rows: AddressRow[] = [];
    const seen = new Set<string>();
    const isVideo = /^(BV[0-9A-Za-z]{10}|av\d+)$/i.test(text);
    const isScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    const isHost =
      /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(text) ||
      /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|:|$)/i.test(text);
    const direct = isVideo ? `https://www.bilibili.com/video/${text}` : text;
    if (isVideo || isScheme || isHost) {
      rows.push({
        key: 'open',
        kind: 'open',
        title: `打开 ${text}`,
        hint: isVideo ? 'B 站视频' : '网址',
        target: direct
      });
      seen.add(direct);
    } else {
      rows.push({
        key: 'search',
        kind: 'search',
        title: `用${engineLabel}搜索「${text}」`,
        hint: 'Enter',
        target: text
      });
    }

    const lower = text.toLowerCase();
    const matchedBookmarks = bookmarks
      .filter(
        (item) =>
          item.title.toLowerCase().includes(lower) || item.url.toLowerCase().includes(lower)
      )
      .slice(0, 4);
    for (const item of matchedBookmarks) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      rows.push({
        key: `b-${item.id}`,
        kind: 'bookmark',
        title: `★ ${item.title || item.url}`,
        hint: item.url,
        target: item.url
      });
      if (rows.length >= 8) break;
    }

    for (const item of suggestions) {
      if (rows.length >= 8) break;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      rows.push({
        key: `h-${item.id}`,
        kind: 'history',
        title: item.title || item.url,
        hint: item.url,
        target: item.url
      });
    }
    return rows.slice(0, 8);
  }, [bookmarks, engineLabel, suggestions, value]);

  useEffect(() => {
    // 异步建议变短时，别让高亮停在不存在的行上。
    setSuggestIndex((index) => (index >= suggestRows.length ? -1 : index));
  }, [suggestRows.length]);

  useEffect(() => {
    if (suggestIndex < 0) return;
    const row = document.getElementById(`address-suggest-${suggestIndex}`);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [suggestIndex]);

  const go = (input: string) => {
    if (onNavigate) onNavigate(input);
    else void window.bsub.navigate(input);
  };

  const pasteAndGo = async () => {
    const text = (await window.bsub.readClipboard()).trim();
    if (!text) return;
    go(text);
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

  const pickRow = (row: AddressRow) => {
    setSuggestOpen(false);
    setSuggestions([]);
    setSuggestIndex(-1);
    setEditing(false);
    inputRef.current?.blur();
    go(row.target);
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setEditing(false);
    inputRef.current?.blur();
    go(text);
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
      { id: 'copy', label: '复制当前网址', enabled: Boolean(tab?.url) },
      { id: 'paste', label: '粘贴并打开' },
      { id: 'external', label: '在外部浏览器打开', enabled: Boolean(tab?.url) },
      { id: 'reader', label: '阅读模式（Alt+R）', enabled: Boolean(tab?.url) },
      { id: 'zoom-in', label: '放大（Ctrl++）', enabled: Boolean(tab) },
      { id: 'zoom-out', label: '缩小（Ctrl+-）', enabled: Boolean(tab) },
      {
        id: 'zoom',
        label: `重置缩放（${Math.round((tab?.zoom ?? 1) * 100)}%）`,
        enabled: Boolean(tab)
      },
      { type: 'separator' },
      { id: 'start', label: '起始页' }
    ]);
    runMenuChoice(choice);
  };

  const displayValue = editing
    ? value
    : String(tab?.url || '').startsWith('file:')
      ? `本地视频 · ${tab?.title || '文件'}`
      : compactUrl(tab?.url ?? '');

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

      <div className="address-main">
      {toolbar.engine && (
      <div className="address-engine" ref={engineRef}>
        <button
          className={`address-engine-btn${engineOpen ? ' is-active' : ''}`}
          title="切换搜索引擎"
          aria-haspopup="menu"
          aria-expanded={engineOpen}
          onClick={() => {
            setSuggestOpen(false);
            setEngineOpen((value) => !value);
          }}
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
          value={displayValue}
          title={tab?.url ?? ''}
          placeholder={`在${engineLabel}搜索，或输入网址 / BV 号`}
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={suggestOpen && suggestRows.length > 0}
          aria-controls={suggestOpen && suggestRows.length > 0 ? 'address-suggest-list' : undefined}
          aria-activedescendant={
            suggestIndex >= 0 ? `address-suggest-${suggestIndex}` : undefined
          }
          onChange={(event) => {
            setEditing(true);
            setValue(event.target.value);
            setSuggestOpen(true);
            setSuggestIndex(-1);
          }}
          onFocus={(event) => {
            setEditing(true);
            setValue(canonicalUrl(tab?.url ?? ''));
            // 聚焦时不立刻弹建议：避免一点地址栏网页就整块让位；输入或按 ↓ 再弹。
            setSuggestOpen(false);
            setSuggestIndex(-1);
            loadBookmarks();
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            setValue(tab?.url ?? '');
            setSuggestIndex(-1);
            window.setTimeout(() => setSuggestOpen(false), 120);
            window.setTimeout(() => setSelectionMenu(null), 160);
          }}
          onMouseUp={showSelectionMenu}
          onKeyUp={showSelectionMenu}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' && suggestRows.length) {
              event.preventDefault();
              setSuggestOpen(true);
              setSuggestIndex((index) => (index + 1 >= suggestRows.length ? 0 : index + 1));
              return;
            }
            if (event.key === 'ArrowUp' && suggestRows.length) {
              event.preventDefault();
              setSuggestOpen(true);
              setSuggestIndex((index) => (index <= 0 ? suggestRows.length - 1 : index - 1));
              return;
            }
            if (event.key === 'Enter') {
              const row = suggestIndex >= 0 ? suggestRows[suggestIndex] : null;
              if (row) pickRow(row);
              else submit();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (suggestOpen) {
                setSuggestOpen(false);
                setSuggestIndex(-1);
                return;
              }
              setEditing(false);
              setSelectionMenu(null);
              inputRef.current?.blur();
            }
          }}
        />
        {editing && value && (
          <button
            className="address-clear"
            title="清空地址栏"
            aria-label="清空地址栏"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              // 先聚焦再清空：focus 会把地址重新填回输入框，顺序反了会把清空覆盖掉。
              inputRef.current?.focus();
              setEditing(true);
              setValue('');
              setSuggestOpen(false);
              setSuggestIndex(-1);
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {selectionMenu &&
        createPortal(
          <div
            className="address-selection-toolbar"
            style={{ left: selectionMenu.left, top: selectionMenu.top }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {[
              { id: 'copy', label: '复制' },
              { id: 'ask', label: '提问' },
              { id: 'explain', label: '解释' },
              { id: 'translate', label: '翻译' },
              { id: 'summarize', label: '总结' },
              { id: 'search', label: '搜索' },
              { id: 'speak', label: '朗读' }
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const text = selectionMenu.text;
                  setSelectionMenu(null);
                  inputRef.current?.blur();
                  onSelectionAction({ action: item.id, text });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}

      {suggestOpen && suggestRows.length > 0 && (
        <div
          className="address-suggest"
          id="address-suggest-list"
          role="listbox"
          aria-label="地址栏建议"
        >
          {suggestRows.map((row, index) => (
            <button
              key={row.key}
              id={`address-suggest-${index}`}
              className={`address-suggest-item address-suggest-${row.kind}${index === suggestIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === suggestIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSuggestIndex(index)}
              onClick={() => pickRow(row)}
            >
              <span className="address-suggest-title">{row.title}</span>
              <span className="address-suggest-url">{row.hint}</span>
            </button>
          ))}
        </div>
      )}
      </div>

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
            <button disabled={!tab?.url} onClick={() => { setMenuOpen(false); onOpenReader(); }}>阅读模式（Alt+R）</button>
            <button disabled={!tab?.url} onClick={() => { setMenuOpen(false); void window.bsub.writeClipboard(canonicalUrl(tab?.url ?? '')); }}>
              复制当前网址
            </button>
            <button onClick={() => { setMenuOpen(false); void pasteAndGo(); }}>
              粘贴并打开
            </button>
            <button disabled={!tab?.url} onClick={() => { setMenuOpen(false); if (tab?.url) void window.bsub.openExternal(tab.url); }}>
              在外部浏览器打开
            </button>
            <div className="address-menu-sep" />
            <button disabled={!tab} onClick={() => { setMenuOpen(false); void window.bsub.zoomIn(); }}>放大</button>
            <button disabled={!tab} onClick={() => { setMenuOpen(false); void window.bsub.zoomOut(); }}>缩小</button>
            <button disabled={!tab} onClick={() => { setMenuOpen(false); void window.bsub.zoomReset(); }}>
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
