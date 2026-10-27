import {
  BookOpen,
  CloudSun,
  Flame,
  History,
  ListChecks,
  MapPin,
  Plus,
  RefreshCw,
  X
} from 'lucide-react';
import { formatReminder } from '../../../../shared/reminder';
import type { HistoryEntry, LibraryVideo, PetTodo } from '../../../../shared/types';
import { ALL_WIDGETS, WIDGET_LABELS, type Weather } from './model';

interface WidgetPanelProps {
  order: string[];
  isVisible: (id: string) => boolean;
  editMode: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, delta: number) => void;

  weather: Weather | null;
  city: string;
  cityEditing: boolean;
  cityDraft: string;
  onCityDraft: (value: string) => void;
  onCityStart: () => void;
  onCitySave: () => void;
  onCityCancel: () => void;

  todos: PetTodo[];
  todoDraft: string;
  onTodoDraft: (value: string) => void;
  onTodoAdd: () => void;
  onTodoToggle: (id: number) => void;
  onTodoRemove: (id: number) => void;
  onTodoClearDone: () => void;

  hot: string[];
  hotLoading: boolean;
  onHotRefresh: () => void;

  recent: LibraryVideo[];
  history: HistoryEntry[];
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onNavigate: (url: string) => void;
}

/** 起始页小组件：天气 / 待办 / 热搜 / 最近入库 / 最近访问。 */
export function WidgetPanel(props: WidgetPanelProps) {
  const {
    order,
    isVisible,
    editMode,
    onToggle,
    onMove,
    weather,
    city,
    cityEditing,
    cityDraft,
    onCityDraft,
    onCityStart,
    onCitySave,
    onCityCancel,
    todos,
    todoDraft,
    onTodoDraft,
    onTodoAdd,
    onTodoToggle,
    onTodoRemove,
    onTodoClearDone,
    hot,
    hotLoading,
    onHotRefresh,
    recent,
    history,
    onOpenLibrary,
    onOpenHistory,
    onNavigate
  } = props;

  const orderOf = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? 99 : index;
  };
  const doneCount = todos.filter((todo) => todo.done).length;

  return (
    <div className="start-widget-area">
      {editMode && (
        <div className="start-widget-manager">
          <span className="start-widget-manager-label">小组件</span>
          {[...order, ...ALL_WIDGETS.filter((id) => !order.includes(id))].map((id) => {
            const visible = isVisible(id);
            const index = order.indexOf(id);
            return (
              <div key={id} className={`start-widget-toggle${visible ? ' is-on' : ''}`}>
                <label>
                  <input type="checkbox" checked={visible} onChange={() => onToggle(id)} />
                  {WIDGET_LABELS[id] || id}
                </label>
                {visible && (
                  <>
                    <button title="往前移" disabled={index <= 0} onClick={() => onMove(id, -1)}>
                      ↑
                    </button>
                    <button
                      title="往后移"
                      disabled={index >= order.length - 1}
                      onClick={() => onMove(id, 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="start-widget-grid">
        {isVisible('weather') && (
          <article
            className="start-widget start-weather-widget"
            style={{ order: orderOf('weather') }}
          >
            <header className="start-widget-head">
              <CloudSun size={15} />
              <span>天气</span>
              {cityEditing ? (
                <span className="start-city-edit">
                  <input
                    autoFocus
                    value={cityDraft}
                    onChange={(event) => onCityDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onCitySave();
                      if (event.key === 'Escape') onCityCancel();
                    }}
                  />
                  <button title="保存城市" onClick={onCitySave}>
                    ✓
                  </button>
                </span>
              ) : (
                <button className="start-widget-meta" title="点击切换城市" onClick={onCityStart}>
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

        {isVisible('todo') && (
          <article className="start-widget" style={{ order: orderOf('todo') }}>
            <header className="start-widget-head">
              <ListChecks size={15} />
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
                    onChange={() => onTodoToggle(todo.id)}
                  />
                  <span className={todo.done ? 'is-done' : ''}>{todo.text}</span>
                  {todo.dueAt && <span className="start-todo-due">{formatReminder(todo.dueAt)}</span>}
                  <button
                    className="start-todo-remove"
                    title="删除待办"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onTodoRemove(todo.id);
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
                onChange={(event) => onTodoDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onTodoAdd();
                }}
              />
              <button title="添加" onClick={onTodoAdd} disabled={!todoDraft.trim()}>
                <Plus size={14} />
              </button>
            </div>
            {doneCount > 0 && (
              <button className="start-todo-clear" onClick={onTodoClearDone}>
                清除已完成（{doneCount}）
              </button>
            )}
          </article>
        )}

        {isVisible('hot') && (
          <article className="start-widget" style={{ order: orderOf('hot') }}>
            <header className="start-widget-head">
              <Flame size={15} />
              <span>B 站热搜</span>
              <button
                className="start-widget-icon"
                title="刷新热搜"
                disabled={hotLoading}
                onClick={onHotRefresh}
              >
                <RefreshCw size={12} className={hotLoading ? 'spin' : ''} />
              </button>
              <button className="start-widget-link" onClick={() => onNavigate('https://www.bilibili.com')}>
                去 B 站
              </button>
            </header>
            <div className="start-list">
              {hot.map((word, index) => (
                <button
                  key={word}
                  className="start-list-item"
                  title={word}
                  onClick={() =>
                    onNavigate(
                      `https://search.bilibili.com/all?keyword=${encodeURIComponent(word)}`
                    )
                  }
                >
                  <span className={`start-hot-rank${index < 3 ? ' is-top' : ''}`}>{index + 1}</span>
                  <span className="start-list-title">{word}</span>
                </button>
              ))}
              {!hot.length && <div className="start-widget-empty">热搜加载中…</div>}
            </div>
          </article>
        )}

        {isVisible('recent') && (
          <article className="start-widget" style={{ order: orderOf('recent') }}>
            <header className="start-widget-head">
              <BookOpen size={15} />
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
                  onClick={() => onNavigate(video.url)}
                >
                  <span className="start-list-title">{video.title}</span>
                  <span className="start-list-meta">{video.owner || '未知 UP'}</span>
                </button>
              ))}
              {!recent.length && <div className="start-widget-empty">库里还没有视频</div>}
            </div>
          </article>
        )}

        {isVisible('history') && (
          <article className="start-widget" style={{ order: orderOf('history') }}>
            <header className="start-widget-head">
              <History size={15} />
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
                  onClick={() => onNavigate(entry.url)}
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
    </div>
  );
}
