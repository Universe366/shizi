import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, type LucideIcon } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon?: LucideIcon;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  /** 按输入内容动态生成的命令（例如「用当前引擎搜索…」），排在其它分组之前。 */
  buildQueryCommands?: (query: string) => PaletteCommand[];
  onClose: () => void;
}

const RECENT_KEY = 'start-palette-recent';
const RECENT_LIMIT = 6;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** 子序列匹配：允许「显签」命中「显示便签」，比纯 includes 宽容。 */
function fuzzyIncludes(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const keyword = needle.toLowerCase().replace(/\s+/g, '');
  if (!keyword) return true;
  let index = 0;
  for (const char of keyword) {
    const found = text.indexOf(char, index);
    if (found < 0) return false;
    index = found + 1;
  }
  return true;
}

/** 指令面板：⌘/Ctrl+K 打开，输入过滤，↑↓ 选择，回车执行。 */
export function CommandPalette({
  open,
  commands,
  buildQueryCommands,
  onClose
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setRecentIds(readRecent());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);

  const recentCommands = useMemo(() => {
    return recentIds
      .map((id) => commands.find((command) => command.id === id))
      .filter((command): command is PaletteCommand => Boolean(command))
      .map((command) => ({ ...command, group: '最近使用' }));
  }, [commands, recentIds]);

  const filtered = useMemo(() => {
    const dynamic = buildQueryCommands ? buildQueryCommands(query) : [];
    const recentSet = new Set(recentIds);
    const rest = commands.filter((command) => !recentSet.has(command.id));
    const all = [...dynamic, ...recentCommands, ...rest];
    const keyword = query.trim();
    if (!keyword) return all;
    return all.filter((command) =>
      fuzzyIncludes(
        `${command.label} ${command.group} ${command.hint || ''} ${command.keywords || ''}`,
        keyword
      )
    );
  }, [commands, query, buildQueryCommands, recentCommands, recentIds]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      if (!command.id.startsWith('palette-')) {
        setRecentIds((current) => {
          const next = [command.id, ...current.filter((id) => id !== command.id)].slice(
            0,
            RECENT_LIMIT
          );
          saveRecent(next);
          return next;
        });
      }
      onClose();
      command.run();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((index) => Math.min(filtered.length - 1, index + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
      } else if (event.key === 'Enter') {
        const command = filtered[active];
        if (command) {
          event.preventDefault();
          runCommand(command);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab' && dialogRef.current) {
        const nodes = [
          ...dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')
        ];
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, filtered, active, onClose, runCommand]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('.start-palette-item.is-active');
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [active, open, filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteCommand[]>();
    for (const command of filtered) {
      const list = map.get(command.group) || [];
      list.push(command);
      map.set(command.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (!open) return null;

  let index = -1;
  return (
    <div className="start-palette-mask" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="start-palette"
        role="dialog"
        aria-modal="true"
        aria-label="指令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="start-palette-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索命令、页面、快捷方式…"
            aria-label="指令面板搜索"
            aria-controls="start-palette-list"
            aria-activedescendant={
              filtered[active] ? `palette-item-${filtered[active].id}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        <div
          id="start-palette-list"
          className="start-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="指令列表"
        >
          {!filtered.length && <div className="start-palette-empty">没有匹配的命令</div>}
          {groups.map(([group, items]) => (
            <div key={group} className="start-palette-group" role="group" aria-label={group}>
              <div className="start-palette-group-label">{group}</div>
              {items.map((command) => {
                index += 1;
                const current = index;
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    id={`palette-item-${command.id}`}
                    className={`start-palette-item${current === active ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={current === active}
                    onMouseEnter={() => setActive(current)}
                    onClick={() => runCommand(command)}
                  >
                    {Icon ? <Icon size={15} /> : <span className="start-palette-dot" />}
                    <span className="start-palette-label">{command.label}</span>
                    {command.hint && <span className="start-palette-hint">{command.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="start-palette-foot">
          <span>↑↓ 选择</span>
          <span>↵ 执行</span>
          <span>Tab 切换</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
