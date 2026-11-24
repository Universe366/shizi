import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bookmark,
  Check,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  Pause,
  Pencil,
  Play,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import type {
  Bookmark as BookmarkItem,
  BookmarkFolder,
  DownloadRecord,
  HistoryEntry,
  ReadingItem,
  TabInfo
} from '../../../shared/types';
import { formatDateTime } from '../lib/format';
import { buildBookmarksHtml } from '../lib/bookmarksHtml';
import { askConfirm } from './ui/confirm';
import { parseBookmarksHtml } from './start/bookmarks';

export type HubSection = 'history' | 'bookmarks' | 'reading' | 'downloads' | 'tabs';

const SECTIONS: Array<{ id: HubSection; label: string; icon: typeof Clock }> = [
  { id: 'history', label: '历史', icon: Clock },
  { id: 'bookmarks', label: '书签', icon: Bookmark },
  { id: 'reading', label: '阅读', icon: BookOpen },
  { id: 'downloads', label: '下载', icon: Download },
  { id: 'tabs', label: '标签页', icon: Layers }
];

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dayStart(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(ts: number): string {
  const today = dayStart(Date.now());
  const day = dayStart(ts);
  if (day === today) return '今天';
  if (day === today - 86_400_000) return '昨天';
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 按天分组；同一天的行保持原有顺序。 */
function groupByDay<T>(rows: T[], timeOf: (row: T) => number): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const row of rows) {
    const label = dayLabel(timeOf(row));
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(row);
    else groups.push({ label, items: [row] });
  }
  return groups;
}

