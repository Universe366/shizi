import { Download, Info, Trash2 } from 'lucide-react';
import type { LibraryVideo } from '../../../shared/types';
import { formatDate } from '../lib/format';
import { metaLine } from '../lib/libraryView';

interface DownloadProgress {
  percent: number;
  speed: string;
  eta: string;
  message: string;
  startedAt: number;
}

interface LibraryVideoRowProps {
  video: LibraryVideo;
  selectMode: boolean;
  selected: boolean;
  cursor?: boolean;
  downloading?: boolean;
  downloadProgress?: DownloadProgress;
  onToggleSelect: (id: number, shift?: boolean) => void;
  onOpen: (video: LibraryVideo) => void;
  onDetail: (video: LibraryVideo) => void;
  onDelete: (video: LibraryVideo) => void;
  onDownload?: (video: LibraryVideo) => void;
}

/** 库列表的一行：封面 / 标题 / 元信息 / 删除按钮，选择模式下换成复选框。 */
export function LibraryVideoRow({
  video,
  selectMode,
  selected,
  onToggleSelect,
  cursor = false,
  downloading = false,
  downloadProgress,
  onOpen,
  onDetail,
  onDelete,
  onDownload
}: LibraryVideoRowProps) {
  const activate = () => {
    if (selectMode) onToggleSelect(video.id, false);
    else onOpen(video);
  };

  return (
    <div
      className={`lib-video${selectMode && selected ? ' is-selected' : ''}${cursor ? ' is-cursor' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(event) => (selectMode ? onToggleSelect(video.id, event.shiftKey) : activate())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') activate();
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          className="bulk-check"
          checked={selected}
          onChange={(event) =>
            onToggleSelect(video.id, (event.nativeEvent as MouseEvent).shiftKey)
          }
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {video.cover ? (
        <img className="lib-cover" src={video.cover} alt="" />
      ) : (
        <div className="lib-cover lib-cover-fallback">{video.title.slice(0, 1) || 'B'}</div>
      )}
      <div className="lib-meta">
        <div className="lib-title-row">
          <span className="lib-title" title={video.title}>
            {video.title}
          </span>
          {video.summaryUpdatedAt != null && <span className="lib-badge">已总结</span>}
        </div>
        <div className="lib-sub">{metaLine(video)}</div>
        <div className="lib-sub faint">
          {video.tags.length > 0
            ? video.tags.slice(0, 3).join(' · ')
            : video.summaryUpdatedAt != null
              ? `总结于 ${formatDate(video.summaryUpdatedAt)}`
              : `入库于 ${formatDate(video.createdAt)}`}
        </div>
        {downloadProgress && (
          <div className="lib-dl">
            <div className="lib-dl-bar">
              <span style={{ width: `${Math.max(2, Math.min(100, downloadProgress.percent))}%` }} />
            </div>
            <div className="lib-dl-meta">
              {Math.round(downloadProgress.percent)}%
              {downloadProgress.speed ? ` · ${downloadProgress.speed}` : ''}
              {downloadProgress.eta ? ` · 剩余 ${downloadProgress.eta}` : ''}
              {` · 已用 ${Math.max(0, Math.round((Date.now() - downloadProgress.startedAt) / 1000))} 秒`}
            </div>
          </div>
        )}
      </div>
      {!selectMode && (
        <>
          <button
            className="lib-delete"
            title="查看字幕 / 总结 / 笔记"
            onClick={(event) => {
              event.stopPropagation();
              onDetail(video);
            }}
          >
            <Info size={13} />
          </button>
          {onDownload && (
            <button
              className="lib-delete lib-download"
              title={downloading ? '正在提交下载…' : '下载这个视频'}
              disabled={downloading}
              onClick={(event) => {
                event.stopPropagation();
                onDownload(video);
              }}
            >
              <Download size={13} />
            </button>
          )}
          <button
            className="lib-delete"
            title="从库中删除"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(video);
            }}
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}
