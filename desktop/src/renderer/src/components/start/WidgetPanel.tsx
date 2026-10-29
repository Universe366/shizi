import { useState } from 'react';
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
import {
  ALL_WIDGETS,
  WIDGET_LABELS,
  forecastLabel,
  formatTemperature,
  type TemperatureUnit,
  type Weather
} from './model';
import { PomodoroWidget, type PomodoroState } from './PomodoroWidget';
import { NotesWidget } from './NotesWidget';

interface WidgetPanelProps {
  order: string[];
  isVisible: (id: string) => boolean;
  editMode: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onMoveTo: (fromId: string, toId: string) => void;

  weather: Weather | null;
  city: string;
  cityEditing: boolean;
  cityDraft: string;
  onCityDraft: (value: string) => void;
  onCityStart: () => void;
  onCitySave: () => void;
  onCityCancel: () => void;
  onWeatherRefresh: () => void;
  weatherAt: number | null;
  weatherUnit: TemperatureUnit;
  onWeatherUnit: () => void;

  pomodoro: PomodoroState;

  notes: string;
  onNotes: (value: string) => void;
  onNotesClear: () => void;

  todos: PetTodo[];
  todoDraft: string;
  onTodoDraft: (value: string) => void;
  onTodoAdd: () => void;
  onTodoToggle: (id: number) => void;
  onTodoRemove: (id: number) => void;
  onTodoClearDone: () => void;
  onTodoReorder: (fromId: number, toId: number) => void;

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
    onMoveTo,
    weather,
    city,
    cityEditing,
    cityDraft,
    onCityDraft,
    onCityStart,
    onCitySave,
    onCityCancel,
    onWeatherRefresh,
    weatherAt,
    weatherUnit,
    onWeatherUnit,
    pomodoro,
    notes,
    onNotes,
    onNotesClear,
    todos,
    todoDraft,
    onTodoDraft,
    onTodoAdd,
    onTodoToggle,
    onTodoRemove,
    onTodoClearDone,
    onTodoReorder,
    hot,
    hotLoading,
    onHotRefresh,
    recent,
    history,
    onOpenLibrary,
    onOpenHistory,
    onNavigate
  } = props;

  const [todoExpanded, setTodoExpanded] = useState(false);
  const orderOf = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? 99 : index;
  };
  const doneCount = todos.filter((todo) => todo.done).length;
  const visibleTodos = todoExpanded ? todos : todos.slice(0, 4);

  return (
    <div className="start-widget-area">
      {editMode && (
        <div className="start-widget-manager">
          <span className="start-widget-manager-label">小组件</span>
          {[...order, ...ALL_WIDGETS.filter((id) => !order.includes(id))].map((id) => {
            const visible = isVisible(id);
            const index = order.indexOf(id);
            return (
              <div
                key={id}
                className={`start-widget-toggle${visible ? ' is-on' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', `widget:${id}`);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const raw = event.dataTransfer.getData('text/plain');
                  if (raw.startsWith('widget:')) onMoveTo(raw.slice(7), id);
                }}
              >
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
              <button
                className="start-widget-meta"
                title="切换温度单位"
                onClick={onWeatherUnit}
              >
                {weatherUnit === 'c' ? '°C' : '°F'}
              </button>
              <button className="start-widget-icon" title="刷新天气" onClick={onWeatherRefresh}>
                <RefreshCw size={12} />
              </button>
            </header>
            {weather ? (
              <div className="start-weather-body">
                <span className="start-weather-temp">
                  {formatTemperature(weather.temperature, weatherUnit)}
                </span>
                <div className="start-weather-desc">
                  <span>{weather.description}</span>
                  <span className="start-widget-meta">
                    {formatTemperature(weather.low, weatherUnit)} ~{' '}
                    {formatTemperature(weather.high, weatherUnit)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="start-widget-empty">
                天气获取失败
                <button className="start-widget-link" onClick={onWeatherRefresh}>
                  重试
                </button>
              </div>
            )}
            {weather?.forecast && weather.forecast.length > 1 && (
              <div className="start-weather-days">
                {weather.forecast.slice(0, 4).map((day) => (
                  <div key={day.date} className="start-weather-day">
                    <span className="start-weather-day-label">{forecastLabel(day.date)}</span>
                    <span className="start-weather-day-desc">{day.description}</span>
                    <span className="start-weather-day-temp">
                      {formatTemperature(day.low, weatherUnit)} /{' '}
                      {formatTemperature(day.high, weatherUnit)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {weather &&
              (weatherAt ||
                typeof weather.apparent === 'number' ||
                typeof weather.humidity === 'number' ||
                typeof weather.wind === 'number') && (
                <div className="start-weather-facts">
                  {typeof weather.apparent === 'number' && (
                    <span>体感 {formatTemperature(weather.apparent, weatherUnit)}</span>
                  )}
                  {typeof weather.humidity === 'number' && (
                    <span>湿度 {Math.round(weather.humidity)}%</span>
                  )}
                  {typeof weather.wind === 'number' && (
                    <span>风 {Math.round(weather.wind)} km/h</span>
                  )}
                  {weatherAt && (
                    <span>
                      更新{' '}
                      {new Date(weatherAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  )}
                </div>
              )}
          </article>
        )}

        {isVisible('todo') && (
          <article className="start-widget" style={{ order: orderOf('todo') }}>
            <header className="start-widget-head">
              <ListChecks size={15} />
              <span>待办</span>
              {todos.length > 4 ? (
                <button
                  className="start-widget-meta"
                  title={todoExpanded ? '收起待办' : '展开全部待办'}
                  onClick={() => setTodoExpanded((value) => !value)}
                >
                  {todoExpanded ? '收起' : `全部 ${todos.length}`}
                </button>
              ) : (
                <span className="start-widget-meta">
                  {doneCount}/{todos.length}
                </span>
              )}
            </header>
            <div className={`start-todo-list${todoExpanded ? ' is-expanded' : ''}`}>
              {visibleTodos.map((todo) => {
                const overdue = Boolean(todo.dueAt && !todo.done && todo.dueAt < Date.now());
                return (
                <label
                  key={todo.id}
                  className={`start-todo-item${overdue ? ' is-overdue' : ''}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', String(todo.id));
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = Number(event.dataTransfer.getData('text/plain'));
                    if (Number.isFinite(from)) onTodoReorder(from, todo.id);
                  }}
                >
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
                );
              })}
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

        {isVisible('pomodoro') && (
          <PomodoroWidget style={{ order: orderOf('pomodoro') }} {...pomodoro} />
        )}

        {isVisible('notes') && (
          <NotesWidget
            style={{ order: orderOf('notes') }}
            text={notes}
            onChange={onNotes}
            onClear={onNotesClear}
          />
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
