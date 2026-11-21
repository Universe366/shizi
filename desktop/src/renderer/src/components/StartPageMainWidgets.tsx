import type { LibraryVideo } from '../../../shared/types';
import { hostOf } from './start/model';

interface Props {
  hotOn: boolean;
  hot: string[];
  showRecent: boolean;
  recent: LibraryVideo[];
  onGlobalSearch: () => void;
  onLibrary: () => void;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

/** 起始页热搜 / 最近打开 / 打开的标签 / 每日一句。 */
export function StartPageMainWidgets({
  hotOn,
  hot,
  showRecent,
  recent,
  onGlobalSearch,
  onLibrary,
  onClose,
  onNavigate
}: Props) {
  return (
    <>
      {hotOn && hot.length > 0 && (
        <article className="sc-card">
          <header>
            <span>B 站热搜</span>
            <button type="button" onClick={onGlobalSearch}>更多</button>
          </header>
          <div className="sc-rank-list">
            {hot.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  onClose();
                  onNavigate(
                    `https://search.bilibili.com/all?keyword=${encodeURIComponent(item)}`
                  );
                }}
              >
                <span className={`sc-rank${index < 3 ? ' is-hot' : ''}`}>{index + 1}</span>
                <span>{item}</span>
              </button>
            ))}
          </div>
        </article>
      )}

      {showRecent && recent.length > 0 && (
        <article className="sc-card">
          <header>
            <span>最近打开</span>
            <button type="button" onClick={onLibrary}>工作台</button>
          </header>
          <div className="sc-recent-list">
            {recent.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => {
                  onClose();
                  onNavigate(item.url);
                }}
              >
                <span className="sc-recent-title">{item.title}</span>
                <span className="sc-recent-meta">{item.owner || hostOf(item.url)}</span>
              </button>
            ))}
          </div>
        </article>
      )}

    </>
  );
}
