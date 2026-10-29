import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import {
  Captions,
  Clapperboard,
  Download,
  FileText,
  FileVideo,
  Film,
  Languages,
  Library,
  ListVideo,
  Loader2,
  Merge,
  Mic,
  Palette,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Split,
  Trash2,
  Wand2,
  X
} from 'lucide-react';
import type {
  LibraryVideo,
  OptimizeSuggestion,
  PageInfo,
  SubtitleLine,
  SubtitleStyle,
  SubtitleTrack
} from '../../../shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '../../../shared/ass';
import { parseSubtitleText } from '../../../shared/subtitles';
import { formatDuration } from '../lib/format';
import { ExportMenu } from './ExportMenu';
import { ResegmentDialog } from './ResegmentDialog';
import { SynthesizeDialog } from './SynthesizeDialog';
import { DubDialog } from './DubDialog';
import { DownloadVideoDialog } from './DownloadVideoDialog';
import { RendersPanel } from './RendersPanel';
import { SubtitleOptimizePanel } from './SubtitleOptimizePanel';

const LANGUAGES = [
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

const TARGETS = ['中文（简体）', 'English', '日本語', '한국어'];
type StudioTab = 'task' | 'subtitle' | 'style' | 'synthesis' | 'batch' | 'records';

interface LocalBatchItem {
  id: string;
  path: string;
  name: string;
  status: 'waiting' | 'running' | 'done' | 'failed';
  percent: number;
  lines: SubtitleLine[];
  error?: string;
}

const TABS: Array<{ id: StudioTab; label: string; icon: typeof FileVideo }> = [
  { id: 'task', label: '任务', icon: FileVideo },
  { id: 'subtitle', label: '字幕', icon: Captions },
  { id: 'style', label: '样式', icon: Palette },
  { id: 'synthesis', label: '合成', icon: Film },
  { id: 'batch', label: '批量', icon: ListVideo },
  { id: 'records', label: '记录', icon: Clapperboard }
];

/** 成片与处理：任务 / 字幕 / 样式 / 合成 / 记录，参考 VideoCaptioner 的工作流。 */
export function StudioWorkbench() {
  const [tab, setTab] = useState<StudioTab>('task');
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
  const [taskUrl, setTaskUrl] = useState('');
  const [translating, setTranslating] = useState(false);
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [presets, setPresets] = useState<Array<{ name: string; style: SubtitleStyle }>>([]);
  const [presetName, setPresetName] = useState('');
  const [synthStyle, setSynthStyle] = useState<SubtitleStyle | null>(null);
  const [render, setRender] = useState<{ requestId: string; percent: number; message: string } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [suggestions, setSuggestions] = useState<OptimizeSuggestion[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [optimizeMessage, setOptimizeMessage] = useState('');
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [localBatch, setLocalBatch] = useState<LocalBatchItem[]>([]);
  const [localBatchRunning, setLocalBatchRunning] = useState(false);
  const batchActive = useRef('');
  const batchResolve = useRef<(() => void) | null>(null);
  const translateId = useRef('');
  const optimizeId = useRef('');

  useEffect(() => {
    const offProgress = window.bsub.onLocalTransProgress?.((event) => {
      setProgress(event.percent);
      setMessage(event.message);
      if (batchActive.current) {
        setLocalBatch((current) =>
          current.map((item) =>
            item.id === batchActive.current ? { ...item, percent: event.percent } : item
          )
        );
      }
    });
    const offDone = window.bsub.onLocalTransDone?.((event) => {
      if (batchActive.current) {
        const active = batchActive.current;
        setLocalBatch((current) =>
          current.map((item) =>
            item.id === active
              ? { ...item, status: 'done', percent: 100, lines: event.lines }
              : item
          )
        );
        batchActive.current = '';
        const resolve = batchResolve.current;
        batchResolve.current = null;
        resolve?.();
        return;
      }
      setBusy(false);
      setProgress(100);
      setFile((current) =>
        current
          ? {
              ...current,
              path: event.path || current.path,
              name: event.name || current.name,
              duration: event.duration || current.duration
            }
          : current
      );
      setLines(event.lines);
      setTranslated(null);
      setMessage(`转写完成 · ${event.lines.length} 行`);
      setTab('subtitle');
    });
    const offError = window.bsub.onLocalTransError?.((event) => {
      if (batchActive.current) {
        const active = batchActive.current;
        setLocalBatch((current) =>
          current.map((item) =>
            item.id === active ? { ...item, status: 'failed', error: event.error } : item
          )
        );
        batchActive.current = '';
        const resolve = batchResolve.current;
        batchResolve.current = null;
        resolve?.();
        return;
      }
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
    void (async () => {
      const response = await window.bsub.getSettings?.();
      if (!response?.ok) return;
      const general = response.data.settings.general;
      setStyle({ ...DEFAULT_SUBTITLE_STYLE, ...(general.subtitleStyle || {}) });
      setPresets(general.subtitlePresets || []);
    })();
  }, []);

  useEffect(() => {
    const offProgress = window.bsub.onSynthesizeProgress?.((event) => setRender(event));
    const offDone = window.bsub.onSynthesizeDone?.(() => {
      setRender((current) => (current ? { ...current, percent: 100, message: '合成完成' } : current));
      window.setTimeout(() => setRender(null), 2600);
    });
    const offError = window.bsub.onSynthesizeError?.(() => setRender(null));
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

  useEffect(() => {
    const offProgress = window.bsub.onOptimizeProgress?.((event) => {
      if (event.requestId !== optimizeId.current) return;
      setMessage(event.message);
    });
    const offDone = window.bsub.onOptimizeDone?.((event) => {
      if (event.requestId !== optimizeId.current) return;
      setOptimizing(false);
      setSuggestions(event.suggestions || []);
      setSelectedSuggestions(new Set((event.suggestions || []).map((item) => item.index)));
      setOptimizeMessage(
        event.suggestions?.length ? `发现 ${event.suggestions.length} 处改动` : '未发现需要修改的地方'
      );
    });
    const offError = window.bsub.onOptimizeError?.((event) => {
      if (event.requestId !== optimizeId.current) return;
      setOptimizing(false);
      setOptimizeMessage(event.error);
    });
    return () => {
      offProgress?.();
      offDone?.();
      offError?.();
    };
  }, []);

  useEffect(() => {
    if (tab !== 'batch' || library.length) return;
    void (async () => {
      const response = await window.bsub.listLibrary();
      if (response.ok) setLibrary(response.data.videos || []);
    })();
  }, [tab, library.length]);

  const startBatch = async () => {
    const ids = [...batchSelected];
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const response = await window.bsub.batchSynthesize?.({ ids, style });
      if (!response) {
        setMessage('当前版本不支持批量成片');
        return;
      }
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      if ('canceled' in response.data) return;
      setMessage(`已提交 ${ids.length} 个成片任务，进度见任务中心`);
      setBatchSelected(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  const addLocalBatch = async () => {
    const response = await window.bsub.pickLocalMedia?.();
    if (!response?.ok) return;
    const picked = response.data;
    if ('canceled' in picked) return;
    setLocalBatch((current) => [
      ...current,
      {
        id: `local-${Date.now()}-${current.length}`,
        path: picked.path,
        name: picked.name,
        status: 'waiting',
        percent: 0,
        lines: []
      }
    ]);
    setTab('batch');
  };

  const addBatchFiles = (files: File[]) => {
    const items = files
      .map((file): LocalBatchItem | null => {
        const path = window.bsub.filePath?.(file) || '';
        return path
          ? {
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              path,
              name: file.name,
              status: 'waiting',
              percent: 0,
              lines: []
            }
          : null;
      })
      .filter((item): item is LocalBatchItem => Boolean(item));
    if (items.length) {
      setLocalBatch((current) => [...current, ...items]);
      setTab('batch');
    }
  };

  const runLocalBatch = async () => {
    if (localBatchRunning) return;
    const pending = localBatch.filter(
      (item) => item.status === 'waiting' || item.status === 'failed'
    );
    if (!pending.length) {
      setMessage('没有待转录的本地文件');
      return;
    }
    setLocalBatchRunning(true);
    for (const item of pending) {
      batchActive.current = item.id;
      setLocalBatch((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, status: 'running', percent: 0, error: undefined } : row
        )
      );
      const response = await window.bsub.transcribeLocalVideo?.(item.path, language);
      if (!response?.ok) {
        setLocalBatch((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, status: 'failed', error: response?.error } : row
          )
        );
        batchActive.current = '';
        continue;
      }
      await new Promise<void>((resolve) => {
        batchResolve.current = resolve;
      });
    }
    setLocalBatchRunning(false);
    setMessage('本地批量转录完成，可在资料库继续批量成片');
  };

  const handleTaskDrop = async (event: ReactDragEvent) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) return;
    if (/\.(srt|vtt)$/i.test(dropped.name)) {
      const parsed = parseSubtitleText(await dropped.text());
      if (parsed.length) {
        setLines(parsed);
        setImportedName(dropped.name);
        setTranslated(null);
        setTab('subtitle');
        setMessage(`已导入 ${parsed.length} 行 · ${dropped.name}`);
      }
      return;
    }
    const path = window.bsub.filePath?.(dropped) || '';
    if (!path) {
      setMessage('无法读取拖入文件的路径，请使用“选择文件”');
      return;
    }
    setFile({ path, name: dropped.name, duration: 0 });
    setLines([]);
    setTranslated(null);
    setImportedName('');
    setMessage('已选择拖入的文件');
  };

  const pick = async () => {
    const response = await window.bsub.pickLocalMedia?.();
    if (!response?.ok || ('canceled' in response.data)) return;
    setFile(response.data);
    setLines([]);
    setImportedName('');
    setTranslated(null);
    setMessage('');
    setProgress(0);
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
    setMessage(`已导入 ${parsed.length} 行 · ${response.data.name}`);
    setTab('subtitle');
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
    const id = `studio-${Date.now()}`;
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

  const optimize = async () => {
    if (!lines.length || optimizing) return;
    const id = `studio-opt-${Date.now()}`;
    optimizeId.current = id;
    setOptimizing(true);
    setSuggestions(null);
    setOptimizeMessage('正在让 AI 校对…');
    const response = await window.bsub.optimize({ requestId: id, lines });
    if (!response.ok) {
      setOptimizing(false);
      setOptimizeMessage(response.error);
    }
  };

  const applySuggestions = (all = false) => {
    if (!suggestions) return;
    const chosen = all ? suggestions : suggestions.filter((item) => selectedSuggestions.has(item.index));
    if (!chosen.length) return;
    const byIndex = new Map(chosen.map((item) => [item.index, item.suggestion]));
    setLines((current) =>
      current.map((line, index) =>
        byIndex.has(index) ? { ...line, text: byIndex.get(index) || line.text } : line
      )
    );
    setSuggestions(null);
    setSelectedSuggestions(new Set());
    setTranslated(null);
    setOptimizeMessage(`已应用 ${chosen.length} 处修改`);
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

  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
    setTranslated(null);
  };

  const mergeNext = (index: number) => {
    setLines((current) => {
      if (index < 0 || index >= current.length - 1) return current;
      const first = current[index];
      const second = current[index + 1];
      const merged = {
        ...first,
        end: second.end,
        text: `${first.text}${first.text.endsWith(' ') || !first.text ? '' : ' '}${second.text}`
      };
      return [...current.slice(0, index), merged, ...current.slice(index + 2)];
    });
    setTranslated(null);
  };

  const splitLine = (index: number) => {
    setLines((current) => {
      const line = current[index];
      if (!line || line.text.trim().length < 2) return current;
      const cut = Math.max(1, Math.floor(line.text.length / 2));
      const middle = (line.start + line.end) / 2;
      return [
        ...current.slice(0, index),
        { ...line, end: middle, text: line.text.slice(0, cut).trim() },
        { ...line, start: middle, text: line.text.slice(cut).trim() },
        ...current.slice(index + 1)
      ];
    });
    setTranslated(null);
  };

  const updateLine = (index: number, text: string) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, text } : line)));
  };

  const updateTranslation = (index: number, text: string) => {
    setTranslated((current) => {
      const base = current ? [...current] : lines.map((line) => ({ ...line, text: '' }));
      while (base.length < lines.length) base.push({ ...lines[base.length], text: '' });
      base[index] = { ...base[index], text };
      return base;
    });
  };

  const persistStyle = async (asPreset: boolean) => {
    const response = await window.bsub.getSettings?.();
    if (!response?.ok) return;
    const settings = response.data.settings;
    settings.general.subtitleStyle = style;
    if (asPreset && presetName.trim()) {
      const next = [
        ...(settings.general.subtitlePresets || []).filter(
          (preset) => preset.name !== presetName.trim()
        ),
        { name: presetName.trim(), style }
      ].slice(-12);
      settings.general.subtitlePresets = next;
      setPresets(next);
      setPresetName('');
    }
    await window.bsub.saveSettings(settings);
    setMessage(asPreset ? '已保存样式预设' : '已保存为默认样式');
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

  const status = busy
    ? `转录 ${Math.round(progress)}%`
    : optimizing
      ? 'AI 校对中'
      : translating
        ? `翻译 ${Math.round(progress)}%`
        : lines.length
          ? `${lines.length} 行字幕`
          : '等待素材';

  return (
    <div className="studio-shell">
      <aside className="studio-nav" aria-label="成片与处理导航">
        <div className="studio-brand">
          <Clapperboard size={15} />
          成片与处理
        </div>
        {TABS.map((item) => {
          const Icon = item.icon;
          const badge =
            item.id === 'subtitle' && lines.length
              ? String(lines.length)
              : item.id === 'task' && file
                ? '✓'
                : '';
          return (
            <button
              key={item.id}
              className={`studio-nav-item${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={15} />
              {item.label}
              {badge && <span className="studio-nav-badge">{badge}</span>}
            </button>
          );
        })}
        <div className="studio-nav-foot">
          <span className="studio-nav-status">{status}</span>
          {file && <span className="studio-nav-file">{file.name}</span>}
        </div>
      </aside>

      <section className="studio-canvas">
        <header className="studio-head">
          <div>
            <h2>{TABS.find((item) => item.id === tab)?.label}</h2>
            <p>
              {tab === 'task' && '选择本地视频或下载链接，设置语言后开始转录。'}
              {tab === 'subtitle' && '逐行校对、AI 优化、断句、翻译，再进入合成。'}
              {tab === 'style' && '字体、字号、颜色、描边与位置，右侧实时预览。'}
              {tab === 'synthesis' && '硬字幕 / 软字幕 / 配音 / 导出，成片记录在下方。'}
              {tab === 'batch' && '勾选资料库视频，用当前样式批量出片。'}
              {tab === 'records' && '所有已生成的成片。'}
            </p>
          </div>
          {file && <span className="studio-file-chip">{formatDuration(file.duration)} · {file.name}</span>}
        </header>

        {message && <div className="studio-message">{message}</div>}

        {tab === 'task' && (
          <div className="studio-task">
            <div
              className="studio-card studio-drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleTaskDrop(event)}
            >
              <div className="studio-drop-icon"><FileVideo size={26} /></div>
              <div>
                <b>{file ? file.name : '选择本地视频 / 音频'}</b>
                <span>{file ? file.path : 'mp4 / mkv / mov / mp3 / m4a / wav'}</span>
              </div>
              <div className="studio-inline">
                <button className="mini-btn primary" onClick={() => void pick()}>
                  {file ? '重新选择' : '选择文件'}
                </button>
                <button className="mini-btn" onClick={() => setDownloadOpen(true)}>
                  <Download size={12} /> 在线下载
                </button>
              </div>
            </div>

            <div className="studio-url-row">
              <input
                value={taskUrl}
                placeholder="粘贴 B 站 / YouTube 链接，或直接选择下方本地文件"
                onChange={(event) => setTaskUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && taskUrl.trim()) setDownloadOpen(true);
                }}
              />
              <button
                className="mini-btn"
                onClick={() => setDownloadOpen(true)}
                disabled={!taskUrl.trim()}
              >
                <Download size={12} /> 下载
              </button>
            </div>

            <div className="studio-grid-2">
              <label className="studio-field">
                <span>识别语言</span>
                <select value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value)}>
                  {LANGUAGES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="studio-field">
                <span>翻译目标</span>
                <select value={target} onChange={(event) => setTarget(event.target.value)}>
                  {TARGETS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="studio-card studio-run">
              <div>
                <b>生成字幕</b>
                <span>本地 whisper，音频不会上传。</span>
              </div>
              <div className="studio-inline">
                <button className="mini-btn primary" onClick={() => void start()} disabled={!file || busy}>
                  {busy ? <Loader2 size={12} className="spin" /> : <Mic size={12} />} 开始转录
                </button>
                <button className="mini-btn" onClick={() => void importSubtitle()}>
                  <FileText size={12} /> 导入字幕
                </button>
                {busy && <button className="mini-btn" onClick={stop}>停止</button>}
              </div>
            </div>

            {(busy || progress > 0) && (
              <div className="studio-progress">
                <div className="workbench-progress-head">
                  <span>{message || '转录中…'}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="workbench-progress-bar">
                  <span style={{ width: `${Math.max(2, Math.round(progress))}%` }} />
                </div>
              </div>
            )}

            {lines.length > 0 && (
              <div className="studio-card studio-next">
                <span>已生成 {lines.length} 行字幕</span>
                <button className="mini-btn primary" onClick={() => setTab('subtitle')}>进入字幕编辑</button>
              </div>
            )}
          </div>
        )}

        {tab === 'subtitle' && (
          <div className="studio-subtitle">
            {!lines.length ? (
              <div className="studio-empty">
                <Captions size={24} />
                <b>还没有字幕</b>
                <span>先在「任务」里转录，或导入现成的 .srt / .vtt。</span>
                <div className="studio-inline">
                  <button className="mini-btn primary" onClick={() => setTab('task')}>去任务</button>
                  <button className="mini-btn" onClick={() => void importSubtitle()}>导入字幕</button>
                </div>
              </div>
            ) : (
              <>
                <div className="studio-toolbar">
                  <span>{importedName ? `${importedName} · ` : ''}{lines.length} 行</span>
                  <button className="mini-btn" onClick={() => void optimize()} disabled={optimizing}>
                    {optimizing ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />} AI 优化
                  </button>
                  <button className="mini-btn" onClick={() => setResegmentOpen(true)}>
                    <Scissors size={12} /> 断句
                  </button>
                  <select className="mini-select" value={target} onChange={(event) => setTarget(event.target.value)}>
                    {TARGETS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button className="mini-btn" onClick={() => void translate()} disabled={translating}>
                    {translating ? <Loader2 size={12} className="spin" /> : <Languages size={12} />} 翻译
                  </button>
                  <button className="mini-btn" onClick={() => void save()} disabled={!file}>
                    <Library size={12} /> 存入资料库
                  </button>
                  <button className="mini-btn primary" onClick={() => setTab('synthesis')}>去合成</button>
                </div>
                {optimizeMessage && <div className="studio-message">{optimizeMessage}</div>}
                <div className="studio-table" role="table" aria-label="字幕编辑">
                  <div className="studio-table-head" role="row">
                    <span>时间</span><span>原文</span><span>译文</span><span />
                  </div>
                  {lines.slice(0, 300).map((line, index) => (
                    <div className="studio-table-row" role="row" key={`${line.start}-${index}`}>
                      <span className="studio-time">
                        {Math.floor(line.start / 60)}:{String(Math.floor(line.start % 60)).padStart(2, '0')}
                      </span>
                      <input value={line.text} onChange={(event) => updateLine(index, event.target.value)} />
                      <input
                        value={translated?.[index]?.text || ''}
                        placeholder="译文"
                        onChange={(event) => updateTranslation(index, event.target.value)}
                      />
                      <span className="studio-row-actions">
                        <button title="与下一行合并" onClick={() => mergeNext(index)} disabled={index >= lines.length - 1}>
                          <Merge size={11} />
                        </button>
                        <button title="拆成两行" onClick={() => splitLine(index)}>
                          <Split size={11} />
                        </button>
                        <button title="删除本行" className="is-danger" onClick={() => removeLine(index)}>
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <SubtitleOptimizePanel
                  suggestions={suggestions}
                  selected={selectedSuggestions}
                  onToggle={(index) => {
                    setSelectedSuggestions((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  onApplyAll={() => applySuggestions(true)}
                  onApplySelected={() => applySuggestions(false)}
                  onClose={() => setSuggestions(null)}
                />
              </>
            )}
          </div>
        )}

        {tab === 'style' && (
          <div className="studio-style">
            <div className="studio-style-form studio-card">
              <label className="studio-field"><span>字体</span><input value={style.fontName} onChange={(event) => setStyle({ ...style, fontName: event.target.value })} /></label>
              <div className="studio-grid-2">
                <label className="studio-field"><span>字号</span><input type="number" min={20} max={120} value={style.fontSize} onChange={(event) => setStyle({ ...style, fontSize: Number(event.target.value) })} /></label>
                <label className="studio-field"><span>描边</span><input type="number" min={0} max={10} value={style.outline} onChange={(event) => setStyle({ ...style, outline: Number(event.target.value) })} /></label>
              </div>
              <div className="studio-grid-2">
                <label className="studio-field"><span>文字颜色</span><input type="color" value={style.primaryColor} onChange={(event) => setStyle({ ...style, primaryColor: event.target.value })} /></label>
                <label className="studio-field"><span>描边颜色</span><input type="color" value={style.outlineColor} onChange={(event) => setStyle({ ...style, outlineColor: event.target.value })} /></label>
              </div>
              <label className="studio-field">
                <span>位置</span>
                <select value={style.alignment} onChange={(event) => setStyle({ ...style, alignment: Number(event.target.value) })}>
                  <option value={8}>顶部</option>
                  <option value={5}>居中</option>
                  <option value={2}>底部</option>
                </select>
              </label>
              <label className="studio-check">
                <input type="checkbox" checked={style.bilingual} onChange={(event) => setStyle({ ...style, bilingual: event.target.checked })} />
                双语字幕
              </label>
              <div className="studio-inline">
                <button className="mini-btn primary" onClick={() => void persistStyle(false)}>
                  <Save size={12} /> 保存为默认
                </button>
              </div>
              <div className="studio-preset-row">
                <input value={presetName} placeholder="预设名称" onChange={(event) => setPresetName(event.target.value)} />
                <button className="mini-btn" onClick={() => void persistStyle(true)} disabled={!presetName.trim()}>
                  保存预设
                </button>
              </div>
              {presets.length > 0 && (
                <div className="studio-preset-list">
                  {presets.map((preset) => (
                    <button key={preset.name} className="mini-btn" onClick={() => setStyle({ ...DEFAULT_SUBTITLE_STYLE, ...preset.style })}>
                      {preset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="studio-style-preview studio-card">
              <div className="synth-preview render-style-preview">
                <div className="synth-preview-video" />
                <div
                  className="synth-preview-caption"
                  style={{ alignItems: style.alignment === 8 ? 'flex-start' : style.alignment === 5 ? 'center' : 'flex-end', paddingBottom: style.alignment === 2 ? 14 : 8 }}
                >
                  <div
                    className="synth-preview-text"
                    style={{
                      fontFamily: `${style.fontName}, "Microsoft YaHei", sans-serif`,
                      fontSize: `${Math.max(10, style.fontSize * 0.3)}px`,
                      color: style.primaryColor,
                      textShadow: style.outline ? `0 2px 3px ${style.outlineColor}, 1px 1px 0 ${style.outlineColor}` : 'none'
                    }}
                  >
                    {(lines[0]?.text || '示例字幕').slice(0, 24)}
                  </div>
                </div>
              </div>
              <div className="settings-hint">{style.fontName} · {style.fontSize}px · {style.bilingual ? '双语' : '单语'}</div>
            </div>
          </div>
        )}

        {tab === 'synthesis' && (
          <div className="studio-synthesis">
            {!lines.length ? (
              <div className="studio-empty">
                <Film size={24} />
                <b>先有字幕才能出成片</b>
                <span>去「字幕」生成或导入字幕后回来。</span>
                <button className="mini-btn primary" onClick={() => setTab('subtitle')}>去字幕</button>
              </div>
            ) : (
              <>
                <div className="studio-grid-2">
                  <button className="studio-action-card" onClick={() => { setSynthStyle(null); setSynthOpen(true); }}>
                    <Clapperboard size={20} />
                    <b>字幕视频合成</b>
                    <span>硬字幕 MP4 / 软字幕 MKV</span>
                  </button>
                  <button className="studio-action-card" onClick={() => setDubOpen(true)}>
                    <Sparkles size={20} />
                    <b>本地配音</b>
                    <span>生成配音音轨或替换视频音轨</span>
                  </button>
                </div>
                {render && (
                  <div className="studio-progress">
                    <div className="workbench-progress-head"><span>{render.message || '合成中…'}</span><span>{Math.round(render.percent)}%</span></div>
                    <div className="workbench-progress-bar"><span style={{ width: `${Math.max(2, Math.round(render.percent))}%` }} /></div>
                    <button className="mini-btn" onClick={() => window.bsub.cancelSynthesize?.(render.requestId)}>取消</button>
                  </div>
                )}
                <div className="studio-card studio-export-row">
                  <span>{file?.name || importedName || '未选择视频'} · {lines.length} 行</span>
                  <div className="studio-inline">
                    <ExportMenu info={info} track={track} lines={lines} translated={translated} onSynthesize={() => { setSynthStyle(null); setSynthOpen(true); }} onDub={() => setDubOpen(true)} />
                    <button className="mini-btn" onClick={() => setTab('style')}><Palette size={12} /> 调整样式</button>
                  </div>
                </div>
                <RendersPanel />
              </>
            )}
          </div>
        )}

        {tab === 'batch' && (
          <div className="studio-batch">
            <div
              className="studio-card studio-local-batch"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addBatchFiles([...event.dataTransfer.files]);
              }}
            >
              <div className="studio-toolbar">
                <span>本地文件批量转录（拖入多个文件，或逐个添加）。</span>
                <button className="mini-btn" onClick={() => void addLocalBatch()}>
                  <Plus size={12} /> 添加文件
                </button>
                <button
                  className="mini-btn primary"
                  onClick={() => void runLocalBatch()}
                  disabled={!localBatch.length || localBatchRunning}
                >
                  {localBatchRunning ? <Loader2 size={12} className="spin" /> : <Mic size={12} />}
                  开始全部
                </button>
              </div>
              {!localBatch.length ? (
                <div className="settings-hint">把本地视频/音频拖到这里，或点「添加文件」。</div>
              ) : (
                <div className="studio-local-list">
                  {localBatch.map((item) => (
                    <div className="studio-local-row" key={item.id}>
                      <span className="studio-batch-title">{item.name}</span>
                      <span className={`studio-local-status is-${item.status}`}>
                        {item.status === 'waiting' && '等待'}
                        {item.status === 'running' && `转录 ${Math.round(item.percent)}%`}
                        {item.status === 'done' && `完成 · ${item.lines.length} 行`}
                        {item.status === 'failed' && (item.error || '失败')}
                      </span>
                      <button
                        className="studio-local-remove"
                        title="移除"
                        onClick={() =>
                          setLocalBatch((current) => current.filter((row) => row.id !== item.id))
                        }
                        disabled={item.status === 'running'}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="studio-toolbar">
              <span>从资料库选择视频，批量烧录当前样式。</span>
              <button
                className="mini-btn primary"
                onClick={() => void startBatch()}
                disabled={!batchSelected.size || batchBusy}
              >
                {batchBusy ? <Loader2 size={12} className="spin" /> : <Film size={12} />}
                批量成片（{batchSelected.size}）
              </button>
            </div>
            {!library.length ? (
              <div className="studio-empty">
                <Library size={24} />
                <b>资料库里还没有视频</b>
                <span>先把本地视频转录并存入资料库，或在资料库导入。</span>
              </div>
            ) : (
              <div className="studio-batch-list">
                <label className="studio-batch-row is-head">
                  <input
                    type="checkbox"
                    checked={batchSelected.size === library.length}
                    onChange={(event) =>
                      setBatchSelected(
                        event.target.checked ? new Set(library.map((item) => item.id)) : new Set()
                      )
                    }
                  />
                  <span>全选</span><span>标题</span><span>时长</span>
                </label>
                {library.slice(0, 200).map((item) => (
                  <label className="studio-batch-row" key={item.id}>
                    <input
                      type="checkbox"
                      checked={batchSelected.has(item.id)}
                      onChange={(event) => {
                        setBatchSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        });
                      }}
                    />
                    <span className="studio-batch-kind">{item.kind || 'video'}</span>
                    <span className="studio-batch-title">{item.title}</span>
                    <span className="studio-time">{formatDuration(item.duration)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'records' && <RendersPanel />}
      </section>

      <ResegmentDialog open={resegmentOpen} lines={lines} onClose={() => setResegmentOpen(false)} onApply={(next) => { setLines(next); setTranslated(null); }} />
      <SynthesizeDialog
        open={synthOpen}
        videoPath={file?.path || ''}
        title={file?.name || importedName || '字幕视频'}
        lines={lines}
        translated={translated}
        initialStyle={synthStyle || style}
        onClose={() => { setSynthOpen(false); setSynthStyle(null); }}
      />
      <DubDialog open={dubOpen} videoPath={file?.path || ''} title={file?.name || importedName || '字幕视频'} lines={lines} onClose={() => setDubOpen(false)} />
      <DownloadVideoDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        initialUrl={taskUrl}
        onDownloaded={(path) => {
          const name = path.split(/[\\/]/).pop() || '下载的视频';
          setFile({ path, name, duration: 0 });
          setLines([]);
          setTranslated(null);
          setTab('task');
          setMessage(`下载完成 · ${name}，可以开始转录`);
        }}
      />
    </div>
  );
}
