import { useEffect, useState } from 'react';
import { Clapperboard, ExternalLink, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { ExportRecord } from '../../../shared/types';
import { formatDateTime } from '../lib/format';

/** 成片：已经合成好的视频（硬字幕/软字幕），可直接打开或定位。 */
export function RendersPanel() {
  const [items, setItems] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await window.bsub.listExports();
      if (!response.ok) throw new Error(response.error);
      setItems(
        response.data.filter(
          (item) => item.kind.startsWith('video-') || item.kind === 'dub-video'
        )
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const off = window.bsub.onSynthesizeDone?.(() => void load());
    return () => off?.();
  }, []);

  const remove = async (id: number) => {
    const response = await window.bsub.deleteExport(id);
    if (!response.ok) {
      setMessage(response.error);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div className="renders-panel">
      <div className="renders-head">
        <div>
          <div className="renders-title">成片</div>
          <div className="settings-hint">
            字幕烧录/封装后的视频记录；文件仍在你选择的位置，这里只记索引。
          </div>
        </div>
        <button className="mini-btn" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} 刷新
        </button>
      </div>

      {message && <div className="settings-hint">{message}</div>}
      {!loading && items.length === 0 && (
        <div className="renders-empty">
          <Clapperboard size={20} />
          <div>还没有成片</div>
          <div className="settings-hint">
            在字幕面板的「导出 → 视频成片」生成；仅支持本地视频文件。
          </div>
        </div>
      )}

      <div className="renders-list">
        {items.map((item) => (
          <div className="renders-row" key={item.id}>
            <div className="renders-main">
              <div className="renders-name">{item.title || item.path.split(/[\\/]/).pop()}</div>
              <div className="renders-meta">
                {item.kind === 'video-hard'
                  ? '硬字幕'
                  : item.kind === 'video-soft'
                    ? '软字幕'
                    : '配音视频'}{' '}
                · {formatDateTime(item.createdAt)} · {item.path}
              </div>
            </div>
            <button className="mini-btn" title="打开视频" onClick={() => void window.bsub.openExport(item.path)}>
              <ExternalLink size={12} /> 打开
            </button>
            <button
              className="mini-btn"
              title="打开所在文件夹"
              onClick={() => void window.bsub.revealExport(item.path)}
            >
              <FolderOpen size={12} />
            </button>
            <button className="mini-btn" title="从记录中移除（不删文件）" onClick={() => void remove(item.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
