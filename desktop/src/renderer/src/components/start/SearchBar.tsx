import type { RefObject } from 'react';
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
  const jump = () => {
    const item = active >= 0 ? suggestions[active] : null;
    if (item) onCommit(item.text);
    else onSubmit();
  };

  return (
    <div className="start-search" ref={boxRef}>
      <div className="start-engine-wrap">
        <button
          className={`start-engine${engineOpen ? ' is-open' : ''}`}
          title="切换搜索引擎"
          onClick={onToggleEngine}
        >
          <span>{engineLabel}</span>
          <ChevronDown size={13} />
        </button>
        {engineOpen && (
          <div className="start-engine-menu" role="menu">
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
        <div className="start-suggest" role="listbox">
          {suggestions.map((item, index) => (
            <button
              key={`${item.kind}-${item.text}-${index}`}
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
