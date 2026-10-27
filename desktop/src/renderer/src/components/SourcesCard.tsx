import type { WebReference } from '../../../shared/types';

const TYPE_LABEL: Record<string, string> = {
  official: '官方',
  paper: '论文',
  repo: '仓库',
  news: '新闻',
  forum: '社区',
  blog: '博客',
  other: '资料'
};

/** 总结下方的「外部资料」面板：只展示来源，不参与正文改写。 */
export function SourcesCard({
  sources,
  citePrefix = 'summary'
}: {
  sources: WebReference[];
  citePrefix?: string;
}) {
  if (!sources.length) return null;
  return (
    <details className="sources-card">
      <summary className="sources-head">
        <span>外部资料</span>
        <span className="settings-hint">{sources.length} 条 · 仅作补充与对照</span>
      </summary>
      <div className="sources-list">
        {sources.map((source, index) => (
          <button
            key={`${index}-${source.url}`}
            id={`cite-${citePrefix}-${index + 1}`}
            className="sources-row"
            title={source.url}
            onClick={() => void window.bsub.openExternal(source.url)}
          >
            <span className="sources-index">[{index + 1}]</span>
            <span className="sources-main">
              <span className="sources-title">{source.title || source.url}</span>
              <span className="sources-meta">
                {[
                  source.site,
                  source.date ? String(source.date).slice(0, 10) : '',
                  source.sourceType ? TYPE_LABEL[source.sourceType] || '' : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
