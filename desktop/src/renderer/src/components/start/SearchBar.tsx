import { useEffect, useRef, type RefObject } from 'react';
import { ChevronDown, Globe, History, Search } from 'lucide-react';
import { SEARCH_ENGINES } from '../../../../shared/searchEngines';
import type { SearchEngineId } from '../../../../shared/searchEngines';

export interface Suggestion {
  text: string;
  label: string;
  kind: 'shortcut' | 'open' | 'video' | 'search' | 'history';
  hint?: string;
}

interface SearchBarProps {
  query: string;
  engine: SearchEngineId;
  engineLabel: string;
  engineOpen: boolean;
  searchOpen: boolean;
  active: number;
  suggestions: Suggestion[];
  inputRef: RefObject<HTMLInputElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
  onChange: (value: string) => void;
  onFocus: () => void;
  onToggleEngine: () => void;
  onPickEngine: (engine: SearchEngineId) => void;
  onCommit: (text: string) => void;
  onSubmit: () => void;
  onActive: (index: number) => void;
  onHover: (index: number) => void;
  onEscape: () => void;
}

function SuggestionIcon({ kind }: { kind: Suggestion['kind'] }) {
  if (kind === 'history') return <History size={13} />;
  if (kind === 'open' || kind === 'shortcut') return <Globe size={13} />;
  if (kind === 'video') return <Search size={13} />;
  return <Search size={13} />;
}

/** 起始页搜索：引擎切换 + 站内快捷方式直达 + 历史 + 搜索。 */
export function SearchBar({
  query,
  engine,
  engineLabel,
  engineOpen,
  searchOpen,
  active,
  suggestions,
  inputRef,
  boxRef,
  onChange,
  onFocus,
  onToggleEngine,
  onPickEngine,
  onCommit,
  onSubmit,
  onActive,
  onHover,
  onEscape
}: SearchBarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef(onToggleEngine);
  toggleRef.current = onToggleEngine;

  useEffect(() => {
    if (!engineOpen) return;
    const timer = window.setTimeout(() => {
      menuRef.current?.querySelector('button')?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      const buttons = menuRef.current
        ? [...menuRef.current.querySelectorAll<HTMLButtonElement>('button')]
        : [];
      if (!buttons.length) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        toggleRef.current();
        engineRef.current?.focus();
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
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [engineOpen]);

  const jump = () => {
    const item = active >= 0 ? suggestions[active] : null;
    if (item) onCommit(item.text);
    else onSubmit();
  };

  return (
    <div className="start-search" ref={boxRef}>
      <div className="start-engine-wrap">
        <button
          ref={engineRef}
          className={`start-engine${engineOpen ? ' is-open' : ''}`}
          title="切换搜索引擎"
          aria-haspopup="menu"
          aria-expanded={engineOpen}
          onClick={onToggleEngine}
        >
          <span>{engineLabel}</span>
          <ChevronDown size={13} />
        </button>
        {engineOpen && (
          <div className="start-engine-menu" role="menu" ref={menuRef}>
            {SEARCH_ENGINES.map((item) => (
              <button
                key={item.id}
                className={item.id === engine ? 'is-active' : ''}
                onClick={() => onPickEngine(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Search size={17} className="start-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={`在 ${engineLabel} 搜索，或输入网址 / BV 号…`}
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={searchOpen && suggestions.length > 0}
        aria-controls="start-suggest-list"
        aria-activedescendant={
          active >= 0 && suggestions[active] ? `start-suggest-${active}` : undefined
        }
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            jump();
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onActive(Math.min(suggestions.length - 1, active + 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onActive(Math.max(-1, active - 1));
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onEscape();
          }
        }}
      />
      <kbd className="start-kbd">Enter</kbd>
      <button className="start-search-go" aria-label="搜索" disabled={!query.trim()} onClick={onSubmit}>
        <Search size={15} />
      </button>

      {searchOpen && suggestions.length > 0 && (
        <div className="start-suggest" role="listbox" id="start-suggest-list">
          {suggestions.map((item, index) => (
            <button
              key={`${item.kind}-${item.text}-${index}`}
              id={`start-suggest-${index}`}
              className={`start-suggest-item${active === index ? ' is-active' : ''}`}
              role="option"
              aria-selected={active === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onCommit(item.text)}
            >
              <span className="start-suggest-icon">
                <SuggestionIcon kind={item.kind} />
              </span>
              <span className="start-suggest-text">{item.label}</span>
              <span className="start-suggest-kind">
                {item.hint ||
                  (item.kind === 'open' || item.kind === 'video' || item.kind === 'shortcut'
                    ? '打开'
                    : item.kind === 'history'
                      ? '历史'
                      : engineLabel)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
