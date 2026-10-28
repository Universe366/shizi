import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, Loader2, Sparkles, Square, Volume2 } from 'lucide-react';
import type {
  AiUsage,
  Chapter,
  PageInfo,
  SubtitleLine,
  SubtitleTrack,
  TabInfo,
  VerificationSummary
} from '../../../shared/types';
import { Markdown } from './Markdown';
import { EmptyState } from './ui/EmptyState';
import { SourcesCard } from './SourcesCard';
import { VerifyCard } from './VerifyCard';
import { ExportMenu } from './ExportMenu';
import { pickTrack, isVideoKey, videoKeyOf } from '../lib/video';
import { getAsrResult, setAsrResult } from '../lib/asrStore';
import { formatDuration } from '../lib/format';
import { formatTokens } from '../lib/usageStats';
import { invalidCitationNumbers } from '../../../shared/chatCitations';
import { speakText } from '../lib/speech';
import {
  consumeSummaryPanelRequest,
  requestSummaryPanel
} from '../lib/summaryRequest';

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function SummaryPanel({
  activeTab,
  onOpenSettings
}: {
  activeTab: TabInfo | null;
  onOpenSettings: () => void;
}) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [summary, setSummary] = useState('');
  const [verification, setVerification] = useState<VerificationSummary | null>(null);
  const [verifyEnabled, setVerifyEnabled] = useState(true);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [fromSaved, setFromSaved] = useState(false);
  const [model, setModel] = useState('');
  const [updatedAt, setUpdatedAt] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [verifyThisRun, setVerifyThisRun] = useState(true);
  const startedAtRef = useRef(0);
  const [summaryVideoKey, setSummaryVideoKey] = useState('');
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const progressPhaseRef = useRef('');
  const [loading, setLoading] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preProofread, setPreProofread] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [asrRunning, setAsrRunning] = useState(false);
  const [asrProgress, setAsrProgress] = useState(0);
  const [asrMessage, setAsrMessage] = useState('');
  const requestRef = useRef('');
  const autoReadSummaryRef = useRef(false);
  const streamingRef = useRef(false);
  const liveRef = useRef<HTMLPreElement>(null);
  const asrRequestRef = useRef('');
  const asrInfoRef = useRef<PageInfo | null>(null);
  const asrKeyRef = useRef('');
  const videoKeyRef = useRef('');
  const activeTabRef = useRef<TabInfo | null>(null);
  // 流式增量先攒进 ref，按 ~90ms 一批刷到 React。
  // 推理模型每个 token 都 setState 会让整个面板反复重渲染，界面明显发卡，
  // 也会拖慢关闭/切面板这类交互。
  const streamBufferRef = useRef('');
  const reasoningBufferRef = useRef('');
  const flushTimerRef = useRef<number | null>(null);

  const flushStreams = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pendingText = streamBufferRef.current;
    const pendingReasoning = reasoningBufferRef.current;
    streamBufferRef.current = '';
    reasoningBufferRef.current = '';
    if (pendingText) setStreamText((previous) => previous + pendingText);
    if (pendingReasoning) setReasoning((previous) => previous + pendingReasoning);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushStreams();
    }, 90);
  }, [flushStreams]);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = isVideoKey(videoKey);
  videoKeyRef.current = videoKey;
  activeTabRef.current = activeTab;

  useEffect(() => {
    if (streamingRef.current) return;
    if (requestRef.current) {
      void window.bsub.cancelSummary(requestRef.current);
      requestRef.current = '';
    }
    setInfo(null);
    setSummary('');
    setVerification(null);
    setFromSaved(false);
    setModel('');
    setUpdatedAt(0);
    setLines([]);
    setTrack(null);
    setStreamText('');
    setError(null);
    setStreaming(false);
    setChapters([]);
    setChaptersOpen(false);
    setChaptersLoading(false);
    setChapterError(null);
    setAsrRunning(false);
    setAsrProgress(0);
    setAsrMessage('');
    if (asrRequestRef.current) {
      void window.bsub.cancelTranscribe(asrRequestRef.current);
      asrRequestRef.current = '';
    }
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    if (streamingRef.current) return;
    if (!activeTab || activeTab.loading || !isVideoPage) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        let response = await window.bsub.getPageInfo();
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (cancelled) return;
          if (response.ok && response.data.bvid && response.data.cid) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
          response = await window.bsub.getPageInfo();
        }
        if (cancelled) return;
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setInfo(response.data);
        const saved = await window.bsub.getSummary({
          bvid: response.data.bvid,
          cid: response.data.cid,
          epId: response.data.epId
        });
        if (cancelled) return;
        if (saved.ok && saved.data) {
          setSummary(saved.data.content);
          setFromSaved(true);
          setModel(saved.data.model);
          setUpdatedAt(saved.data.updatedAt);
          setVerification(saved.data.verification ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.loading, videoKey, isVideoPage]);

  useEffect(() => {
    const offDelta = window.bsub.onAiDelta((event) => {
      if (event.requestId === requestRef.current) {
        streamBufferRef.current += event.delta;
        scheduleFlush();
      }
    });
    const offDone = window.bsub.onAiDone((event) => {
      if (event.requestId !== requestRef.current) return;
      flushStreams();
      console.log(
        '[summary-done]',
        event.verification
          ? `${event.verification.attempted}/${event.verification.references.length}`
          : 'none'
      );
      setSummary(event.text);
      setVerification(event.verification || null);
      setFromSaved(false);
      setModel(event.model);
      setUsage(event.usage || null);
      setUpdatedAt(Date.now());
      setStreaming(false);
      setStreamText('');
      setStatus('');
      if (event.verification) {
        const referenceCount = (event.verification.sources || event.verification.references || [])
          .length;
        const bad = invalidCitationNumbers(event.text, referenceCount);
        if (bad.length) {
          setStatus(
            `引用编号越界：${bad.map((item) => `[${item}]`).join('、')}（仅提示，未修改正文）`
          );
        }
      }
      setTotalMs(startedAtRef.current ? Date.now() - startedAtRef.current : 0);
      if (autoReadSummaryRef.current && event.text.trim()) {
        void speakText(event.text);
      }
      // 总结面板变化后原生页面偶尔留白；主动重报布局 + 重绘一次。
      window.setTimeout(() => {
        window.dispatchEvent(new Event('bsub:layout-refresh'));
        window.bsub.refreshView();
      }, 80);
    });
    const offError = window.bsub.onAiError((event) => {
      if (event.requestId !== requestRef.current) return;
      flushStreams();
      streamingRef.current = false;
      setError(event.error);
      setStreaming(false);
      setStatus('');
      setTotalMs(startedAtRef.current ? Date.now() - startedAtRef.current : 0);
    });
    const offStatus = window.bsub.onAiStatus((event) => {
      if (event.requestId !== requestRef.current) return;
      setStatus(event.status);
    });
    const offReasoning = window.bsub.onAiReasoning((event) => {
      if (event.requestId !== requestRef.current) return;
      reasoningBufferRef.current += event.delta;
      scheduleFlush();
    });
    return () => {
      offDelta();
      offDone();
      offError();
      offStatus();
      offReasoning();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flushStreams, scheduleFlush]);

  useEffect(() => {
    const element = liveRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [streamText]);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (response.ok) {
        setPreProofread(response.data.settings.ai.preProofread === true);
        // 总结核对由 verifySummary 控制；verify 是「AI 优化时核对」，不要混用。
        setVerifyEnabled(response.data.settings.search.verifySummary !== false);
        setVerifyThisRun(response.data.settings.search.verifySummary !== false);
        setSearchEnabled(response.data.settings.search.enabled !== false);
        autoReadSummaryRef.current = response.data.settings.tts?.autoRead?.summary === true;
      }
    });
    return window.bsub.onSettingsChanged((snapshot) => {
      setPreProofread(snapshot.settings.ai.preProofread === true);
      setVerifyEnabled(snapshot.settings.search.verifySummary !== false);
      setSearchEnabled(snapshot.settings.search.enabled !== false);
      autoReadSummaryRef.current = snapshot.settings.tts?.autoRead?.summary === true;
    });
  }, []);

  useEffect(() => {
    const phase = /^联网核对|^正在从字幕抽取/.test(status)
      ? 'verify'
      : /^长视频分段|^正在合并|^第 \d+\/\d+ 段/.test(status)
        ? 'chunk'
        : /^先校对|^已校对/.test(status)
          ? 'proof'
          : /^正在生成/.test(status)
            ? 'generate'
            : '';
    const match = /(\d+)\s*\/\s*(\d+)/.exec(status);
    if (!phase) {
      progressPhaseRef.current = '';
      setProgress(null);
      return;
    }
    const pct = match
      ? Math.max(2, Math.min(100, Math.round((Number(match[1]) / Number(match[2])) * 100)))
      : null;
    if (phase !== progressPhaseRef.current) {
      progressPhaseRef.current = phase;
      setProgress(pct);
      return;
    }
    if (pct !== null) setProgress((prev) => Math.max(prev ?? 0, pct));
  }, [status]);

  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      if (startedAtRef.current) setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const ensureLines = useCallback(async () => {
    const tabId = activeTabRef.current?.id;
    const infoResponse = await window.bsub.getPageInfo(tabId);
    if (!infoResponse.ok) throw new Error(infoResponse.error);
    const currentInfo = infoResponse.data;

    const subtitles = await window.bsub.getSubtitles(currentInfo.signature, tabId);
    if (!subtitles.ok) throw new Error(subtitles.error);
    const needLogin = subtitles.data.needLogin === true;

    const chosen = pickTrack(subtitles.data.tracks, currentInfo);
    const fallback = () => {
      const cached = getAsrResult(videoKeyRef.current);
      if (!cached) return null;
      const asrTrack: SubtitleTrack = {
        lan: cached.source === 'import' ? 'import' : 'asr',
        lanDoc: cached.label,
        url: cached.url,
        isAi: false,
        aiStatus: null,
        source: cached.source
      };
      setInfo(cached.info);
      setTrack(asrTrack);
      setLines(cached.lines);
      return { info: cached.info, track: asrTrack, lines: cached.lines };
    };

    if (!chosen) {
      const cached = fallback();
      if (cached) return cached;
      const saved = await window.bsub.savedSubtitles(currentInfo);
      if (saved.ok && saved.data.length) {
        const savedTrack = saved.data[0];
        const savedBody = await window.bsub.getTrackBody(savedTrack.url);
        if (savedBody.ok && savedBody.data.lines.length) {
          setInfo(currentInfo);
          setTrack(savedTrack);
          setLines(savedBody.data.lines);
          return { info: currentInfo, track: savedTrack, lines: savedBody.data.lines };
        }
      }
      if (needLogin) {
        throw new Error('需要登录 B 站才能获取 AI 字幕；请先点「登录 B 站」，或点「转写」/「导入字幕」后重试');
      }
      throw new Error('该视频没有官方字幕；请点「转写」生成，或在字幕面板「导入字幕」后重试');
    }

    const body = await window.bsub.getTrackBody(chosen.url);
    if (!body.ok) {
      const cached = fallback();
      if (cached) return cached;
      throw new Error(body.error);
    }

    setInfo(currentInfo);
    setTrack(chosen);
    setLines(body.data.lines);
    return { info: currentInfo, track: chosen, lines: body.data.lines };
  }, []);

  const generate = async (skipProofread = false) => {
    if (streaming) return;
    flushStreams();
    streamBufferRef.current = '';
    reasoningBufferRef.current = '';
    setError(null);
    streamingRef.current = true;
    setStreaming(true);
    setSummaryVideoKey(videoKey);
    setStreamText('');
    setSummary('');
    setReasoning('');
    setVerification(null);
    setUsage(null);
    setFromSaved(false);
    setStatus('准备字幕…');
    setProgress(null);
    progressPhaseRef.current = '';
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setTotalMs(0);

    try {
      const data = await ensureLines();
      const requestId = newRequestId();
      requestRef.current = requestId;
      const started = await window.bsub.summarize({
        requestId,
        info: data.info,
        lines: data.lines,
        // 「快速」与插件一致：跳过字幕校对 + 联网核对，直接生成。
        skipProofread,
        skipVerify: skipProofread || !verifyThisRun
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setError((caught as Error).message);
      setStreaming(false);
    }
  };

  const cancel = () => {
    streamingRef.current = false;
    if (requestRef.current) void window.bsub.cancelSummary(requestRef.current);
  };

  const startAsr = async () => {
    if (asrRunning || streaming || !isVideoPage) return;
    setError(null);
    setAsrProgress(0);
    setAsrMessage('准备音轨…');
    try {
      const response = await window.bsub.getPageInfo(activeTabRef.current?.id);
      if (!response.ok) throw new Error(response.error);
      const requestId = newRequestId();
      asrRequestRef.current = requestId;
      asrKeyRef.current = videoKeyRef.current;
      asrInfoRef.current = response.data;
      setAsrRunning(true);
      const started = await window.bsub.transcribe(requestId);
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      asrRequestRef.current = '';
      setAsrRunning(false);
      setAsrMessage('');
      setError((caught as Error)?.message || String(caught));
    }
  };

  useEffect(() => {
    const offProgress = window.bsub.onAsrProgress((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      setAsrProgress(Math.max(0, Math.min(100, Number(event.percent) || 0)));
      setAsrMessage(event.message || '转写中…');
    });
    const offDone = window.bsub.onAsrDone((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      asrRequestRef.current = '';
      setAsrRunning(false);
      setAsrProgress(100);
      setAsrMessage(`转写完成 · ${event.lines.length} 行`);
      const key = asrKeyRef.current;
      const info = asrInfoRef.current;
      if (info) setAsrResult(key, info, event.lines);
      if (event.saved === false) {
        setError(
          `转录完成，但没有保存到资料库：${event.saveError || '未知原因'}。重启后会丢失，请重试。`
        );
      }
      // 等 asrStore 写入后，复用总结请求入口触发生成。
      if (key && key === videoKeyRef.current) {
        window.setTimeout(() => requestSummaryPanel('summary'), 0);
      }
    });
    const offError = window.bsub.onAsrError((event) => {
      if (event.requestId !== asrRequestRef.current) return;
      asrRequestRef.current = '';
      setAsrRunning(false);
      setAsrMessage('');
      setError(event.error);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (consumeSummaryPanelRequest('summary')) void generate();
    };
    window.addEventListener('bsub:summary-request', handler);
    // lazy 组件第一次挂载时事件可能已经发过：挂载后补一次消费。
    if (consumeSummaryPanelRequest('summary')) void generate();
    return () => window.removeEventListener('bsub:summary-request', handler);
  }, [generate]);

  const loadChapters = async () => {
    if (chaptersLoading) return;
    setChaptersLoading(true);
    setChapterError(null);
    try {
      const data = await ensureLines();
      const response = await window.bsub.generateChapters(data.info, data.lines);
      if (response.ok) {
        setChapters(response.data);
        setChaptersOpen(response.data.length > 0 && response.data.length <= 4);
      }
      else setChapterError(response.error);
    } catch (caught) {
      setChapterError((caught as Error).message);
    } finally {
      setChaptersLoading(false);
    }
  };

  useEffect(() => {
    const handler = () => {
      if (consumeSummaryPanelRequest('chapters')) void loadChapters();
    };
    window.addEventListener('bsub:chapters-request', handler);
    if (consumeSummaryPanelRequest('chapters')) void loadChapters();
    return () => window.removeEventListener('bsub:chapters-request', handler);
  });

  const showSettingsHint =
    Boolean(error) &&
    /Key|模型|平台|设置|401|403|404/.test(error || '');

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="panel-title">总结</div>
        <div className="toolbar-actions">
          <button
            className="mini-btn"
            disabled={!isVideoPage || loading || streaming || asrRunning}
            title="没有官方字幕时，用视频音轨转写后再总结"
            onClick={() => void startAsr()}
          >
            {asrRunning ? <Loader2 size={12} className="spin" /> : '转写'}
          </button>
          <button
            className="mini-btn"
            disabled={!isVideoPage || loading || chaptersLoading || streaming}
            title="用 AI 生成可跳转章节"
            onClick={() => void loadChapters()}
          >
            {chaptersLoading ? <Loader2 size={12} className="spin" /> : '章节'}
          </button>
          {summary && (
            <button
              className="mini-btn"
              title="复制总结 Markdown"
              onClick={() => {
                void window.bsub.writeClipboard(summary);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy size={12} /> {copied ? '已复制' : ''}
            </button>
          )}
          {summary && (
            <button
              className="mini-btn"
              title="朗读总结"
              onClick={() => void speakText(summary)}
            >
              <Volume2 size={12} />
            </button>
          )}
          {summary && <ExportMenu info={info} track={track} lines={lines} summary={summary} />}
          {!streaming && searchEnabled && (
            <label className="summary-verify-toggle" title="关闭可明显加快生成（不联网核对）">
              <input
                type="checkbox"
                checked={verifyThisRun}
                onChange={(event) => setVerifyThisRun(event.target.checked)}
              />
              核对
            </label>
          )}
          {!streaming && (preProofread || (verifyEnabled && searchEnabled)) && (
            <button
              className="mini-btn"
              disabled={!isVideoPage || loading || !activeTab}
              onClick={() => void generate(true)}
              title="快速总结：跳过字幕校对与联网核对，直接生成（更快、更省额度）"
            >
              快速
            </button>
          )}
          {streaming ? (
            <button className="mini-btn" onClick={cancel} title="停止生成">
              <Square size={11} /> 停止
            </button>
          ) : (
            <button
              className="mini-btn primary"
              disabled={!isVideoPage || loading || !activeTab}
              onClick={() => void generate()}
              title={
                preProofread
                  ? summary
                    ? '重新生成（先校对字幕 + 联网核对）'
                    : '生成总结（先校对字幕 + 联网核对）'
                  : verifyEnabled
                    ? summary
                      ? '重新生成（先联网核对）'
                      : '生成总结（先联网核对，可能较慢）'
                    : summary
                      ? '重新生成'
                      : '生成 AI 总结'
              }
            >
              {summary ? '重生成' : '生成'}
            </button>
          )}
        </div>
      </div>

      {asrRunning && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          {asrMessage || '正在转写…'}
          {asrProgress > 0 ? ` · ${Math.round(asrProgress)}%` : ''}
        </div>
      )}

      {!activeTab && <div className="panel-empty">打开一个视频页后生成总结</div>}
      {activeTab && !isVideoPage && <div className="panel-empty">当前页面不是视频页</div>}

      {loading && !info && (
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取视频信息…
        </div>
      )}

      {info && (
        <div className="summary-video">
          <div className="summary-video-title" title={info.title}>
            {info.title}
          </div>
          <div className="summary-video-meta">
            {info.owner} · {formatDuration(info.duration)}
          </div>
        </div>
      )}

      {chapterError && <div className="settings-hint">章节生成失败：{chapterError}</div>}

      {chapters.length > 0 && (
        <details
          className="chapters-card"
          open={chaptersOpen}
          onToggle={(event) => setChaptersOpen(event.currentTarget.open)}
        >
          <summary className="chapters-head">
            <span>章节 · {chapters.length}</span>
            <span className="chapters-toggle">{chaptersOpen ? '收起' : '展开'}</span>
          </summary>
          <div className="chapters-list">
            {chapters.map((chapter) => (
              <button
                key={`${chapter.start}-${chapter.title}`}
                className="chapter-row"
                onClick={() => void window.bsub.seek(chapter.start + 0.05)}
              >
                <span className="chapter-time">{formatDuration(chapter.start)}</span>
                <span className="chapter-title">{chapter.title}</span>
              </button>
            ))}
          </div>
        </details>
      )}

      {error && (
        <div className="warn-card">
          <AlertTriangle size={15} />
          <div className="warn-body">
            <div className="warn-title">生成失败</div>
            <div className="warn-desc">{error}</div>
            {showSettingsHint && (
              <button className="warn-btn" onClick={onOpenSettings}>
                去设置
              </button>
            )}
            {/没有.*字幕|字幕轨|AI 字幕/.test(error) && !asrRunning && (
              <button className="warn-btn" onClick={() => void startAsr()}>
                转写后总结
              </button>
            )}
            {/登录 B 站/.test(error) && (
              <button
                className="warn-btn"
                onClick={() => void window.bsub.newTab('https://passport.bilibili.com/login')}
              >
                登录 B 站
              </button>
            )}
          </div>
        </div>
      )}

      {reasoning && (
        <details
          className="chat-reasoning"
          open={reasoningOpen}
          onToggle={(event) => setReasoningOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>
            💭 思考过程{streaming ? '（生成中）' : ''}
            <button
              type="button"
              className="chat-reasoning-close"
              title="隐藏思考过程"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                reasoningBufferRef.current = '';
                setReasoning('');
                setReasoningOpen(false);
              }}
            >
              隐藏
            </button>
          </summary>
          <pre>{reasoning}</pre>
        </details>
      )}

      {streaming && (
        <>
          {status && (
            <div className="status-line summary-status">
              <Loader2 size={13} className="spin" />
              <span className="summary-status-text">{status}</span>
              {elapsedMs > 0 && (
                <span className="summary-elapsed">
                  {formatDuration(Math.round(elapsedMs / 1000))}
                </span>
              )}
            </div>
          )}
          <div
            className={`summary-progress${progress !== null ? ' is-determinate' : ''}`}
            aria-label="正在生成"
          >
            <span style={progress !== null ? { width: `${progress}%` } : undefined} />
          </div>
          <pre className="summary-live" ref={liveRef}>
            {streamText || '正在生成…'}
          </pre>
        </>
      )}

      {!streaming && totalMs > 0 && (
        <div className="summary-elapsed-line">
          本次耗时 {formatDuration(Math.round(totalMs / 1000))}
          {searchEnabled && verifyThisRun ? '（含联网核对）' : ''}
          {usage
            ? ` · 生成 ${formatTokens(usage.inputTokens)} in / ${formatTokens(
                usage.outputTokens
              )} out`
            : ''}
        </div>
      )}

      {!streaming && summary && summaryVideoKey && summaryVideoKey !== videoKey && (
        <div className="summary-verify-hint">
          <span>这份总结属于上一个视频；切换回该视频或重新生成。</span>
        </div>
      )}

      {!streaming &&
        summary &&
        (!verification || (!fromSaved && (!verifyEnabled || !searchEnabled))) && (
          <div className="summary-verify-hint">
            {fromSaved ? (
              <>
                <span>
                  这是已保存的总结；
                  {!searchEnabled || !verifyEnabled
                    ? '重新生成不会执行联网核对。'
                    : '重新生成会执行联网核对。'}
                </span>
                {(!searchEnabled || !verifyEnabled) && (
                  <button className="mini-btn" onClick={onOpenSettings}>
                    去设置
                  </button>
                )}
              </>
            ) : !searchEnabled ? (
              <>
                <span>联网检索已在设置中关闭，本次总结不会检查外部证据。</span>
                <button className="mini-btn" onClick={onOpenSettings}>
                  去设置
                </button>
              </>
            ) : !verifyEnabled ? (
              <>
                <span>联网核对未开启，本次总结不会检查外部证据。</span>
                <button className="mini-btn" onClick={onOpenSettings}>
                  去设置
                </button>
              </>
            ) : (
              <span>本次没有产生核对结果（可能没有可核实项或检索失败）。</span>
            )}
          </div>
        )}

      {!streaming && verification?.sources?.length ? (
        <SourcesCard sources={verification.sources} />
      ) : null}

      {!streaming &&
        verification &&
        !(
          verification.sources?.length &&
          verification.items.length === 0 &&
          verification.references.length === 0 &&
          !verification.error
        ) && <VerifyCard verification={verification} />}

      {!streaming && summary && (
        <div className="summary-content">
          <Markdown
            content={summary}
            citations={verification?.sources}
            citePrefix="summary"
          />
        </div>
      )}

      {!streaming && !summary && !error && isVideoPage && !loading && (
        <EmptyState
          fill
          icon={<Sparkles size={22} />}
          title="还没有总结"
          desc="会先抓取当前视频字幕，再调用设置里的 AI 平台生成。"
          action={
            <button className="primary-btn" onClick={() => void generate()}>
              生成总结
            </button>
          }
        />
      )}

      {summary && (
        <div className="panel-foot">
          <span>{model || 'AI'}</span>
          <span>{updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : ''}</span>
        </div>
      )}
    </div>
  );
}