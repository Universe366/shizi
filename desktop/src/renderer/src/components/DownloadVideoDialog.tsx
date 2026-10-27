import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Download,
  FolderOpen,
  Loader2,
  Search,
  Square,
  X
} from 'lucide-react';
import type {
  DownloadProbeResult,
  DownloadSettings,
  ExportRecord,
  LibraryVideo,
  OnlineDownloadOptions
} from '../../../shared/types';
import { formatDuration } from '../lib/format';

const DEFAULT_OPTIONS: DownloadSettings = {
  quality: 'best',
  audioOnly: false,
  audioFormat: 'm4a',
  cover: false,
  subtitles: false,
  metadata: false,
  template: 'title-id',
  folderPerList: true,
    dir: ''
};

interface DownloadTask {
  key: string;
  title: string;
  url: string;
  options: OnlineDownloadOptions;
  requestId: string;
  percent: number;
  speed: string;
  eta: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  message: string;
  path: string;
}

let taskSeq = 0;

function toOptions(settings: DownloadSettings, extra: OnlineDownloadOptions = {}): OnlineDownloadOptions {
  return {
    quality: settings.quality,
    audioOnly: settings.audioOnly,
    audioFormat: settings.audioFormat,
    cover: settings.cover,
    subtitles: settings.subtitles,
    metadata: settings.metadata,
    template: settings.template,
    folderPerList: settings.folderPerList,
    ...extra
  };
}