export function BrowserHub({
  open,
  initial,
  tabs,
  onClose,
  onOpenUrl,
  onSelectTab,
  onEditBookmark,
  onAskAi
}: {
  open: boolean;
  initial: HubSection;
  tabs: TabInfo[];
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onSelectTab: (id: string) => void;
  onEditBookmark?: (item: BookmarkItem) => void;
  /** 把问题交给对话（带不带当前页面由调用方决定） */
  onAskAi?: (prompt: string, forcePage?: boolean) => void;
}) {
  const [section, setSection] = useState<HubSection>(initial);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState('');
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [closed, setClosed] = useState<Array<{ url: string; title: string }>>([]);
  const [reading, setReading] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSection(initial);
      setQuery('');
      setError('');
      setActiveFolder('');
    }
  }, [open, initial]);

  const loadBookmarks = useCallback(async () => {
    const [bookmarkResponse, folderResponse] = await Promise.all([
      window.bsub.listBookmarks(),
      window.bsub.listBookmarkFolders?.()
    ]);
    if (bookmarkResponse.ok && Array.isArray(bookmarkResponse.data)) {
      setBookmarks(bookmarkResponse.data);
    } else if (!bookmarkResponse.ok) {
      setError(bookmarkResponse.error);
    }
    if (folderResponse?.ok && Array.isArray(folderResponse.data)) setFolders(folderResponse.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const load = async () => {
      try {
        if (section === 'history') {
          const response = await window.bsub.listBrowseHistory(query, 300);
          if (alive && response.ok) setHistory(response.data);
          else if (alive && !response.ok) setError(response.error);
        } else if (section === 'bookmarks') {
          await loadBookmarks();
        } else if (section === 'downloads') {
          const response = await window.bsub.listDownloads();
          if (alive && response.ok) setDownloads(response.data);
          else if (alive && !response.ok) setError(response.error);
        } else if (section === 'reading') {
          const response = await window.bsub.listReadingList?.();
          if (alive && response?.ok) setReading(response.data);
        } else if (section === 'tabs') {
          const response = await window.bsub.listClosedTabs?.();
          if (alive && Array.isArray(response)) setClosed(response);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    const timer = window.setTimeout(load, section === 'history' ? 180 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, section, query, loadBookmarks]);

  useEffect(() => {
    if (!open || section !== 'downloads') return;
    return window.bsub.onDownloadsChanged(() => {
      void window.bsub.listDownloads().then((response) => {
        if (response.ok) setDownloads(response.data);
      });
    });
  }, [open, section]);

  const filteredTabs = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return tabs;
    return tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(text) || tab.url.toLowerCase().includes(text)
    );
  }, [tabs, query]);

  const visibleBookmarks = useMemo(() => {
    const text = query.trim().toLowerCase();
    return bookmarks.filter((item) => {
      if (activeFolder !== '' && item.folder !== activeFolder) return false;
      if (!text) return true;
      return item.title.toLowerCase().includes(text) || item.url.toLowerCase().includes(text);
    });
  }, [bookmarks, activeFolder, query]);

  const visibleDownloads = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return downloads;
    return downloads.filter(
      (item) =>
        (item.filename || '').toLowerCase().includes(text) ||
        (item.url || '').toLowerCase().includes(text)
    );
  }, [downloads, query]);

  const historyGroups = useMemo(
    () => groupByDay(history, (item) => item.visitedAt),
    [history]
  );
  const downloadGroups = useMemo(
    () => groupByDay(visibleDownloads, (item) => item.finishedAt || item.startedAt || 0),
    [visibleDownloads]
  );

  if (!open) return null;

  const refreshDownloads = async () => {
    const response = await window.bsub.listDownloads();
    if (response.ok) setDownloads(response.data);
  };

  const clearHistory = async () => {
    if (!(await askConfirm('清空全部浏览历史？'))) return;
    const response = await window.bsub.clearBrowseHistory();
    if (response.ok) setHistory([]);
  };

  const clearRange = async (scope: 'hour' | 'today' | 'all') => {
    if (scope === 'all') {
      await clearHistory();
      return;
    }
    const since = scope === 'hour' ? Date.now() - 3_600_000 : dayStart(Date.now());
    if (!(await askConfirm(scope === 'hour' ? '清除最近 1 小时的浏览历史？' : '清除今天的浏览历史？')))
      return;
    const response = await window.bsub.clearBrowseHistoryRange?.(since);
    if (response?.ok) {
      const list = await window.bsub.listBrowseHistory(query, 300);
      if (list.ok) setHistory(list.data);
    }
  };

  const removeHistory = async (item: HistoryEntry) => {
    const response = await window.bsub.deleteBrowseHistory?.(item.id);
    if (response?.ok) setHistory((rows) => rows.filter((row) => row.id !== item.id));
  };

  const removeHistorySite = async (item: HistoryEntry) => {
    const host = (() => {
      try {
        return new URL(item.url).hostname.replace(/^www\./, '');
      } catch {
        return item.url;
      }
    })();
    if (!(await askConfirm(`删除「${host}」的全部浏览记录？`))) return;
    const response = await window.bsub.deleteBrowseHistorySite?.(item.url);
    if (response?.ok) {
      const list = await window.bsub.listBrowseHistory(query, 300);
      if (list.ok) setHistory(list.data);
    }
  };

  const removeBookmark = async (url: string) => {
    const response = await window.bsub.removeBookmark(url);
    if (response.ok) setBookmarks((items) => items.filter((item) => item.url !== url));
  };

  const createFolder = async () => {
    const name = window.prompt('新建文件夹');
    if (!name?.trim()) return;
    const response = await window.bsub.createBookmarkFolder?.(name.trim());
    if (response?.ok) {
      setFolders(response.data);
      setActiveFolder(name.trim());
    } else if (response && !response.ok) setError(response.error);
  };

  const renameFolder = async () => {
    if (!activeFolder) return;
    const name = window.prompt('重命名文件夹', activeFolder);
    if (!name?.trim() || name.trim() === activeFolder) return;
    const response = await window.bsub.renameBookmarkFolder?.(activeFolder, name.trim());
    if (response?.ok) {
      setFolders(response.data);
      setActiveFolder(name.trim());
      await loadBookmarks();
    }
  };

  const deleteFolder = async () => {
    if (!activeFolder) return;
    if (!(await askConfirm(`删除文件夹「${activeFolder}」？书签会回到书签栏。`))) return;
    const response = await window.bsub.deleteBookmarkFolder?.(activeFolder);
    if (response?.ok) {
      setFolders(response.data);
      setActiveFolder('');
      await loadBookmarks();
    }
  };

  const importBookmarks = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const parsed = parseBookmarksHtml(await file.text());
    if (!parsed.shortcuts.length) {
      setError('没有找到可导入的书签（只支持 http/https）');
      return;
    }
    let imported = 0;
    for (const item of parsed.shortcuts) {
      const folder = item.folder
        ? `${item.group} / ${item.folder}`
        : item.group === '常用'
          ? ''
          : item.group;
      const response = await window.bsub.saveBookmark?.({
        url: item.url,
        title: item.label,
        folder
      });
      if (response?.ok) imported += 1;
    }
    await loadBookmarks();
    setNotice(`已导入 ${imported} 条书签`);
  };

  const exportBookmarks = async () => {
    const html = buildBookmarksHtml(bookmarks, folders);
    const response = await window.bsub.exportBookmarksHtml?.(html);
    if (!response?.ok) {
      setError(response?.error || '导出失败');
      return;
    }
    setNotice(response.data.canceled ? '已取消导出' : `已导出到 ${response.data.path}`);
  };

  const refreshReading = async () => {
    const response = await window.bsub.listReadingList?.();
    if (response?.ok) setReading(response.data);
  };

  const toggleReadingRead = async (item: ReadingItem) => {
    await window.bsub.markReadingRead?.(item.id, !item.readAt);
    await refreshReading();
  };

  const removeReading = async (item: ReadingItem) => {
    await window.bsub.removeReadingItem?.(item.id);
    setReading((rows) => rows.filter((row) => row.id !== item.id));
  };

  const bulkDownloads = async (action: 'pause' | 'resume') => {
    const response = await window.bsub.bulkDownloads?.(action);
    if (response?.ok) await refreshDownloads();
  };

  const clearDownloads = async () => {
    if (!(await askConfirm({ title: '清空下载记录？', description: '不会删除已经下载的文件。' })))
      return;
    const response = await window.bsub.clearDownloads();
    if (response.ok) setDownloads([]);
  };

  const renderHistoryRow = (item: HistoryEntry) => (
    <div key={item.id} className="hub-row is-static">
      <button
        className="hub-main"
        onClick={() => {
          onOpenUrl(item.url);
          onClose();
        }}
      >
        <span className="hub-title">{item.title || item.url}</span>
        <span className="hub-sub">{item.url}</span>
      </button>
      <span className="hub-time">{formatDateTime(item.visitedAt)}</span>
      <span className="hub-actions">
        <button className="icon-btn" title="删除此站点的历史" onClick={() => void removeHistorySite(item)}>
          <Clock size={13} />
        </button>
        <button className="icon-btn" title="从历史中删除" onClick={() => void removeHistory(item)}>
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-card browser-hub"
        role="dialog"
        aria-label="浏览器面板"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hub-head">
          <div className="hub-tabs">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`mini-btn${section === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSection(item.id);
                    setQuery('');
                  }}
                >
                  <Icon size={12} /> {item.label}
                  {item.id === 'tabs' ? ` ${tabs.length}` : ''}
                </button>
              );
            })}
          </div>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {section !== 'tabs' && (
          <div className="hub-search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              placeholder={
                section === 'history'
                  ? '搜索历史记录…'
                  : section === 'bookmarks'
                    ? '搜索书签…'
                    : '搜索下载记录…'
              }
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {section === 'tabs' && (
          <div className="hub-search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              placeholder="搜索标签页标题或网址…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}

        {section === 'bookmarks' && (
          <div className="hub-chips">
            <button
              className={`mini-btn${activeFolder === '' ? ' is-active' : ''}`}
              onClick={() => setActiveFolder('')}
            >
              全部 {bookmarks.length}
            </button>
            {folders.map((folder) => (
              <button
                key={folder.name}
                className={`mini-btn${activeFolder === folder.name ? ' is-active' : ''}`}
                onClick={() => setActiveFolder(folder.name)}
              >
                {folder.name} {folder.count}
              </button>
            ))}
            <button className="mini-btn" title="新建文件夹" onClick={() => void createFolder()}>
              <FolderPlus size={12} />
            </button>
            {activeFolder && (
              <>
                <button className="mini-btn" title="重命名文件夹" onClick={() => void renameFolder()}>
                  <Pencil size={12} />
                </button>
                <button className="mini-btn" title="删除文件夹" onClick={() => void deleteFolder()}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}

        {error && <div className="status-line">{error}</div>}
        {notice && <div className="status-line">{notice}</div>}
        {loading && (
          <div className="status-line">
            <Loader2 size={13} className="spin" /> 读取中…
          </div>
        )}

        <div className="hub-list">
          {section === 'history' &&
            historyGroups.map((group) => (
              <div key={group.label} className="hub-group">
                <div className="hub-group-title">{group.label}</div>
                {group.items.map(renderHistoryRow)}
              </div>
            ))}
          {section === 'history' && !loading && !history.length && (
            <div className="panel-empty">没有历史记录</div>
          )}

          {section === 'reading' &&
            reading.map((item) => (
              <div key={item.id} className="hub-row is-static">
                <button
                  className="hub-main"
                  onClick={() => {
                    onOpenUrl(item.url);
                    onClose();
                  }}
                >
                  <span className="hub-title">{item.title || item.url}</span>
                  <span className="hub-sub">
                    {item.readAt ? '已读' : '未读'} · {item.url}
                  </span>
                </button>
                <span className="hub-actions">
                  {onAskAi && (
                    <button
                      className="icon-btn"
                      title="AI 摘要"
                      onClick={() => {
                        onClose();
                        onAskAi(`请阅读并总结这个页面，给出 3 个关键点：${item.url}`, false);
                      }}
                    >
                      <Sparkles size={13} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title={item.readAt ? '标为未读' : '标为已读'}
                    onClick={() => void toggleReadingRead(item)}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    title="移出阅读清单"
                    onClick={() => void removeReading(item)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          {section === 'reading' && !loading && !reading.length && (
            <div className="panel-empty">阅读清单为空，地址栏菜单可以「添加到阅读清单」</div>
          )}

          {section === 'bookmarks' &&
            visibleBookmarks.map((item) => (
              <div key={item.id} className="hub-row is-static">
                <button
                  className="hub-main"
                  onClick={() => {
                    onOpenUrl(item.url);
                    onClose();
                  }}
                >
                  <span className="hub-title">{item.title || item.url}</span>
                  <span className="hub-sub">
                    {item.folder || '书签栏'} · {item.url}
                  </span>
                </button>
                {onEditBookmark && (
                  <button className="icon-btn" title="编辑书签" onClick={() => onEditBookmark(item)}>
                    <Pencil size={13} />
                  </button>
                )}
                <button className="icon-btn" title="移除书签" onClick={() => void removeBookmark(item.url)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          {section === 'bookmarks' && !loading && !visibleBookmarks.length && (
            <div className="panel-empty">还没有书签，点地址栏右侧的星标收藏当前页面</div>
          )}

          {section === 'downloads' &&
            downloadGroups.map((group) => (
              <div key={group.label} className="hub-group">
                <div className="hub-group-title">{group.label}</div>
                {group.items.map((item) => {
                  const percent = item.total > 0 ? Math.min(100, (item.received / item.total) * 100) : 0;
                  return (
                    <div key={item.id} className="hub-row is-static hub-download">
                      <span className="hub-main">
                        <span className="hub-title">{item.filename || item.url}</span>
                        <span className="hub-sub">
                          {item.state === 'progressing'
                            ? `${fmtBytes(item.received)} / ${fmtBytes(item.total)}`
                            : item.state === 'completed'
                              ? `已完成 · ${fmtBytes(item.received)}`
                              : item.state === 'paused'
                                ? '已暂停'
                                : item.state === 'cancelled'
                                  ? '已取消'
                                  : '已中断'}
                          {item.finishedAt ? ` · ${formatDateTime(item.finishedAt)}` : ''}
                        </span>
                        {item.state === 'progressing' && (
                          <span className="hub-progress">
                            <span style={{ width: `${percent}%` }} />
                          </span>
                        )}
                      </span>
                      <span className="hub-actions">
                        {(item.state === 'progressing' || item.state === 'paused') && (
                          <>
                            <button
                              className="icon-btn"
                              title={item.state === 'paused' ? '继续下载' : '暂停下载'}
                              onClick={() =>
                                void window.bsub
                                  .controlDownload(item.id, item.state === 'paused' ? 'resume' : 'pause')
                                  .then((response) => {
                                    if (response.ok) void refreshDownloads();
                                  })
                              }
                            >
                              {item.state === 'paused' ? <Play size={13} /> : <Pause size={13} />}
                            </button>
                            <button
                              className="icon-btn"
                              title="取消下载"
                              onClick={() =>
                                void window.bsub.controlDownload(item.id, 'cancel').then((response) => {
                                  if (response.ok) void refreshDownloads();
                                })
                              }
                            >
                              <X size={13} />
                            </button>
                          </>
                        )}
                        {item.state === 'completed' && item.path && (
                          <>
                            <button
                              className="icon-btn"
                              title="打开文件"
                              onClick={() => void window.bsub.openDownload(item.id)}
                            >
                              <ExternalLink size={13} />
                            </button>
                            <button
                              className="icon-btn"
                              title="在文件夹中显示"
                              onClick={() => void window.bsub.revealDownload(item.id)}
                            >
                              <FolderOpen size={13} />
                            </button>
                          </>
                        )}
                        <button
                          className="icon-btn"
                          title="移除记录（不删除文件）"
                          onClick={() =>
                            void window.bsub.deleteDownload(item.id).then((response) => {
                              if (response.ok) {
                                setDownloads((items) => items.filter((row) => row.id !== item.id));
                              }
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          {section === 'downloads' && !loading && !visibleDownloads.length && (
            <div className="panel-empty">还没有下载记录</div>
          )}

          {section === 'tabs' &&
            filteredTabs.map((tab) => (
              <button
                key={tab.id}
                className="hub-row"
                onClick={() => {
                  onSelectTab(tab.id);
                  onClose();
                }}
              >
                <span className="hub-main">
                  <span className="hub-title">
                    {tab.title || '新标签页'}
                    {tab.active ? ' · 当前' : ''}
                  </span>
                  <span className="hub-sub">{tab.url}</span>
                </span>
                {tab.loading && <Loader2 size={13} className="spin" />}
              </button>
            ))}
          {section === 'tabs' && !filteredTabs.length && (
            <div className="panel-empty">没有匹配的标签页</div>
          )}
          {section === 'tabs' && closed.length > 0 && (
            <div className="hub-group">
              <div className="hub-group-title">最近关闭</div>
              {closed.slice(0, 12).map((item, index) => (
                <div key={`${item.url}-${index}`} className="hub-row is-static">
                  <button
                    className="hub-main"
                    onClick={() => {
                      void window.bsub.reopenClosedAt?.(index).then((id) => {
                        if (id) onClose();
                      });
                    }}
                  >
                    <span className="hub-title">{item.title || item.url}</span>
                    <span className="hub-sub">{item.url}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="confirm-actions">
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
          {section === 'history' && (
            <>
              <button className="mini-btn" onClick={() => void clearRange('hour')}>
                清除最近 1 小时
              </button>
              <button className="mini-btn" onClick={() => void clearRange('today')}>
                清除今天
              </button>
              <button
                className="mini-btn danger"
                disabled={!history.length}
                onClick={() => void clearRange('all')}
              >
                清空历史
              </button>
            </>
          )}
          {section === 'bookmarks' && (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".html,.htm"
                hidden
                onChange={(event) => void importBookmarks(event)}
              />
              <button className="mini-btn" onClick={() => importRef.current?.click()}>
                导入 HTML
              </button>
              <button className="mini-btn" onClick={() => void exportBookmarks()}>
                导出 HTML
              </button>
            </>
          )}
          {section === 'downloads' && (
            <>
              <button className="mini-btn" onClick={() => void bulkDownloads('pause')}>
                全部暂停
              </button>
              <button className="mini-btn" onClick={() => void bulkDownloads('resume')}>
                全部继续
              </button>
              <button
                className="mini-btn"
                onClick={() => void window.bsub.revealDownloadsFolder?.()}
              >
                打开文件夹
              </button>
              <button
                className="mini-btn danger"
                disabled={!downloads.length}
                onClick={() => void clearDownloads()}
              >
                清空记录
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
