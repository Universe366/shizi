import { useState } from 'react';
import { Trash2, X } from 'lucide-react';

type Range = 'hour' | 'today' | 'all';

const RANGES: Array<{ id: Range; label: string }> = [
  { id: 'hour', label: '最近 1 小时' },
  { id: 'today', label: '今天' },
  { id: 'all', label: '全部时间' }
];

/**
 * 清除浏览数据：对齐 Chrome 的「清除浏览数据」对话框。
 * 历史与下载记录按时间范围清；Cookie / 缓存由 Chromium 全量清，界面上写明。
 */
export function ClearBrowsingDataDialog({ onClose }: { onClose: () => void }) {
  const [range, setRange] = useState<Range>('hour');
  const [history, setHistory] = useState(true);
  const [downloads, setDownloads] = useState(true);
  const [cookies, setCookies] = useState(false);
  const [cache, setCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const clear = async () => {
    if (!history && !downloads && !cookies && !cache) {
      setNotice('至少选择一项');
      return;
    }
    if (cookies && !window.confirm('清理 Cookie 与站点数据会退出所有网站登录，继续？')) return;
    setBusy(true);
    setNotice('');
    const since =
      range === 'all' ? 0 : range === 'hour' ? Date.now() - 3_600_000 : new Date().setHours(0, 0, 0, 0);
    const response = await window.bsub.clearBrowsingDataRange?.({
      since,
      history,
      downloads,
      cookies,
      cache
    });
    setBusy(false);
    if (!response?.ok) {
      setNotice(response?.error || '清理失败');
      return;
    }
    const parts = [`历史 ${response.data.history} 条`, `下载记录 ${response.data.downloads} 条`];
    if (cookies) parts.push('站点数据');
    if (cache) parts.push('缓存');
    setNotice(`已清理：${parts.join('、')}`);
  };

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card clear-data-dialog"
        role="dialog"
        aria-label="清除浏览数据"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="hub-title-row">
            <Trash2 size={14} />
            <strong>清除浏览数据</strong>
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="settings-label">时间范围</div>
        <select
          className="settings-input"
          value={range}
          onChange={(event) => setRange(event.target.value as Range)}
        >
          {RANGES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>

        <div className="settings-label">要清除的内容</div>
        <div className="settings-check-grid">
          <label className="settings-check">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            浏览历史
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={downloads} onChange={(e) => setDownloads(e.target.checked)} />
            下载记录（不删文件）
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={cookies} onChange={(e) => setCookies(e.target.checked)} />
            Cookie 与站点数据
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={cache} onChange={(e) => setCache(e.target.checked)} />
            缓存文件
          </label>
        </div>
        <div className="settings-hint">
          历史与下载记录按时间范围清理；Cookie 与缓存由 Chromium 整体清理，不受时间范围限制。
        </div>
        {notice && <div className="settings-hint">{notice}</div>}

        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            取消
          </button>
          <button className="mini-btn danger" disabled={busy} onClick={() => void clear()}>
            {busy ? '清理中…' : '清除数据'}
          </button>
        </div>
      </div>
    </div>
  );
}