/** 下载视频：解析链接（分P/合集/单视频）或从资料库批量选择，再交给 yt-dlp。 */
export function DownloadVideoDialog({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<'url' | 'library'>('url');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [probe, setProbe] = useState<DownloadProbeResult | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [options, setOptions] = useState<DownloadSettings>(DEFAULT_OPTIONS);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [message, setMessage] = useState('');

  const pendingRef = useRef<Array<{ url: string; title: string; options: OnlineDownloadOptions }>>([]);
  const runningRef = useRef(false);
  const activeKeyRef = useRef('');
  const startNextRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setProbe(null);
    setPicked([]);
    setSource('url');
    setQuery('');
    setSelectedLibrary([]);
    pendingRef.current = [];
    runningRef.current = false;
    activeKeyRef.current = '';
    setLoading(true);
    void window.bsub.listExports?.().then((response) => {
      if (response?.ok) {
        setHistory(response.data.filter((item) => item.kind === 'online-download').slice(0, 8));
      }
    });
    void window.bsub
      .getSettings()
      .then((response) => {
        if (response.ok) {
          setOptions({ ...DEFAULT_OPTIONS, ...(response.data.settings.general.download || {}) });
        }
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.bsub
      .listLibrary()
      .then((response) => {
        if (alive && response.ok) setLibrary(response.data.videos.slice(0, 300));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // 下载事件：进度 / 完成 / 失败
  useEffect(() => {
    const patchTask = (requestId: string, patch: Partial<DownloadTask>) => {
      setTasks((current) => {
        const matched = current.some((task) => task.requestId === requestId);
        return current.map((task) => {
          if (matched ? task.requestId === requestId : task.state === 'running' && !task.requestId) {
            return { ...task, ...patch, requestId: task.requestId || requestId };
          }
          return task;
        });
      });
    };
    const offProgress = window.bsub.onDownloadProgress?.((event) => {
      patchTask(event.requestId, {
        percent: event.percent,
        speed: event.speed,
        eta: event.eta,
        message: event.message,
        state: 'running'
      });
    });
    const offDone = window.bsub.onDownloadDone?.((event) => {
      patchTask(event.requestId, {
        state: 'done',
        percent: 100,
        path: event.path,
        message: '下载完成'
      });
      runningRef.current = false;
      activeKeyRef.current = '';
      void window.bsub.listExports?.().then((response) => {
        if (response?.ok) {
          setHistory(response.data.filter((item) => item.kind === 'online-download').slice(0, 8));
        }
      });
      startNextRef.current();
    });
    const offError = window.bsub.onDownloadError?.((event) => {
      patchTask(event.requestId, {
        state: /取消/.test(event.error) ? 'canceled' : 'failed',
        message: event.error
      });
      runningRef.current = false;
      activeKeyRef.current = '';
      startNextRef.current();
    });
    return () => {
      offProgress?.();
      offDone?.();
      offError?.();
    };
  }, []);

  useEffect(() => {
    startNextRef.current = startNext;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? library.filter((video) => `${video.title} ${video.owner}`.toLowerCase().includes(keyword))
      : library;
  }, [library, query]);

  const parse = async () => {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      setMessage('请填写 http/https 链接');
      return;
    }
    setParsing(true);
    setMessage('解析中…');
    setProbe(null);
    try {
      const response = await window.bsub.probeOnlineVideo?.(value);
      if (!response) {
        setMessage('当前版本不支持解析');
        return;
      }
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      setProbe(response.data);
      setPicked(response.data.entries.map((entry) => entry.index));
      setMessage('');
    } finally {
      setParsing(false);
    }
  };

  const enqueue = (items: Array<{ url: string; title: string; options: OnlineDownloadOptions }>) => {
    if (!items.length) return;
    const created = items.map((item) => ({
      key: `t-${++taskSeq}`,
      title: item.title,
      url: item.url,
      options: item.options,
      requestId: '',
      percent: 0,
      speed: '',
      eta: '',
      state: 'queued' as const,
      message: '',
      path: ''
    }));
    setTasks((current) => [...created, ...current].slice(0, 24));
    pendingRef.current.push(...items);
    setMessage('');
    window.setTimeout(() => startNextRef.current(), 0);
  };

  const startNext = async () => {
    if (runningRef.current) return;
    const next = pendingRef.current.shift();
    if (!next) return;
    runningRef.current = true;
    setTasks((current) => {
      const list = [...current];
      const index = list.findIndex((task) => task.state === 'queued');
      if (index >= 0) list[index] = { ...list[index], state: 'running' };
      return list;
    });
    const response = await window.bsub.downloadOnlineVideo?.({
      url: next.url,
      options: next.options,
      title: next.title
    });
    if (!response?.ok) {
      runningRef.current = false;
      const error = response?.error || '提交失败';
      setMessage(error);
      setTasks((current) => {
        const list = [...current];
        const index = list.findIndex((task) => task.state === 'running' && !task.requestId);
        if (index >= 0) list[index] = { ...list[index], state: 'failed', message: error };
        return list;
      });
      window.setTimeout(() => startNextRef.current(), 0);
      return;
    }
    activeKeyRef.current = response.data.requestId;
    setTasks((current) =>
      current.map((task) =>
        task.state === 'running' && !task.requestId
          ? { ...task, requestId: response.data.requestId }
          : task
      )
    );
  };

  const startUrl = () => {
    if (!probe) {
      void parse();
      return;
    }
    if (probe.kind === 'playlist') {
      if (!picked.length) {
        setMessage('请至少勾选一集');
        return;
      }
      enqueue([
        {
          url: probe.webpageUrl,
          title: `${probe.title}（${picked.length} 项）`,
          options: toOptions(options, { playlistItems: [...picked].sort((a, b) => a - b), listTitle: probe.title })
        }
      ]);
      return;
    }
    enqueue([{ url: probe.webpageUrl, title: probe.title, options: toOptions(options) }]);
  };

  const startLibrary = () => {
    const items = library.filter((video) => selectedLibrary.includes(video.id));
    if (!items.length) {
      setMessage('请先勾选要下载的视频');
      return;
    }
    enqueue(items.map((video) => ({ url: video.url, title: video.title, options: toOptions(options) })));
    setSelectedLibrary([]);
  };

  const retry = (task: DownloadTask) => {
    if (!task.url) return;
    enqueue([{ url: task.url, title: task.title, options: task.options }]);
    setTasks((current) => current.filter((item) => item.key !== task.key));
  };

  const clearFinished = () => {
    setTasks((current) =>
      current.filter((task) => task.state === 'running' || task.state === 'queued')
    );
  };

  const cancelAll = () => {
    pendingRef.current = [];
    const running = tasks.filter((task) => task.state === 'running' && task.requestId);
    for (const task of running) window.bsub.cancelOnlineDownload?.(task.requestId);
    setTasks((current) =>
      current.map((task) =>
        task.state === 'queued'
          ? { ...task, state: 'canceled', message: '已取消' }
          : task
      )
    );
  };

  const togglePicked = (index: number) => {
    setPicked((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  };

  const runningCount = tasks.filter((task) => task.state === 'running' || task.state === 'queued').length;

  if (!open) return null;

  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="dl-card" role="dialog" aria-modal="true" aria-label="下载视频">
        <header className="dl-head">
          <div>
            <div className="confirm-title">下载视频</div>
            <div className="confirm-desc">
              解析 B 站链接后按分P / 合集批量下载；请只下载你有权保存的内容。
            </div>
          </div>
          <button className="start-icon-btn" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="dl-tabs">
          <button className={source === 'url' ? 'is-active' : ''} onClick={() => setSource('url')}>
            在线链接
          </button>
          <button
            className={source === 'library' ? 'is-active' : ''}
            onClick={() => setSource('library')}
          >
            从资料库（{selectedLibrary.length || 0}）
          </button>
        </div>

        <div className="dl-body">
          <section className="dl-main">
            {source === 'url' ? (
              <>
                <div className="dl-input-row">
                  <input
                    className="settings-input"
                    value={url}
                    placeholder="粘贴 B 站链接 / BV 号 / b23 短链 / 番剧 ep、ss"
                    spellCheck={false}
                    autoFocus
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setProbe(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void parse();
                    }}
                  />
                  <button className="mini-btn primary" disabled={parsing} onClick={() => void parse()}>
                    {parsing ? <Loader2 size={12} className="spin" /> : <Search size={12} />} 解析
                  </button>
                </div>

                {probe && (
                  <div className="dl-info">
                    <div className="dl-cover">
                      {probe.thumbnail ? (
                        <img src={probe.thumbnail} alt="" referrerPolicy="no-referrer" />
                      ) : null}
                    </div>
                    <div className="dl-info-main">
                      <div className="dl-info-title" title={probe.title}>
                        {probe.title}
                      </div>
                      <div className="dl-info-meta">
                        {probe.uploader || '未知 UP'} · {formatDuration(probe.duration)}
                        {probe.kind === 'playlist' ? ` · ${probe.entries.length} 个分P/选集` : ''}
                      </div>
                      <div className="dl-info-tags">
                        <span className="dl-tag">{probe.kind === 'playlist' ? '列表' : '单视频'}</span>
                        {probe.id && <span className="dl-tag">{probe.id}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {probe?.kind === 'playlist' && (
                  <div className="dl-parts">
                    <div className="dl-parts-head">
                      <button
                        className="mini-btn"
                        onClick={() =>
                          setPicked(
                            picked.length === probe.entries.length
                              ? []
                              : probe.entries.map((entry) => entry.index)
                          )
                        }
                      >
                        {picked.length === probe.entries.length ? (
                          <CheckSquare size={12} />
                        ) : (
                          <Square size={12} />
                        )}
                        {picked.length === probe.entries.length ? '取消全选' : '全选'}
                      </button>
                      <span className="settings-hint">
                        已选 {picked.length} / {probe.entries.length}
                      </span>
                    </div>
                    <div className="dl-parts-list">
                      {probe.entries.map((entry) => {
                        const active = picked.includes(entry.index);
                        return (
                          <button
                            key={`${entry.index}-${entry.id}`}
                            className={`dl-part${active ? ' is-active' : ''}`}
                            onClick={() => togglePicked(entry.index)}
                          >
                            <span className="dl-part-check">
                              {active ? <CheckSquare size={13} /> : <Square size={13} />}
                            </span>
                            <span className="dl-part-index">{entry.index}</span>
                            <span className="dl-part-title" title={entry.title}>
                              {entry.title}
                            </span>
                            <span className="dl-part-time">{formatDuration(entry.duration)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
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
                <div className="dl-parts-head">
                  <button
                    className="mini-btn"
                    onClick={() =>
                      setSelectedLibrary(
                        selectedLibrary.length === filtered.length
                          ? []
                          : filtered.map((video) => video.id)
                      )
                    }
                  >
                    {selectedLibrary.length === filtered.length && filtered.length > 0 ? (
                      <CheckSquare size={12} />
                    ) : (
                      <Square size={12} />
                    )}
                    {selectedLibrary.length === filtered.length && filtered.length > 0
                      ? '取消全选'
                      : '全选'}
                  </button>
                  <span className="settings-hint">已选 {selectedLibrary.length}</span>
                </div>
                <div className="download-library">
                  {loading && <div className="settings-hint">读取资料库…</div>}
                  {!loading && !filtered.length && (
                    <div className="settings-hint">资料库还没有视频，先去字幕库入库。</div>
                  )}
                  {filtered.slice(0, 100).map((video) => {
                    const active = selectedLibrary.includes(video.id);
                    return (
                      <button
                        key={video.id}
                        className={`download-library-row dl-library-row${active ? ' is-active' : ''}`}
                        onClick={() =>
                          setSelectedLibrary((current) =>
                            current.includes(video.id)
                              ? current.filter((id) => id !== video.id)
                              : [...current, video.id]
                          )
                        }
                      >
                        <span className="dl-part-check">
                          {active ? <CheckSquare size={13} /> : <Square size={13} />}
                        </span>
                        <span className="download-library-main">
                          <span className="download-library-title">{video.title}</span>
                          <span className="download-library-meta">
                            {video.owner || '未知 UP'} · {formatDuration(video.duration)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <aside className="dl-side">
            <div className="dl-side-section">
              <div className="dl-side-title">下载选项</div>
              <div className="dl-grid">
                <label className="dl-field">
                  <span>清晰度</span>
                  <select
                    className="settings-input"
                    value={options.quality}
                    disabled={options.audioOnly}
                    onChange={(event) =>
                      setOptions({ ...options, quality: event.target.value as DownloadSettings['quality'] })
                    }
                  >
                    <option value="best">最佳画质</option>
                    <option value="2160">4K / 2160p</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                    <option value="480">480p</option>
                  </select>
                </label>
                <label className="dl-field">
                  <span>命名</span>
                  <select
                    className="settings-input"
                    value={options.template}
                    onChange={(event) =>
                      setOptions({
                        ...options,
                        template: event.target.value as DownloadSettings['template']
                      })
                    }
                  >
                    <option value="title-id">标题 + ID</option>
                    <option value="title">仅标题</option>
                    <option value="uploader-title">UP + 标题</option>
                  </select>
                </label>
                <label className="dl-field">
                  <span>音频格式</span>
                  <select
                    className="settings-input"
                    value={options.audioFormat}
                    disabled={!options.audioOnly}
                    onChange={(event) =>
                      setOptions({
                        ...options,
                        audioFormat: event.target.value as DownloadSettings['audioFormat']
                      })
                    }
                  >
                    <option value="m4a">M4A</option>
                    <option value="mp3">MP3</option>
                  </select>
                </label>
              </div>
              <div className="dl-checks">
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={options.audioOnly}
                    onChange={(event) => setOptions({ ...options, audioOnly: event.target.checked })}
                  />
                  仅音频
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={options.cover}
                    onChange={(event) => setOptions({ ...options, cover: event.target.checked })}
                  />
                  封面
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={options.subtitles}
                    onChange={(event) => setOptions({ ...options, subtitles: event.target.checked })}
                  />
                  字幕
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={options.metadata}
                    onChange={(event) => setOptions({ ...options, metadata: event.target.checked })}
                  />
                  元数据
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={options.folderPerList}
                    onChange={(event) =>
                      setOptions({ ...options, folderPerList: event.target.checked })
                    }
                  />
                  列表建子文件夹
                </label>
              </div>
            </div>

            <button
              className="mini-btn primary dl-start"
              disabled={source === 'url' ? !probe : !selectedLibrary.length}
              onClick={source === 'url' ? startUrl : startLibrary}
            >
              <Download size={12} />
              {source === 'url'
                ? probe?.kind === 'playlist'
                  ? `下载选中 ${picked.length} 项`
                  : '开始下载'
                : `下载选中 ${selectedLibrary.length} 个`}
            </button>

            {message && <div className="settings-hint">{message}</div>}

            <div className="dl-tasks">
              <div className="dl-tasks-head">
                <span>下载任务</span>
                <span className="settings-hint">{runningCount ? `${runningCount} 个进行中` : '空闲'}</span>
                <span className="dl-tasks-actions">
                  {runningCount > 0 && (
                    <button className="mini-btn" onClick={cancelAll}>
                      全部取消
                    </button>
                  )}
                  {tasks.some((task) => task.state !== 'running' && task.state !== 'queued') && (
                    <button className="mini-btn" onClick={clearFinished}>
                      清空已完成
                    </button>
                  )}
                </span>
              </div>
              {!tasks.length && <div className="settings-hint">还没有任务</div>}
              {tasks.map((task) => (
                <div className={`dl-task is-${task.state}`} key={task.key}>
                  <div className="dl-task-head">
                    <span className="dl-task-title" title={task.title}>
                      {task.title}
                    </span>
                    <span className="dl-task-state">
                      {task.state === 'queued'
                        ? '排队'
                        : task.state === 'running'
                          ? `${Math.round(task.percent)}%`
                          : task.state === 'done'
                            ? '完成'
                            : task.state === 'canceled'
                              ? '已取消'
                              : '失败'}
                    </span>
                  </div>
                  <div className="dl-task-bar">
                    <span style={{ width: `${Math.max(2, Math.round(task.percent))}%` }} />
                  </div>
                  <div className="dl-task-meta">
                    <span>
                      {task.state === 'running'
                        ? [task.speed, task.eta ? `ETA ${task.eta}` : ''].filter(Boolean).join(' · ') ||
                          task.message
                        : task.message}
                    </span>
                    {task.state === 'running' && task.requestId && (
                      <button
                        className="mini-btn"
                        onClick={() => window.bsub.cancelOnlineDownload?.(task.requestId)}
                      >
                        取消
                      </button>
                    )}
                    {task.state === 'failed' && task.url && (
                      <button className="mini-btn" onClick={() => retry(task)}>
                        重试
                      </button>
                    )}
                    {task.state === 'done' && task.path && (
                      <button className="mini-btn" onClick={() => void window.bsub.revealExport(task.path)}>
                        <FolderOpen size={11} /> 位置
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {history.length > 0 && (
              <div className="dl-history">
                <div className="dl-tasks-head">
                  <span>最近下载</span>
                  <span className="settings-hint">{history.length} 条</span>
                </div>
                {history.map((item) => (
                  <div className="dl-history-row" key={item.id}>
                    <span className="dl-history-title" title={item.path}>
                      {item.title || item.path.split(/[\\/]/).pop()}
                    </span>
                    <button
                      className="mini-btn"
                      title="打开文件"
                      onClick={() => void window.bsub.openExport(item.path)}
                    >
                      打开
                    </button>
                    <button
                      className="mini-btn"
                      title="所在文件夹"
                      onClick={() => void window.bsub.revealExport(item.path)}
                    >
                      <FolderOpen size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}