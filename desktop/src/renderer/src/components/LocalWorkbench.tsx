import { useEffect, useRef, useState } from 'react';
import {
  Captions,
  Clapperboard,
  Download,
  FileVideo,
  Languages,
  Library,
  Loader2,
  Mic,
  Scissors,
  Sparkles
} from 'lucide-react';
import type { PageInfo, SubtitleLine, SubtitleTrack } from '../../../shared/types';
import { parseSubtitleText } from '../../../shared/subtitles';
import { formatDuration } from '../lib/format';
import { ExportMenu } from './ExportMenu';
import { ResegmentDialog } from './ResegmentDialog';
import { SynthesizeDialog } from './SynthesizeDialog';
import { DubDialog } from './DubDialog';
import { DownloadVideoDialog } from './DownloadVideoDialog';
import { RendersPanel } from './RendersPanel';

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

type Stage = 'create' | 'transcribe' | 'subtitle' | 'synthesize';

const STAGES: Array<{
  id: Stage;
  label: string;
  desc: string;
  icon: typeof FileVideo;
}> = [
  { id: 'create', label: '任务创建', desc: '选择本地视频或下载在线视频', icon: FileVideo },
  { id: 'transcribe', label: '语音转录', desc: '选择语言，把音轨转成字幕', icon: Mic },
  { id: 'subtitle', label: '字幕处理', desc: '断句、翻译、保存与导出', icon: Captions },
  { id: 'synthesize', label: '视频合成', desc: '烧录字幕、配音与成片记录', icon: Clapperboard }
];

