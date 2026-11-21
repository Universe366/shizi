import type { RefObject } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { SEARCH_ENGINES, isSearchEngineId, searchEngineLabel } from '../../../shared/searchEngines';

interface Suggestion {
  id: string;
  kind: string;
  label: string;
}

interface Props {
  engine: string;
  engineOpen: boolean;
  query: string;
  suggestOpen: boolean;
  suggestions: Suggestion[];
  activeSuggestion: number;
  searchRef: RefObject<HTMLInputElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
  onEngineToggle: () => void;
  onEngineSelect: (id: string) => void;
  onQuery: (value: string) => void;
  onFocus: () => void;
  onActive: (index: number) => void;
  onSubmit: () => void;
  onPick: (item: Suggestion) => void;
  onCloseSuggest: () => void;
}

/** 起始页搜索：引擎切换、联想、历史/站点建议。 */
export function StartPageSearch({
  engine,
  engineOpen,
  query,
  suggestOpen,
  suggestions,
  activeSuggestion,
  searchRef,
  wrapRef,
  onEngineToggle,
  onEngineSelect,
  onQuery,
  onFocus,
  onActive,
  onSubmit,
  onPick,
  onCloseSuggest
}: Props) {
  return (
    <div className="sc-search-wrap" ref={wrapRef}>
      <button type="button" className="sc-engine" title="切换搜索引擎" onClick={onEngineToggle}>
        {searchEngineLabel(engine as never)}
      </button>
      <Search size={17} className="sc-search-icon" />
      <input
        ref={searchRef}
        className="sc-search-input"
        value={query}
        placeholder="搜索，或输入网址"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onQuery(event.target.value);
          onActive(-1);
        }}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onActive(Math.min(suggestions.length - 1, activeSuggestion + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            onActive(Math.max(-1, activeSuggestion - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const active = suggestions[activeSuggestion];
            if (active) onPick(active);
            else onSubmit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            onCloseSuggest();
          }
        }}
      />
      <kbd className="sc-kbd">/</kbd>
      <button type="button" className="sc-go" title="搜索" onClick={onSubmit}>
        <ArrowRight size={17} />
      </button>

      {engineOpen && (
        <div className="sc-engine-menu">
          {SEARCH_ENGINES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === engine ? 'is-active' : ''}
              onClick={() => {
                if (isSearchEngineId(item.id)) onEngineSelect(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {suggestOpen && suggestions.length > 0 && (
        <div className="sc-suggest">
          {suggestions.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === activeSuggestion ? 'is-active' : ''}
              onMouseEnter={() => onActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item)}
            >
              {item.kind === 'shortcut' ? (
                <span className="sc-suggest-kind">站点</span>
              ) : item.kind === 'history' ? (
                <span className="sc-suggest-kind">历史</span>
              ) : (
                <Search size={12} />
              )}
              <span className="sc-suggest-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
