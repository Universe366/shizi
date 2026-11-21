import type { TabInfo } from '../../../shared/types';
import { hostOf } from './start/model';

interface Props {
  showTabs: boolean;
  tabs: TabInfo[];
  showQuote: boolean;
  quote: string;
  onHideTabs: () => void;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

export function StartPageTabQuoteWidgets({
  showTabs,
  tabs,
  showQuote,
  quote,
  onHideTabs,
  onClose,
  onNavigate
}: Props) {
  return (
    <>
      {showTabs && tabs.length > 0 && (
        <article className="sc-card">
          <header>
            <span>打开的标签</span>
            <button type="button" onClick={onHideTabs}>隐藏</button>
          </header>
          <div className="sc-recent-list">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => {
                  onClose();
                  onNavigate(item.url);
                }}
              >
                <span className="sc-recent-title">{item.title || item.url}</span>
                <span className="sc-recent-meta">{hostOf(item.url)}</span>
              </button>
            ))}
          </div>
        </article>
      )}

      {showQuote && (
        <article className="sc-card sc-quote">
          <header>
            <span>今日一句</span>
          </header>
          <p>{quote}</p>
        </article>
      )}
    </>
  );
}
