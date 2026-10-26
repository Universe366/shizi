import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2 } from 'lucide-react';

/** 在线视频下载：输入链接，交给 yt-dlp；只处理用户有权下载的内容。 */
export function DownloadVideoDialog({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
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

  const submit = async () => {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      setMessage('请填写 http/https 链接');
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

  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="confirm-card" role="dialog" aria-modal="true" aria-label="下载在线视频">
        <div className="confirm-title">下载在线视频</div>
        <div className="confirm-desc">
          支持 B 站 / YouTube 等 yt-dlp 可解析的公开链接；请只下载你有权保存的内容。
        </div>
        <input
          className="settings-input"
          value={url}
          placeholder="https://www.bilibili.com/video/BV…"
          spellCheck={false}
          autoFocus
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="settings-hint">
          首次使用会自动下载 yt-dlp（约 17MB）到软件目录；输出在「下载/Shizi」。
        </div>
        {message && <div className="settings-hint">{message}</div>}
        {donePath && (
          <div className="settings-inline">
            <span className="settings-hint" style={{ flex: 1 }}>{donePath}</span>
            <button className="mini-btn" onClick={() => void window.bsub.revealExport(donePath)}>
              <FolderOpen size={12} /> 打开文件夹
            </button>
          </div>
        )}
        <div className="resegment-actions">
          <button className="mini-btn" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button className="mini-btn primary" onClick={() => void submit()} disabled={busy || !url.trim()}>
            {busy ? <Loader2 size={12} className="spin" /> : <Download size={12} />} 开始下载
          </button>
        </div>
      </div>
    </div>
  );
}
