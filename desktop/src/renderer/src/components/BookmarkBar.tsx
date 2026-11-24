import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, MoreHorizontal } from 'lucide-react';
import type { Bookmark as BookmarkItem, BookmarkFolder } from '../../../shared/types';

/**
 * 地址栏下方的书签栏：书签栏（folder = ''）+ 文件夹下拉。
 * 空的时候保留一条提示，不把整栏高度收掉，避免页面随书签增减跳动。
 */
export function BookmarkBar({
  onOpen,
  onManage
}: {
  onOpen: (url: string) => void;
  onManage: () => void;
}) {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [openFolder, setOpenFolder] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [bookmarkResponse, folderResponse] = await Promise.all([
      window.bsub.listBookmarks(),
      window.bsub.listBookmarkFolders?.()
    ]);
    if (bookmarkResponse?.ok && Array.isArray(bookmarkResponse.data)) {
      setItems(bookmarkResponse.data);
    }
    if (folderResponse?.ok && Array.isArray(folderResponse.data)) {
      setFolders(folderResponse.data);
    }
  }, []);

  useEffect(() => {
    void load();
    const off = window.bsub.onBookmarksChanged?.(() => void load());
    const onFocus = () => void load();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenFolder('');
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('mousedown', onDown);
    return () => {
      off?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('mousedown', onDown);
    };
  }, [load]);

  const bar = items.filter((item) => !item.folder);

  return (
    <div className="bookmark-bar" ref={rootRef}>
      <div className="bookmark-bar-scroll">
        {!bar.length && !folders.length && (
          <span className="bookmark-bar-empty">书签栏为空，点地址栏星标收藏当前页面</span>
        )}
        {bar.map((item) => (
          <button
            key={item.id}
            className="bookmark-bar-item"
            title={item.url}
            onClick={() => onOpen(item.url)}
          >
            {item.favicon ? (
              <img className="bookmark-bar-icon" src={item.favicon} alt="" />
            ) : null}
            <span className="bookmark-bar-title">{item.title || item.url}</span>
          </button>
        ))}
        {folders.map((folder) => {
          const inside = items.filter((item) => item.folder === folder.name);
          return (
            <div className="bookmark-bar-folder" key={folder.name}>
              <button
                className={`bookmark-bar-item${openFolder === folder.name ? ' is-active' : ''}`}
                title={`${folder.name}（${inside.length}）`}
                onClick={() =>
                  setOpenFolder((current) => (current === folder.name ? '' : folder.name))
                }
              >
                <Folder size={12} />
                <span className="bookmark-bar-title">{folder.name}</span>
              </button>
              {openFolder === folder.name && (
                <div className="bookmark-bar-menu" role="menu">
                  {inside.length === 0 && <div className="bookmark-bar-menu-empty">空文件夹</div>}
                  {inside.map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      title={item.url}
                      onClick={() => {
                        setOpenFolder('');
                        onOpen(item.url);
                      }}
                    >
                      {item.title || item.url}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="bookmark-bar-manage" title="管理书签" onClick={onManage}>
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
