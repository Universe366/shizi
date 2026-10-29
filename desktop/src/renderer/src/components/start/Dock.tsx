import { Check, CloudSun, Command, Pencil, Sparkles, Timer, X } from 'lucide-react';
import type { StartShortcut } from '../../../../shared/types';
import { SiteIcon } from './SiteIcon';
import type { BuiltInEntry } from './ShortcutBoard';
import {
  POMODORO_LABELS,
  formatPomodoro,
  type PomodoroPhase,
  type Weather
} from './model';

interface DockProps {
  shortcuts: StartShortcut[];
  builtIn: BuiltInEntry[];
  weather: Weather | null;
  pomodoro: { phase: PomodoroPhase; left: number; running: boolean; onToggle: () => void };
  zen: boolean;
  onOpenShortcut: (item: StartShortcut) => void;
  onReorder: (fromId: string, toId: string) => void;
  onMenu: (item: StartShortcut, x: number, y: number) => void;
  onBuiltIn: (entry: BuiltInEntry) => void;
  onPalette: () => void;
  onZen: () => void;
  editing: boolean;
  onEdit: () => void;
  onRemove: (id: string) => void;
}

/** 底部 Dock：常用站点 + 内置页面 + 指令面板 / 禅模式入口。 */
export function Dock({
  shortcuts,
  builtIn,
  weather,
  pomodoro,
  zen,
  onOpenShortcut,
  onReorder,
  onMenu,
  onBuiltIn,
  onPalette,
  onZen,
  editing,
  onEdit,
  onRemove
}: DockProps) {
  return (
    <nav className={`start-dock${editing ? ' is-editing' : ''}`} aria-label="起始页 Dock">
      {shortcuts.map((item) => (
        <button
          key={item.id}
          className="start-dock-item"
          title={item.label}
          aria-label={item.label}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', `dock:${item.id}`);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const raw = event.dataTransfer.getData('text/plain');
            if (raw.startsWith('dock:')) onReorder(raw.slice(5), item.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu(item, event.clientX, event.clientY);
          }}
          onClick={() => {
            if (!editing) onOpenShortcut(item);
          }}
        >
          <SiteIcon item={item} small />
          {editing && (
            <span
              className="start-dock-remove"
              title="从 Dock 移除"
              role="button"
              aria-label={`从 Dock 移除 ${item.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item.id);
              }}
            >
              <X size={10} />
            </span>
          )}
        </button>
      ))}

      {shortcuts.length > 0 && builtIn.length > 0 && (
        <span className="start-dock-sep" aria-hidden="true" />
      )}

      {builtIn.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            className="start-dock-item"
            title={entry.label}
            aria-label={entry.label}
            onClick={() => onBuiltIn(entry)}
          >
            <Icon size={17} />
          </button>
        );
      })}

      {weather && (
        <span className="start-dock-weather" title={`${weather.city} · ${weather.description}`}>
          <CloudSun size={15} />
          {weather.description} {Math.round(weather.temperature)}°
        </span>
      )}

      <span className="start-dock-sep" aria-hidden="true" />

      <button
        className={`start-dock-item start-dock-pomo${pomodoro.running ? ' is-running' : ''}`}
        title={`${POMODORO_LABELS[pomodoro.phase]} · ${formatPomodoro(pomodoro.left)}（点击${
          pomodoro.running ? '暂停' : '开始'
        }）`}
        aria-label="番茄钟"
        onClick={pomodoro.onToggle}
      >
        <Timer size={16} />
        <span className="start-dock-pomo-badge">{Math.ceil(pomodoro.left / 60)}</span>
      </button>

      <button
        className="start-dock-item start-dock-primary"
        title="指令面板（Ctrl/⌘+K）"
        aria-label="指令面板"
        onClick={onPalette}
      >
        <Command size={17} />
        <span className="start-dock-kbd">K</span>
      </button>

      <button
        className={`start-dock-item${zen ? ' is-active' : ''}`}
        title={zen ? '退出禅模式' : '禅模式'}
        aria-label={zen ? '退出禅模式' : '禅模式'}
        onClick={onZen}
      >
        <Sparkles size={17} />
      </button>

      <button
        className={`start-dock-item${editing ? ' is-active' : ''}`}
        title={editing ? '完成 Dock 编辑' : '编辑 Dock'}
        aria-label={editing ? '完成 Dock 编辑' : '编辑 Dock'}
        onClick={onEdit}
      >
        {editing ? <Check size={16} /> : <Pencil size={15} />}
      </button>
    </nav>
  );
}