/** 工作台本地处理：设置页同款左侧导航 + 右侧内容，四个工作区可独立进入。 */
export function LocalWorkbench() {
  const [stage, setStage] = useState<Stage>('create');
  const [file, setFile] = useState<{ path: string; name: string; duration: number } | null>(null);
  const [language, setLanguage] = useState('auto');
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [importedName, setImportedName] = useState('');
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
    setImportedName('');
    setTranslated(null);
    setMessage('');
    setProgress(0);
    setStage('transcribe');
  };

  const importSubtitle = async () => {
    const response = await window.bsub.pickSubtitleFile?.();
    if (!response?.ok || !response.data) return;
    const parsed = parseSubtitleText(response.data.text);
    if (!parsed.length) {
      setMessage('没有解析出带时间轴的字幕；请确认是 .srt / .vtt');
      return;
    }
    setLines(parsed);
    setImportedName(response.data.name);
    setTranslated(null);
    setStage('subtitle');
    setMessage(`已导入 ${parsed.length} 行 · ${response.data.name}`);
  };

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setLines([]);
    setImportedName('');
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

  const active = STAGES.find((item) => item.id === stage) || STAGES[0];
  const ActiveIcon = active.icon;

  return (
    <div className="workbench-shell">
      <nav className="settings-nav workbench-nav" aria-label="本地处理步骤">
        {STAGES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`settings-nav-item${stage === item.id ? ' is-active' : ''}`}
              title={item.desc}
              onClick={() => setStage(item.id)}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <div className="workbench-nav-foot">
          {file ? (
            <div className="workbench-file-chip" title={file.path}>
              <FileVideo size={13} />
              <span>{file.name}</span>
            </div>
          ) : (
            <div className="settings-hint">还没有选择文件</div>
          )}
        </div>
      </nav>

      <div className="settings-page-content workbench-content">
        <div className="workbench-content-head">
          <div className="workbench-content-title">
            <ActiveIcon size={15} />
            <span>{active.label}</span>
          </div>
          <span className="settings-hint">{active.desc}</span>
        </div>

        {stage === 'create' && (
          <div className="workbench-stage">
            <div className="workbench-cards">
              <button className="workbench-card" onClick={() => void pick()}>
                <FileVideo size={20} />
                <b>本地视频 / 音频</b>
                <span>mp4 / mkv / mov / mp3 / m4a / wav</span>
              </button>
              <button className="workbench-card" onClick={() => setDownloadOpen(true)}>
                <Download size={20} />
                <b>在线视频下载</b>
                <span>B 站 / YouTube 等 yt-dlp 链接</span>
              </button>
            </div>
            {file && (
              <div className="workbench-file-card">
                <div>
                  <div className="renders-name">{file.name}</div>
                  <div className="renders-meta">
                    {formatDuration(file.duration)} · {file.path}
                  </div>
                </div>
                <button className="mini-btn primary" onClick={() => setStage('transcribe')}>
                  下一步：语音转录
                </button>
              </div>
            )}
          </div>
        )}

        {stage === 'transcribe' && (
          <div className="workbench-stage">
            {!file ? (
              <div className="workbench-empty">
                <div>还没有选择本地视频</div>
                <div className="settings-hint">
                  先在「任务创建」选择文件；也可以直接导入现成字幕。
                </div>
                <div className="settings-inline">
                  <button className="mini-btn primary" onClick={() => void pick()}>
                    选择本地视频
                  </button>
                  <button className="mini-btn" onClick={() => void importSubtitle()}>
                    导入字幕文件
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="workbench-file-card">
                  <div>
                    <div className="renders-name">{file.name}</div>
                    <div className="renders-meta">{formatDuration(file.duration)} · {file.path}</div>
                  </div>
                  <div className="settings-inline">
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
                </div>

                {(busy || message) && (
                  <div className="settings-hint">
                    {message} {busy ? `· ${Math.round(progress)}%` : ''}
                  </div>
                )}

                {lines.length > 0 && (
                  <>
                    <div className="workbench-file-card">
                      <span className="settings-hint">转写完成 · {lines.length} 行</span>
                      <button className="mini-btn primary" onClick={() => setStage('subtitle')}>
                        下一步：字幕处理
                      </button>
                    </div>
                    <div className="workbench-lines">
                      {lines.slice(0, 10).map((line, index) => (
                        <div className="resegment-row" key={`preview-${index}`}>
                          <span className="resegment-time">
                            {Math.floor(line.start / 60)}:
                            {String(Math.floor(line.start % 60)).padStart(2, '0')}
                          </span>
                          <span>{line.text}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {stage === 'subtitle' && (
          <div className="workbench-stage">
            {!lines.length ? (
              <div className="workbench-empty">
                <div>还没有字幕</div>
                <div className="settings-hint">
                  可以先转写，或直接导入 .srt / .vtt。
                </div>
                <div className="settings-inline">
                  <button className="mini-btn primary" onClick={() => setStage('transcribe')}>
                    去语音转录
                  </button>
                  <button className="mini-btn" onClick={() => void importSubtitle()}>
                    导入字幕文件
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="workbench-toolbar">
                  <span className="settings-hint">
                    {importedName ? `${importedName} · ` : ''}
                    {lines.length} 行
                  </span>
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
                  <button className="mini-btn" onClick={() => void save()} disabled={!file}>
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
                  <button className="mini-btn primary" onClick={() => setStage('synthesize')}>
                    下一步：视频合成
                  </button>
                </div>

                {(busy || message) && <div className="settings-hint">{message}</div>}

                <div className="workbench-lines">
                  {lines.slice(0, 200).map((line, index) => (
                    <div className="resegment-row" key={`${line.start}-${index}`}>
                      <span className="resegment-time">
                        {Math.floor(line.start / 60)}:
                        {String(Math.floor(line.start % 60)).padStart(2, '0')}
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
          </div>
        )}

        {stage === 'synthesize' && (
          <div className="workbench-stage">
            {!lines.length ? (
              <div className="workbench-empty">
                <div>还没有字幕，暂时无法合成</div>
                <div className="settings-inline">
                  <button className="mini-btn primary" onClick={() => setStage('subtitle')}>
                    去字幕处理
                  </button>
                  <button className="mini-btn" onClick={() => void importSubtitle()}>
                    导入字幕文件
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="workbench-cards">
                  <button className="workbench-card" onClick={() => setSynthOpen(true)}>
                    <Clapperboard size={20} />
                    <b>字幕视频合成</b>
                    <span>硬字幕 MP4 / 软字幕 MKV</span>
                  </button>
                  <button className="workbench-card" onClick={() => setDubOpen(true)}>
                    <Sparkles size={20} />
                    <b>本地配音</b>
                    <span>配音音轨或替换视频音轨</span>
                  </button>
                </div>
                <div className="workbench-toolbar">
                  <span className="settings-hint">
                    {file?.name || '未选择视频'} · {lines.length} 行
                  </span>
                  <ExportMenu
                    info={info}
                    track={track}
                    lines={lines}
                    translated={translated}
                    onSynthesize={() => setSynthOpen(true)}
                    onDub={() => setDubOpen(true)}
                  />
                </div>
                <RendersPanel />
              </>
            )}
          </div>
        )}
      </div>

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
        videoPath={file?.path || ''}
        title={file?.name || importedName || '字幕视频'}
        lines={lines}
        translated={translated}
        onClose={() => setSynthOpen(false)}
      />
      <DubDialog
        open={dubOpen}
        videoPath={file?.path || ''}
        title={file?.name || importedName || '字幕视频'}
        lines={lines}
        onClose={() => setDubOpen(false)}
      />
      <DownloadVideoDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </div>
  );
}
