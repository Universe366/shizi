import { useEffect, useState } from 'react';
import type { WebSearchDiagnostics } from '../../../../shared/types';

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function clockOf(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

/** 检索诊断：最近若干次检索的耗时、去重率、失败率与抓取缓存大小。 */
export function SearchDiagnostics() {
  const [data, setData] = useState<WebSearchDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const api = (window as unknown as { bsub?: Window['bsub'] }).bsub;

  const load = async () => {
    setBusy(true);
    try {
      const response = await api?.webMetrics?.();
      if (response?.ok) setData(response.data);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clearMetrics = async () => {
    const response = await api?.webMetricsClear?.();
    if (response?.ok) {
      setMessage(`已清空 ${response.data} 条记录`);
      await load();
    }
  };

  const clearCache = async () => {
    const response = await api?.webCacheClear?.();
    if (response?.ok) {
      setMessage(`已清空 ${response.data} 篇抓取缓存`);
      await load();
    }
  };

  return (
    <details className="settings-advanced">
      <summary>检索诊断</summary>
      <div className="settings-hint">
        只统计当前会话内的检索计划：耗时、去重率与失败率，用于判断 provider 与计划条数是否合适。
      </div>
      {data && data.stats.count > 0 ? (
        <>
          <div className="settings-inline search-diag-grid">
            <div>
              <div className="settings-label">检索次数</div>
              <div>{data.stats.count}</div>
            </div>
            <div>
              <div className="settings-label">平均耗时</div>
              <div>{data.stats.avgLatency} ms</div>
            </div>
            <div>
              <div className="settings-label">去重率</div>
              <div>{percent(data.stats.dedupeRate)}</div>
            </div>
            <div>
              <div className="settings-label">失败率</div>
              <div>{percent(data.stats.failureRate)}</div>
            </div>
            <div>
              <div className="settings-label">抓取缓存</div>
              <div>{data.cacheSize} 篇</div>
            </div>
          </div>
          <div className="search-diag-list">
            {data.recent.slice(0, 6).map((item) => (
              <div className="search-diag-row" key={item.at}>
                <span className="search-diag-time">{clockOf(item.at)}</span>
                <span className="search-diag-engine">{item.engine}</span>
                <span className="search-diag-query" title={item.queries.join(' / ')}>
                  {item.queries.join(' / ')}
                </span>
                <span className="search-diag-stat">
                  {item.elapsedMs} ms · {item.raw}→{item.deduped}
                  {item.failures ? ` · 失败 ${item.failures}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="settings-hint">本次会话还没有检索记录。</div>
      )}
      {message && <div className="settings-hint">{message}</div>}
      <div className="settings-inline">
        <button className="mini-btn" disabled={busy} onClick={() => void load()}>
          {busy ? '读取中…' : '刷新'}
        </button>
        <button className="mini-btn" onClick={() => void clearMetrics()}>
          清空统计
        </button>
        <button className="mini-btn" onClick={() => void clearCache()}>
          清空抓取缓存
        </button>
      </div>
    </details>
  );
}
