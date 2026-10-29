import { useEffect, useMemo, useRef, useState } from 'react';
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

/** 指令面板：⌘/Ctrl+K 打开，输入过滤，↑↓ 选择，回车执行。 */
export function CommandPalette({
  open,
  commands,
  buildQueryCommands,
  onClose
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const dynamic = buildQueryCommands ? buildQueryCommands(query) : [];
    const all = [...dynamic, ...commands];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return all;
    return all.filter((command) =>
      `${command.label} ${command.group} ${command.hint || ''} ${command.keywords || ''}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [commands, query, buildQueryCommands]);

  useEffect(() => {
    setActive(0);
  }, [query]);

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
          onClose();
          command.run();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, filtered, active, onClose]);

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
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="start-palette-list" ref={listRef}>
          {!filtered.length && <div className="start-palette-empty">没有匹配的命令</div>}
          {groups.map(([group, items]) => (
            <div key={group} className="start-palette-group">
              <div className="start-palette-group-label">{group}</div>
              {items.map((command) => {
                index += 1;
                const current = index;
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    className={`start-palette-item${current === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(current)}
                    onClick={() => {
                      onClose();
                      command.run();
                    }}
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
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
