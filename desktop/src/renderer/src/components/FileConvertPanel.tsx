import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import {
  ArrowRight,
  Clock,
  FileCog,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import type { ConvertTargetResult } from '../../../shared/types';
import {
  CONVERT_FORMATS,
  convertGroupOf,
  type ConvertGroup
} from '../../../shared/convertFormats';

const GROUPS: Array<{ id: ConvertGroup; label: string; hint: string }> = [
  { id: 'video', label: '视频', hint: 'MP4 / MKV / MOV / WebM / GIF…' },
  { id: 'audio', label: '音频', hint: 'MP3 / M4A / WAV / FLAC…' },
  { id: 'image', label: '图片', hint: 'PNG / JPG / WebP / BMP…' }
];

const RECENT_KEY = 'convert-recent';
const formatName = (file: string) => file.split(/[\\/]/).pop() || file;
const extOf = (file: string) => {
  const name = formatName(file);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toUpperCase() : '?';
};

interface RecentItem {
  source: string;
  output: string;
  at: number;
}

function readRecent(): RecentItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter(
            (item): item is RecentItem =>
              Boolean(item) &&
              typeof item.source === 'string' &&
              typeof item.output === 'string' &&
              typeof item.at === 'number'
          )
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

/** 文件转换（参考 Filee）：拖入文件，在光标处展开格式环，松手即转。 */
export function FileConvertPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [group, setGroup] = useState<ConvertGroup>('video');
  const [target, setTarget] = useState('mp4');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<RecentItem[]>(readRecent);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [dragGroup, setDragGroup] = useState<ConvertGroup>('video');
  const dropRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef('');

  useEffect(() => {
    const offProgress = window.bsub.onConvertProgress((event) => {
      if (event.requestId !== requestIdRef.current) return;
      setProgress(event.percent);
      setMessage(event.message);
    });
    const offDone = window.bsub.onConvertDone((event) => {
      if (event.requestId !== requestIdRef.current) return;
      setBusy(false);
      setProgress(100);
      setMessage(`完成 ${event.files.length} 个文件`);
      addRecent(event.files);
    });
    const offError = window.bsub.onConvertError((event) => {
      if (event.requestId !== requestIdRef.current) return;
      setBusy(false);
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    if (!files.length) return;
    const sourceGroup = convertGroupOf(files[0]);
    if (sourceGroup) {
      setGroup(sourceGroup);
      const first = CONVERT_FORMATS.find((item) => item.group === sourceGroup);
      if (first) setTarget(first.id);
    }
  }, [files]);

  const formats = useMemo(() => CONVERT_FORMATS.filter((item) => item.group === group), [group]);
  const dragFormats = useMemo(
    () => CONVERT_FORMATS.filter((item) => item.group === dragGroup),
    [dragGroup]
  );

  const addRecent = (items: ConvertTargetResult[]) => {
    setRecent((current) => {
      const fresh = items.map((item) => ({ source: item.source, output: item.output, at: Date.now() }));
      const seen = new Set<string>();
      const next = [...fresh, ...current]
        .filter((item) => {
          if (seen.has(item.output)) return false;
          seen.add(item.output);
          return true;
        })
        .slice(0, 12);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const addFiles = (paths: string[]) => {
    const next = paths.filter(Boolean);
    if (!next.length) return;
    setFiles((current) => Array.from(new Set([...current, ...next])).slice(0, 30));
    setError('');
    setMessage('');
  };

  const pick = async () => {
    const response = await window.bsub.pickConvertFiles();
    if (response.ok) addFiles(response.data);
    else setError(response.error);
  };

  const run = async (paths: string[], targetId: string) => {
    if (!paths.length || busy) return;
    const nextFiles = Array.from(new Set(paths)).slice(0, 30);
    const sourceGroup = convertGroupOf(nextFiles[0]);
    setFiles(nextFiles);
    setTarget(targetId);
    if (sourceGroup) setGroup(sourceGroup);
    setBusy(true);
    setError('');
    setProgress(0);
    setMessage('已提交转换…');
    const response = await window.bsub.runConvert(nextFiles, targetId);
    if (!response.ok) {
      setBusy(false);
      setError(response.error);
      return;
    }
    requestIdRef.current = response.data.requestId;
  };

  const start = () => void run(files, target);
  const cancel = () => {
    if (requestIdRef.current) window.bsub.cancelConvert(requestIdRef.current);
  };

  const dropPaths = (event: ReactDragEvent) =>
    Array.from(event.dataTransfer.files)
      .map((file) => window.bsub.filePath(file))
      .filter(Boolean);

  const dragGroupOf = (event: ReactDragEvent): ConvertGroup => {
    const type = event.dataTransfer.items?.[0]?.type || '';
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('image/')) return 'image';
    return 'video';
  };

  const clearRecent = () => {
    setRecent([]);
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="convert-panel">
      <header className="convert-hero">
        <div>
          <div className="convert-title">
            <FileCog size={18} /> 文件转换
          </div>
          <p>拖入文件，在光标处选一个目标格式，松手即开始。全部在本机 ffmpeg 完成。</p>
        </div>
        <div className="convert-badges">
          <span>视频</span>
          <span>音频</span>
          <span>图片</span>
          <span>不上传</span>
        </div>
      </header>

      <div className="convert-layout">
        <section className="convert-left">
          <div
            ref={dropRef}
            className={`convert-drop${files.length ? ' has-files' : ''}${dragPoint ? ' is-over' : ''}`}
            onClick={() => void pick()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragGroup(dragGroupOf(event));
              setDragPoint({ x: event.clientX, y: event.clientY });
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Element | null;
              if (
                !dropRef.current?.contains(next as Node) &&
                !next?.closest?.('.convert-drag-donut')
              ) {
                setDragPoint(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragPoint(null);
              addFiles(dropPaths(event));
            }}
          >
            <span className="convert-drop-icon"><Upload size={26} /></span>
            <div>
              <b>{files.length ? '继续拖入，或点击添加' : '把文件拖到这里'}</b>
              <span>视频 / 音频 / 图片，最多 30 个；也可直接拖到右侧格式环上立即转换</span>
            </div>
          </div>

          {files.length > 0 ? (
            <div className="convert-queue">
              <div className="convert-queue-head">
                <span>{files.length} 个文件</span>
                <button onClick={() => setFiles([])}>清空</button>
              </div>
              {files.map((file) => (
                <div className="convert-file" key={file}>
                  <span className="convert-file-ext">{extOf(file)}</span>
                  <span className="convert-file-name" title={file}>{formatName(file)}</span>
                  <button
                    title="移除"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFiles((current) => current.filter((item) => item !== file));
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="convert-tips">
              <div><b>1</b> 拖入或选择文件</div>
              <div><b>2</b> 在格式环上松手</div>
              <div><b>3</b> 结果保存在原文件旁边</div>
            </div>
          )}

          {(busy || message) && (
            <div className="convert-progress">
              <div className="convert-progress-bar">
                <span style={{ width: `${Math.max(2, progress)}%` }} />
              </div>
              <span>{message}</span>
              {busy && <button className="mini-btn" onClick={cancel}>取消</button>}
            </div>
          )}
          {error && <div className="warn-card">{error}</div>}
        </section>

        <section className="convert-right">
          <div className="convert-groups">
            {GROUPS.map((item) => (
              <button
                key={item.id}
                className={group === item.id ? 'is-active' : ''}
                title={item.hint}
                onClick={() => {
                  setGroup(item.id);
                  const first = CONVERT_FORMATS.find((format) => format.group === item.id);
                  if (first) setTarget(first.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className={`convert-donut${files.length ? '' : ' is-empty'}`}>
            <div className="convert-donut-center">
              <span>{files.length ? target.toUpperCase() : '拖入'}</span>
              <small>{files.length ? `${formats.length} 种` : '文件'}</small>
            </div>
            {formats.map((format, index) => {
              const angle = (360 / formats.length) * index - 90;
              return (
                <button
                  key={format.id}
                  className={`convert-format${target === format.id ? ' is-active' : ''}`}
                  style={{
                    transform: `rotate(${angle}deg) translate(112px) rotate(${-angle}deg)`
                  }}
                  onClick={() => {
                    setTarget(format.id);
                    if (files.length) void run(files, format.id);
                  }}
                >
                  {format.label}
                </button>
              );
            })}
          </div>

          <div className="convert-actions">
            <button
              className="mini-btn primary"
              disabled={busy || !target || !files.length}
              onClick={start}
            >
              {busy ? <Loader2 size={12} className="spin" /> : <FileCog size={12} />}
              {busy ? '转换中…' : `转换为 ${target.toUpperCase()}`}
            </button>
          </div>
          <div className="settings-hint convert-hint">
            {GROUPS.find((item) => item.id === group)?.hint}
          </div>
        </section>
      </div>

      {dragPoint && (
        <div
          className="convert-drag-donut"
          style={{ left: dragPoint.x, top: dragPoint.y }}
        >
          <div className="convert-drag-center">{GROUPS.find((item) => item.id === dragGroup)?.label}</div>
          {dragFormats.map((format, index) => {
            const angle = (360 / dragFormats.length) * index - 90;
            return (
              <button
                key={format.id}
                data-convert-format={format.id}
                style={{
                  transform: `rotate(${angle}deg) translate(86px) rotate(${-angle}deg)`
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragPoint(null);
                  void run(dropPaths(event), format.id);
                }}
              >
                {format.label}
              </button>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <section className="convert-recent">
          <div className="convert-recent-head">
            <span><Clock size={13} /> 最近转换</span>
            <button onClick={clearRecent}>清空记录</button>
          </div>
          <div className="convert-recent-grid">
            {recent.map((item) => (
              <div className="convert-recent-card" key={item.output}>
                <div className="convert-recent-name" title={item.output}>{formatName(item.output)}</div>
                <div className="convert-recent-meta">
                  {formatName(item.source)} <ArrowRight size={10} /> {extOf(item.output)}
                </div>
                <button className="mini-btn" onClick={() => window.bsub.revealConverted(item.output)}>
                  <FolderOpen size={11} /> 打开位置
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length === 0 && files.length === 0 && (
        <div className="convert-recent-empty">
          <Trash2 size={13} /> 转换后的文件会出现在这里
        </div>
      )}
    </div>
  );
}
