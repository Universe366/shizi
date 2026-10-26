import { useEffect, useRef, useState } from 'react';
import { FileVideo, Languages, Library, Loader2, Mic, Scissors, Upload } from 'lucide-react';
import type { PageInfo, SubtitleLine, SubtitleTrack } from '../../../shared/types';
import { formatDuration } from '../lib/format';
import { ExportMenu } from './ExportMenu';
import { ResegmentDialog } from './ResegmentDialog';
import { SynthesizeDialog } from './SynthesizeDialog';
import { DubDialog } from './DubDialog';
import { DownloadVideoDialog } from './DownloadVideoDialog';

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' }
];

/** 工作台 → 本地处理：选文件、转写、断句、翻译、保存/成片，不依赖侧栏。 */
export function LocalWorkbench() {
  const [file, setFile] = useState<{ path: string; name: string; duration: number } | null>(null);
  const [language, setLanguage] = useState('auto');
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [translated, setTranslated] = useState<SubtitleLine[] | null>(null);
  const [target, setTarget] = useState('中文（简体）');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState('');
  const [resegmentOpen, setResegmentOpen] = useState(false);
  const [synthOpen, setSynthOpen] = useState(false);
  const [dubOpen, setDubOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const translateId = useRef('');
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    const offProgress = window.bsub.onLocalTransProgress?.((event) => {
      setProgress(event.percent);
      setMessage(event.message);
    });
    const offDone = window.bsub.onLocalTransDone?.((event) => {
      setBusy(false);
      setProgress(100);
      setLines(event.lines);
      setTranslated(null);
      setMessage(`转写完成 · ${event.lines.length} 行`);
    });
    const offError = window.bsub.onLocalTransError?.((event) => {
      setBusy(false);
      setMessage(event.error);
    });
    return () => {
      offProgress?.();
      offDone?.();
      offError?.();
    };
  }, []);

  useEffect(() => {
    const offProgress = window.bsub.onTranslateProgress?.((event) => {
      if (event.requestId !== translateId.current) return;
      setProgress(event.percent);
      setMessage(event.message);
    });
    const offDone = window.bsub.onTranslateDone?.((event) => {
      if (event.requestId !== translateId.current) return;
      setTranslating(false);
      setTranslated(event.lines);
      setMessage('翻译完成');
    });
    const offError = window.bsub.onTranslateError?.((event) => {
      if (event.requestId !== translateId.current) return;
      setTranslating(false);
      setMessage(event.error);
    });
    return () => {
      offProgress?.();
      offDone?.();
      offError?.();
    };
  }, []);

  const pick = async () => {
    const response = await window.bsub.pickLocalMedia?.();
    if (!response?.ok || ('canceled' in response.data)) return;
    setFile(response.data);
    setLines([]);
    setTranslated(null);
    setMessage('');
    setProgress(0);
  };

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setLines([]);
    setTranslated(null);
    setMessage('准备转录…');
    const response = await window.bsub.transcribeLocalVideo?.(file.path, language);
    if (!response?.ok) {
      setBusy(false);
      setMessage(response?.error || '当前版本不支持');
      return;
    }
    setRequestId(response.data.requestId);
  };

  const stop = () => {
    if (requestId) window.bsub.cancelLocalTranscribe?.(requestId);
  };

  const translate = async () => {
    if (!lines.length || translating) return;
    const id = `lw-${Date.now()}`;
    translateId.current = id;
    setTranslating(true);
    setProgress(0);
    const response = await window.bsub.translate({
      requestId: id,
      lines,
      target,
      options: { useContext: true, reflect: false }
    });
    if (!response.ok) {
      setTranslating(false);
      setMessage(response.error);
    }
  };

  const save = async () => {
    if (!file || !lines.length) return;
    const response = await window.bsub.saveLocalTranscript?.({
      path: file.path,
      name: file.name,
      duration: file.duration,
      lines
    });
    setMessage(response?.ok ? '已存入资料库' : response?.error || '保存失败');
  };

  const info: PageInfo | null = file
    ? {
        kind: 'local',
        bvid: null,
        aid: null,
        cid: null,
        epId: null,
        seasonId: null,
        page: 1,
        partTitle: '',
        parts: [],
        title: file.name,
        owner: '本地文件',
        desc: '',
        duration: file.duration,
        url: `file:///${file.path.replace(/\\/g, '/')}`,
        signature: `local:${file.path}`
      }
    : null;
  const track: SubtitleTrack | null = file
    ? {
        lan: 'local',
        lanDoc: '本地转录',
        url: `local:${file.path}`,
        isAi: false,
        aiStatus: null,
        source: 'local'
      }
    : null;

  return (
    <div className="local-workbench">
      <div className="renders-head">
        <div>
          <div className="renders-title">本地处理</div>
          <div className="settings-hint">
            选一个本地音视频，转写、断句、翻译、保存或直接成片；不依赖右侧字幕面板。
          </div>
        </div>
        <button className="mini-btn primary" onClick={() => void pick()}>
          <FileVideo size={12} /> 选择文件
        </button>
      </div>

      {!file && (
        <div className="renders-empty">
          <Upload size={22} />
          <div>选一个本地视频开始，或先下载在线视频</div>
          <div className="settings-hint">支持 mp4 / mkv / mov / mp3 / m4a / wav 等</div>
          <div className="settings-inline" style={{ justifyContent: 'center' }}>
            <button className="mini-btn primary" onClick={() => void pick()}>
              <FileVideo size={12} /> 选择本地视频
            </button>
            <button className="mini-btn" onClick={() => setDownloadOpen(true)}>
              下载在线视频
            </button>
          </div>
        </div>
      )}

      {file && (
        <>
          <div className="renders-row">
            <div className="renders-main">
              <div className="renders-name">{file.name}</div>
              <div className="renders-meta">
                {formatDuration(file.duration)} · {file.path}
              </div>
            </div>
            <select
              className="mini-select"
              value={language}
              disabled={busy}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button className="mini-btn primary" onClick={() => void start()} disabled={busy}>
              {busy ? <Loader2 size={12} className="spin" /> : <Mic size={12} />} 开始转录
            </button>
            {busy && (
              <button className="mini-btn" onClick={stop}>
                停止
              </button>
            )}
          </div>

          {(busy || message) && (
            <div className="settings-hint">
              {message} {busy ? `· ${Math.round(progress)}%` : ''}
            </div>
          )}

          {lines.length > 0 && (
            <>
              <div className="settings-inline">
                <span className="settings-hint">共 {lines.length} 行</span>
                <button className="mini-btn" onClick={() => setResegmentOpen(true)}>
                  <Scissors size={12} /> 断句
                </button>
                <select
                  className="mini-select"
                  value={target}
                  disabled={translating}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  {['中文（简体）', 'English', '日本語', '한국어'].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <button className="mini-btn" onClick={() => void translate()} disabled={translating}>
                  {translating ? <Loader2 size={12} className="spin" /> : <Languages size={12} />} 翻译
                </button>
                <button className="mini-btn" onClick={() => void save()}>
                  <Library size={12} /> 存入资料库
                </button>
                <ExportMenu
                  info={info}
                  track={track}
                  lines={lines}
                  translated={translated}
                  onSynthesize={() => setSynthOpen(true)}
                  onDub={() => setDubOpen(true)}
                />
              </div>

              <div className="local-lines">
                {lines.slice(0, 200).map((line, index) => (
                  <div className="resegment-row" key={`${line.start}-${index}`}>
                    <span className="resegment-time">
                      {Math.floor(line.start / 60)}:{String(Math.floor(line.start % 60)).padStart(2, '0')}
                    </span>
                    <span>{translated?.[index]?.text || line.text}</span>
                  </div>
                ))}
                {lines.length > 200 && (
                  <div className="settings-hint">只显示前 200 行，导出不受影响。</div>
                )}
              </div>
            </>
          )}

          <ResegmentDialog
            open={resegmentOpen}
            lines={lines}
            onClose={() => setResegmentOpen(false)}
            onApply={(next) => {
              setLines(next);
              setTranslated(null);
            }}
          />
          <SynthesizeDialog
            open={synthOpen}
            videoPath={file.path}
            title={file.name}
            lines={lines}
            translated={translated}
            onClose={() => setSynthOpen(false)}
          />
          <DubDialog
            open={dubOpen}
            videoPath={file.path}
            title={file.name}
            lines={lines}
            onClose={() => setDubOpen(false)}
          />
          <DownloadVideoDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} />
        </>
      )}
    </div>
  );
}
