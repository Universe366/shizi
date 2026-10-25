import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookOpen,
  Clock,
  Compass,
  Download,
  History,
  Library,
  ListChecks,
  Plus,
  Search,
  Settings,
  Sparkles
} from 'lucide-react';
import type { HistoryEntry, LibraryVideo, PetTodo } from '../../../shared/types';

type SearchEngineId = 'bilibili' | 'bing' | 'google' | 'custom';

const ENGINES: Array<{ id: SearchEngineId; label: string }> = [
  { id: 'bing', label: '必应' },
  { id: 'google', label: 'Google' },
  { id: 'bilibili', label: 'B 站' },
  { id: 'custom', label: '自定义' }
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

/** 新标签起始页：iTab 风格 —— 大搜索框 + 小组件卡片 + 快捷图标。 */
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
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void window.bsub.listLibrary().then((response) => {
      if (response.ok) setRecent(response.data.videos.slice(0, 4));
    });
    void window.bsub.listBrowseHistory('', 5).then((response) => {
      if (response.ok) setHistory(response.data.slice(0, 5));
    });
    void window.bsub.getSettings().then((response) => {
      if (!response.ok) return;
      setEngine(response.data.settings.general.searchEngine || 'bing');
      setTodos(response.data.settings.general.petTodos || []);
    });
  }, []);

  const engineLabel = ENGINES.find((item) => item.id === engine)?.label || '必应';

  const pickEngine = async (next: SearchEngineId) => {
    setEngine(next);
    setEngineOpen(false);
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    settings.general.searchEngine = next;
    await window.bsub.saveSettings(settings);
  };

  const submit = () => {
    const text = query.trim();
    if (!text) return;
    onClose();
    onNavigate(text);
  };

  const persistTodos = async (next: PetTodo[]) => {
    setTodos(next);
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const settings = snapshot.data.settings;
    settings.general.petTodos = next;
    await window.bsub.saveSettings(settings);
  };

  const addTodo = () => {
    const text = todoDraft.trim();
    if (!text) return;
    void persistTodos([...todos, { id: Date.now(), text: text.slice(0, 200), done: false }]);
    setTodoDraft('');
  };

  const shortcuts = useMemo(
    () => [
      { id: 'bilibili', label: '哔哩哔哩', icon: Compass, run: () => onNavigate('https://www.bilibili.com') },
      { id: 'library', label: '字幕库', icon: Library, run: onOpenLibrary },
      { id: 'history', label: '历史记录', icon: History, run: onOpenHistory },
      { id: 'tasks', label: '任务中心', icon: ListChecks, run: onOpenTasks },
      { id: 'bookmarks', label: '书签', icon: Bookmark, run: onOpenBookmarks },
      { id: 'downloads', label: '下载', icon: Download, run: onOpenDownloads },
      { id: 'search', label: '搜索', icon: Search, run: () => searchRef.current?.focus() },
      { id: 'settings', label: '设置', icon: Settings, run: onOpenSettings }
    ],
    [onNavigate, onOpenLibrary, onOpenHistory, onOpenTasks, onOpenBookmarks, onOpenDownloads, onOpenSettings]
  );

  const doneCount = todos.filter((todo) => todo.done).length;

  return (
    <div className="start-page start-page-v2">
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
              {greeting(now)}，{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
            </span>
          </div>

          <div className="start-search-v2">
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
                  {ENGINES.map((item) => (
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
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') onClose();
              }}
            />
            <button className="start-search-go" disabled={!query.trim()} onClick={submit}>
              搜索
            </button>
          </div>

          <div className="start-quick-chips">
            <span className="start-chip-label">试试：</span>
            {['B 站热门', 'AI 总结', '字幕下载'].map((text) => (
              <button
                key={text}
                className="start-chip"
                onClick={() => {
                  setQuery(text);
                  onClose();
                  onNavigate(text);
                }}
              >
                {text}
              </button>
            ))}
          </div>
        </section>

        <section className="start-widget-grid">
          <article className="start-widget-card start-todo-widget">
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
                </label>
              ))}
              {!todos.length && <div className="start-widget-empty">还没有待办，加一条试试</div>}
            </div>
            <div className="start-todo-add">
              <input
                value={todoDraft}
                placeholder="添加待办，Enter 保存"
                onChange={(event) => setTodoDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTodo();
                }}
              />
              <button title="添加" onClick={addTodo} disabled={!todoDraft.trim()}>
                <Plus size={14} />
              </button>
            </div>
          </article>

          <article className="start-widget-card">
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

          <article className="start-widget-card">
            <header>
              <Clock size={14} />
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
        </section>

        <section className="start-shortcut-grid">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className="start-shortcut" onClick={item.run}>
                <span className="start-shortcut-icon">
                  <Icon size={18} />
                </span>
                <span className="start-shortcut-label">{item.label}</span>
              </button>
            );
          })}
        </section>

        <div className="start-footnote">
          <Sparkles size={12} /> 搜索跟随右上角引擎；BV 号 / 链接会直接打开
        </div>
      </div>
    </div>
  );
}
