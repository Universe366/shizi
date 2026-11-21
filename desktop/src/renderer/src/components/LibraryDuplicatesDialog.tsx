import { Loader2 } from 'lucide-react';
import type { LibraryDuplicateGroup } from '../../../shared/types';
import { formatDateTime } from '../lib/format';

interface Props {
  open: boolean;
  loading: boolean;
  busy: boolean;
  groups: LibraryDuplicateGroup[];
  onClose: () => void;
  onRemove: (ids: number[]) => void;
}

/** 库重复检测：按链接/标题分组，默认保留最早入库的一条。 */
export function LibraryDuplicatesDialog({
  open,
  loading,
  busy,
  groups,
  onClose,
  onRemove
}: Props) {
  if (!open) return null;
  const removable = groups.flatMap((group) => group.videos.slice(1).map((video) => video.id));

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card trash-panel"
        role="dialog"
        aria-label="重复检测"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-title">重复检测</div>
        <div className="confirm-desc">
          按 BVID、规范化链接优先匹配，其次按标题匹配；每组默认保留最早入库的一条。
        </div>
        {loading ? (
          <div className="status-line">
            <Loader2 size={13} className="spin" /> 扫描中…
          </div>
        ) : groups.length === 0 ? (
          <div className="panel-empty">没有发现重复条目</div>
        ) : (
          <>
            <div className="trash-list">
              {groups.map((group) => (
                <div className="trash-row" key={group.key}>
                  <div className="trash-main">
                    <div className="trash-title">
                      {group.reason === 'url' ? '相同链接' : '相同标题'} ·{' '}
                      {group.videos.length} 条
                    </div>
                    {group.videos.map((video, index) => (
                      <div className="trash-meta" key={video.id}>
                        {index === 0 ? '保留' : '移除'}：{video.title || '未命名'}
                        {video.owner ? ` · ${video.owner}` : ''} ·{' '}
                        {formatDateTime(video.createdAt)}
                      </div>
                    ))}
                  </div>
                  <div className="trash-actions">
                    <button
                      className="mini-btn"
                      disabled={busy}
                      onClick={() => onRemove(group.videos.slice(1).map((video) => video.id))}
                    >
                      清理本组
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="confirm-actions">
              <button className="mini-btn" onClick={onClose} disabled={busy}>
                关闭
              </button>
              <button
                className="mini-btn danger"
                disabled={busy || removable.length === 0}
                onClick={() => onRemove(removable)}
              >
                全部清理（保留每组最早）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
