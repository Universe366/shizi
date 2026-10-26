import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, Search } from 'lucide-react';
import type { LibraryVideo } from '../../../shared/types';
import { formatDuration } from '../lib/format';

/** 下载视频：优先从资料库直接选，也支持粘贴外部链接交给 yt-dlp。 */
export function DownloadVideoDialog({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<'library' | 'url'>('library');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [donePath, setDonePath] = useState('');

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setDonePath('');
    setRequestId('');
    setBusy(false);
    setSource('library');
    setQuery('');
    setLoading(true);
    void window.bsub
      .listLibrary()
      .then((response) => {
        if (response.ok) setLibrary(response.data.videos.slice(0, 200));
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const offDone = window.bsub.onDownloadDone?.((event) => {
      if (requestId && event.requestId !== requestId) return;
      setBusy(false);
      setDonePath(event.path);
      setMessage('下载完成');
    });
    const offError = window.bsub.onDownloadError?.((event) => {
      if (requestId && event.requestId !== requestId) return;
      setBusy(false);
      setMessage(event.error);
    });
    return () => {
      offDone?.();
      offError?.();
    };
  }, [open, requestId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const submit = async (raw: string) => {
    const value = raw.trim();
    if (!/^https?:\/\//i.test(value)) {
      setMessage('请选择资料库视频，或填写 http/https 链接');
      return;
    }
    setBusy(true);
    setMessage('已提交下载任务…');
    const response = await window.bsub.downloadOnlineVideo?.(value);
    if (!response) {
      setBusy(false);
      setMessage('当前版本不支持在线下载');
      return;
    }
    if (!response.ok) {
      setBusy(false);
      setMessage(response.error);
      return;
    }
    setRequestId(response.data.requestId);
    setMessage('下载中，进度见右下角「任务」；完成后这里会显示文件位置');
  };

  const filtered = query.trim()
    ? library.filter((video) =>
        `${video.title} ${video.owner}`.toLowerCase().includes(query.trim().toLowerCase())
      )
    : library;

  return (
    <div className="confirm-backdrop" role="presentation">
      <div
        className="confirm-card download-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="下载视频"
      >
        <div className="confirm-title">下载视频</div>
        <div className="confirm-desc">
          直接从资料库选一条视频下载，或粘贴外部链接；请只下载你有权保存的内容。
        </div>

        <div className="download-source-tabs">
          <button
            className={source === 'library' ? 'is-active' : ''}
            onClick={() => setSource('library')}
          >
            从资料库
          </button>
          <button
            className={source === 'url' ? 'is-active' : ''}
            onClick={() => setSource('url')}
          >
            在线链接
          </button>
        </div>

        {source === 'library' ? (
          <>
            <div className="download-search">
              <Search size={13} />
              <input
                className="settings-input"
                value={query}
                placeholder="搜索库里的视频…"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="download-library">
              {loading && <div className="settings-hint">读取资料库…</div>}
              {!loading && !filtered.length && (
                <div className="settings-hint">资料库还没有视频，先去字幕库入库。</div>
              )}
              {filtered.slice(0, 30).map((video) => (
                <div className="download-library-row" key={video.id}>
                  <div className="download-library-main">
                    <span className="download-library-title">{video.title}</span>
                    <span className="download-library-meta">
                      {video.owner || '未知 UP'} · {formatDuration(video.duration)} ·{' '}
                      {video.url.replace(/^https?:\/\//, '').slice(0, 48)}
                    </span>
                  </div>
                  <button
                    className="mini-btn primary"
                    disabled={busy}
                    onClick={() => void submit(video.url)}
                  >
                    <Download size={11} /> 下载
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <input
              className="settings-input download-url-input"
              value={url}
              placeholder="https://www.bilibili.com/video/BV…"
              spellCheck={false}
              autoFocus
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit(url);
              }}
            />
            <div className="settings-hint">
              支持 B 站 / YouTube 等 yt-dlp 可解析的公开链接；输出在「下载/Shizi」。
            </div>
            <button
              className="mini-btn primary"
              disabled={busy || !url.trim()}
              onClick={() => void submit(url)}
            >
              {busy ? <Loader2 size={12} className="spin" /> : <Download size={12} />} 开始下载
            </button>
          </>
        )}

        {message && <div className="settings-hint">{message}</div>}
        {donePath && (
          <div className="settings-inline">
            <span className="settings-hint" style={{ flex: 1 }}>
              {donePath}
            </span>
            <button className="mini-btn" onClick={() => void window.bsub.revealExport(donePath)}>
              <FolderOpen size={12} /> 打开文件夹
            </button>
          </div>
        )}

        <div className="resegment-actions">
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
