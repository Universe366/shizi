import { useEffect, useState } from 'react';
import { Star, Trash2, X } from 'lucide-react';
import type { Bookmark, BookmarkFolder } from '../../../shared/types';

/**
 * 收藏弹窗：对齐 Chrome / Edge 的星标行为——
 * 收藏时可以改名称、选文件夹；已收藏时打开就是编辑，可顺手删除。
 */
export function BookmarkDialog({
  url,
  initialTitle,
  onClose,
  onChanged
}: {
  url: string;
  initialTitle?: string;
  onClose: () => void;
  onChanged: (bookmarked: boolean) => void;
}) {
  const [title, setTitle] = useState(initialTitle || url);
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [existing, setExisting] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void Promise.all([window.bsub?.listBookmarkFolders?.(), window.bsub?.listBookmarks?.()]).then(
      ([folderResponse, bookmarkResponse]) => {
        if (!alive) return;
        if (folderResponse?.ok) setFolders(folderResponse.data);
        if (bookmarkResponse?.ok) {
          const found = bookmarkResponse.data.find((item) => item.url === url) || null;
          setExisting(found);
          if (found) {
            setTitle(found.title || url);
            setFolder(found.folder || '');
          }
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await window.bsub?.saveBookmark?.({
        url,
        title: title.trim() || url,
        folder: folder.trim()
      });
      if (!response?.ok) {
        setError(response?.error || '保存失败');
        return;
      }
      onChanged(true);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await window.bsub?.removeBookmark?.(url);
      onChanged(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card bookmark-dialog"
        role="dialog"
        aria-label={existing ? '编辑书签' : '添加书签'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="hub-title-row">
            <Star size={14} fill={existing ? 'currentColor' : 'none'} />
            <strong>{existing ? '编辑书签' : '添加书签'}</strong>
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="settings-label">名称</div>
        <input
          className="settings-input"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) void save();
          }}
        />

        <div className="settings-label">文件夹</div>
        <input
          className="settings-input"
          list="bookmark-folder-options"
          value={folder}
          placeholder="留空 = 书签栏；也可以输入新文件夹"
          onChange={(event) => setFolder(event.target.value)}
        />
        <datalist id="bookmark-folder-options">
          {folders.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}（{item.count}）
            </option>
          ))}
        </datalist>

        <div className="settings-hint bookmark-dialog-url">{url}</div>
        {error && <div className="settings-hint">{error}</div>}

        <div className="confirm-actions">
          {existing && (
            <button className="mini-btn danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={13} /> 删除书签
            </button>
          )}
          <button className="mini-btn" onClick={onClose}>
            取消
          </button>
          <button className="mini-btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
