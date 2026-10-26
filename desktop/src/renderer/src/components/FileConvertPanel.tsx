import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCog, FolderOpen, Loader2, Upload, X } from 'lucide-react';
import type { ConvertTargetResult } from '../../../shared/types';
import {
  CONVERT_FORMATS,
  convertGroupOf,
  type ConvertGroup
} from '../../../shared/convertFormats';

const GROUPS: Array<{ id: ConvertGroup; label: string }> = [
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'image', label: '图片' }
];

const formatName = (file: string) => file.split(/[\\/]/).pop() || file;

/** 文件转换（参考 Filee）：拖入文件，选目标格式，本机 ffmpeg 转换。 */
export function FileConvertPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [group, setGroup] = useState<ConvertGroup>('video');
  const [target, setTarget] = useState('mp4');
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<ConvertTargetResult[]>([]);
  const [error, setError] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offProgress = window.bsub.onConvertProgress((event) => {
      if (event.requestId !== requestId) return;
      setProgress(event.percent);
      setMessage(event.message);
    });
    const offDone = window.bsub.onConvertDone((event) => {
      if (event.requestId !== requestId) return;
      setBusy(false);
      setProgress(100);
      setResults(event.files);
      setMessage(`完成 ${event.files.length} 个文件`);
    });
    const offError = window.bsub.onConvertError((event) => {
      if (event.requestId !== requestId) return;
      setBusy(false);
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, [requestId]);

  useEffect(() => {
    if (!files.length) return;
    const sourceGroup = convertGroupOf(files[0]);
    if (sourceGroup) {
      setGroup(sourceGroup === 'video' ? 'video' : sourceGroup);
      const first = CONVERT_FORMATS.find((item) => item.group === sourceGroup);
      if (first) setTarget(first.id);
    }
  }, [files]);

  const formats = useMemo(() => CONVERT_FORMATS.filter((item) => item.group === group), [group]);

  const addFiles = (paths: string[]) => {
    const next = paths.filter(Boolean);
    if (!next.length) return;
    setFiles((current) => Array.from(new Set([...current, ...next])).slice(0, 30));
    setResults([]);
    setError('');
    setMessage('');
  };

  const pick = async () => {
    const response = await window.bsub.pickConvertFiles();
    if (response.ok) addFiles(response.data);
    else setError(response.error);
  };

  const start = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    setResults([]);
    setProgress(0);
    setMessage('已提交转换…');
    const response = await window.bsub.runConvert(files, target);
    if (!response.ok) {
      setBusy(false);
      setError(response.error);
      return;
    }
    setRequestId(response.data.requestId);
  };

  const cancel = () => {
    if (requestId) window.bsub.cancelConvert(requestId);
  };

  return (
    <div className="convert-panel">
      <div className="convert-head">
        <div>
          <div className="convert-title">
            <FileCog size={16} /> 文件转换
          </div>
          <div className="settings-hint">
            拖入视频 / 音频 / 图片，选择目标格式，本机 ffmpeg 转换，不上传文件。
          </div>
        </div>
      </div>

      <div
        ref={dropRef}
        className={`convert-drop${files.length ? ' has-files' : ''}`}
        onClick={() => void pick()}
        onDragOver={(event) => {
          event.preventDefault();
          dropRef.current?.classList.add('is-over');
        }}
        onDragLeave={() => dropRef.current?.classList.remove('is-over')}
        onDrop={(event) => {
          event.preventDefault();
          dropRef.current?.classList.remove('is-over');
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => window.bsub.filePath(file))
            .filter(Boolean);
          addFiles(paths);
        }}
      >
        <Upload size={22} />
        <div>
          <b>拖入文件，或点击选择</b>
          <span>视频 / 音频 / 图片，最多 30 个</span>
        </div>
      </div>

      {files.length > 0 && (
        <div className="convert-files">
          {files.map((file) => (
            <div className="convert-file" key={file}>
              <span title={file}>{formatName(file)}</span>
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
      )}

      {files.length > 0 && (
        <>
          <div className="convert-groups">
            {GROUPS.map((item) => (
              <button
                key={item.id}
                className={group === item.id ? 'is-active' : ''}
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

          <div className="convert-donut">
            <div className="convert-donut-center">
              <span>{target.toUpperCase()}</span>
              <small>{formats.length} 种</small>
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
                  onClick={() => setTarget(format.id)}
                >
                  {format.label}
                </button>
              );
            })}
          </div>

          <div className="convert-actions">
            <button
              className="mini-btn primary"
              disabled={busy || !target}
              onClick={() => void start()}
            >
              {busy ? <Loader2 size={12} className="spin" /> : <FileCog size={12} />} 开始转换
            </button>
            {busy && (
              <button className="mini-btn" onClick={cancel}>
                取消
              </button>
            )}
          </div>
        </>
      )}

      {(busy || message) && (
        <div className="convert-progress">
          <div className="convert-progress-bar">
            <span style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
          <span>{message}</span>
        </div>
      )}
      {error && <div className="warn-card">{error}</div>}
      {results.length > 0 && (
        <div className="convert-results">
          <div className="convert-results-title">已转换</div>
          {results.map((item) => (
            <div className="convert-result" key={item.output}>
              <span title={item.output}>{formatName(item.output)}</span>
              <button className="mini-btn" onClick={() => window.bsub.revealConverted(item.output)}>
                <FolderOpen size={11} /> 打开位置
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
