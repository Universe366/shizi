import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import type { KbDocument, KbHit, KbProgress, KbStatus } from '../../../shared/types';
import { clock } from '../../../shared/kb';
import { EmptyState } from './ui/EmptyState';
import { Markdown } from './Markdown';

type Mode = 'ask' | 'search';
type HitFilter = 'all' | 'subtitle' | 'summary' | 'note';
type DocFilter = 'all' | 'indexed' | 'summary';

interface Turn {
  q: string;
  a: string;
  hits: KbHit[];
  mode: Mode;
  scope: string;
}

const KIND_LABEL: Record<string, string> = {
  subtitle: '字幕',
  summary: '总结',
  note: '笔记',
  meta: '资料'
};

const HIT_FILTERS: Array<{ id: HitFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'subtitle', label: '字幕' },
  { id: 'summary', label: '总结' },
  { id: 'note', label: '笔记' }
];

const DOC_FILTERS: Array<{ id: DocFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'indexed', label: '已索引' },
  { id: 'summary', label: '有总结' }
];

const SELECTED_KEY = 'kb-selected-video';

const SKILLS = [
  { label: '总结资料', prompt: '用要点总结这些资料，并标出每条要点来自哪个视频。' },
  { label: '对比观点', prompt: '对比这些视频对同一问题的说法，列出分歧和一致点。' },
  { label: '关键概念', prompt: '列出这些资料里的关键概念，并各用一句话解释。' },
  { label: '按时间线', prompt: '按视频或时间顺序梳理这些资料里的关键结论。' }
];

/** 工作台 → 知识库：左侧文档清单 + 右侧问答，可按单篇视频收窄检索范围。 */
export function KnowledgePanel() {
  const [mode, setMode] = useState<Mode>('ask');
  const [question, setQuestion] = useState('');
  const [docQuery, setDocQuery] = useState('');
  const [docFilter, setDocFilter] = useState<DocFilter>('all');
  const [selectedVideo, setSelectedVideo] = useState<number | null>(() => {
    try {
      const raw = Number(localStorage.getItem(SELECTED_KEY));
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
      return null;
    }
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [progress, setProgress] = useState<KbProgress | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [hitFilter, setHitFilter] = useState<HitFilter>('all');

  const loadStatus = async () => {
    const response = await window.bsub.kbStatus();
    if (response.ok) setStatus(response.data);
  };

  const loadDocs = async () => {
    const response = await window.bsub.kbDocuments?.();
    if (response?.ok) setDocs(response.data);
  };

  useEffect(() => {
    void loadStatus();
    void loadDocs();
    const off = window.bsub.onKbProgress?.((event) => {
      setProgress(event);
      if (event.phase === 'done') {
        window.setTimeout(() => setProgress(null), 1200);
        void loadStatus();
        void loadDocs();
      }
      if (event.phase === 'error') {
        window.setTimeout(() => setProgress(null), 2200);
      }
    });
    return () => off?.();
  }, []);

  const selectedDoc = useMemo(
    () => docs.find((doc) => doc.videoId === selectedVideo) || null,
    [docs, selectedVideo]
  );

  useEffect(() => {
    try {
      if (selectedVideo) localStorage.setItem(SELECTED_KEY, String(selectedVideo));
      else localStorage.removeItem(SELECTED_KEY);
    } catch {
      // ignore
    }
  }, [selectedVideo]);

  const filteredDocs = useMemo(() => {
    const keyword = docQuery.trim().toLowerCase();
    return docs.filter((doc) => {
      if (docFilter === 'indexed' && doc.indexed <= 0) return false;
      if (docFilter === 'summary' && doc.summary <= 0) return false;
      if (!keyword) return true;
      return `${doc.title} ${doc.owner}`.toLowerCase().includes(keyword);
    });
  }, [docFilter, docQuery, docs]);

  const run = async (preset?: string) => {
    const text = String(preset ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setError('');
    const scope = selectedDoc?.title || '全部文档';
    const videoId = selectedDoc?.videoId;
    try {
      if (mode === 'search') {
        const response = await window.bsub.kbSearch(text, videoId);
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setTurns((current) =>
          [{ q: text, a: '', hits: response.data, mode, scope }, ...current].slice(0, 12)
        );
      } else {
        const response = await window.bsub.kbAsk(text, videoId);
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setTurns((current) =>
          [
            { q: text, a: response.data.text, hits: response.data.hits, mode, scope },
            ...current
          ].slice(0, 12)
        );
      }
      setQuestion('');
    } finally {
      setAsking(false);
    }
  };

  const buildIndex = async () => {
    if (indexing) return;
    setIndexing(true);
    setError('');
    try {
      const response = await window.bsub.kbIndex();
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setStatus(response.data);
      await loadDocs();
    } finally {
      setIndexing(false);
    }
  };

  const totalChunks = docs.reduce((sum, doc) => sum + doc.chunks, 0);
  const readyDocs = docs.filter((doc) => doc.indexed > 0).length;

  return (
    <div className="knowledge-panel kb-panel">
      <header className="kb-head">
        <div>
          <div className="knowledge-title">知识库</div>
          <div className="settings-hint">
            {docs.length} 篇文档 · {totalChunks} 块 · {readyDocs} 篇已生成向量；回答里的 [n]
            对应引用片段，点开可回到视频。
          </div>
        </div>
        <div className="kb-head-actions">
          <span className={`kb-status${status?.ready ? ' is-ready' : ''}`}>
            <Database size={12} />
            {status ? `${status.chunks} 块 / ${status.videos} 个视频` : '读取中…'}
            {status?.ready ? ' · 已就绪' : ' · 未索引'}
          </span>
          <button className="mini-btn" onClick={() => void loadStatus()} title="刷新状态">
            <RefreshCw size={12} />
          </button>
          <button className="mini-btn primary" disabled={indexing} onClick={() => void buildIndex()}>
            {indexing ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
            {status?.ready ? '重建索引' : '构建索引'}
          </button>
        </div>
      </header>

      {(progress || indexing) && (
        <div className="kb-progress">
          <div className="kb-progress-head">
            <span>{progress?.message || '准备索引…'}</span>
            <span>{progress ? `${progress.done} / ${progress.total}` : ''}</span>
          </div>
          <div className="kb-progress-bar">
            <span
              style={{
                width: `${
                  progress && progress.total
                    ? Math.max(2, Math.round((progress.done / progress.total) * 100))
                    : indexing
                      ? 6
                      : 0
                }%`
              }}
            />
          </div>
        </div>
      )}

      {error && <div className="warn-card">{error}</div>}

      <div className="kb-layout">
        <aside className="kb-side">
          <div className="kb-side-head">
            <span>文档</span>
            <span className="kb-side-count">{docs.length}</span>
          </div>
          <div className="kb-side-search">
            <Search size={13} />
            <input
              className="settings-input"
              value={docQuery}
              placeholder="搜索标题 / UP 主…"
              spellCheck={false}
              onChange={(event) => setDocQuery(event.target.value)}
            />
          </div>
          <div className="kb-side-filters">
            {DOC_FILTERS.map((item) => (
              <button
                key={item.id}
                className={docFilter === item.id ? 'is-active' : ''}
                onClick={() => setDocFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="kb-doc-list">
            <button
              className={`kb-doc-row${selectedVideo === null ? ' is-active' : ''}`}
              onClick={() => setSelectedVideo(null)}
            >
              <span className="kb-doc-main">
                <span className="kb-doc-title">全部文档</span>
                <span className="kb-doc-meta">{totalChunks} 块 · 跨视频检索</span>
              </span>
            </button>
            {filteredDocs.map((doc) => (
              <button
                key={doc.videoId}
                className={`kb-doc-row${selectedVideo === doc.videoId ? ' is-active' : ''}`}
                onClick={() => setSelectedVideo(doc.videoId)}
                title={doc.title}
              >
                <span className="kb-doc-main">
                  <span className="kb-doc-title">{doc.title}</span>
                  <span className="kb-doc-meta">
                    {doc.owner || '未知 UP'} · 字幕 {doc.subtitle} · 总结 {doc.summary} · 笔记{' '}
                    {doc.note}
                  </span>
                </span>
                <span className={`kb-doc-badge${doc.indexed > 0 ? ' is-ready' : ''}`}>
                  {doc.indexed > 0 ? doc.indexed : '未索引'}
                </span>
              </button>
            ))}
            {filteredDocs.length === 0 && (
              <div className="kb-side-empty">
                {docs.length ? '没有匹配的文档' : '还没有文档，先构建索引'}
              </div>
            )}
          </div>
        </aside>

        <main className="kb-main">
          {selectedDoc && (
            <div className="kb-scope">
              <BookOpen size={14} />
              <span className="kb-scope-title" title={selectedDoc.title}>
                {selectedDoc.title}
              </span>
              <span className="settings-hint">
                {selectedDoc.chunks} 块 · {selectedDoc.indexed > 0 ? '已索引' : '未索引'}
              </span>
              <button
                className="mini-btn"
                onClick={() => void window.bsub.openLibrarySource(selectedDoc.videoId)}
              >
                <ExternalLink size={11} /> 打开视频
              </button>
              <button className="mini-btn" onClick={() => setSelectedVideo(null)}>
                <X size={11} /> 清除范围
              </button>
            </div>
          )}

          <div className="knowledge-ask kb-ask">
            <textarea
              className="settings-input knowledge-input"
              rows={2}
              value={question}
              placeholder={
                selectedDoc
                  ? `只问《${selectedDoc.title}》这一篇…`
                  : mode === 'ask'
                    ? '例如：这几期视频里对「本地 ASR」的结论有什么差异？'
                    : '只检索片段，不调用对话模型，例如：本地 ASR 的依赖'
              }
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <div className="kb-ask-side">
              <div className="kb-mode">
                <button className={mode === 'ask' ? 'is-active' : ''} onClick={() => setMode('ask')}>
                  提问
                </button>
                <button
                  className={mode === 'search' ? 'is-active' : ''}
                  onClick={() => setMode('search')}
                >
                  仅检索
                </button>
              </div>
              <button
                className="mini-btn primary"
                disabled={!question.trim() || asking}
                onClick={() => void run()}
              >
                {asking ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
                {mode === 'ask' ? '提问' : '检索'}
              </button>
            </div>
          </div>

          <div className="kb-skills">
            <span className="settings-hint">快捷</span>
            {SKILLS.map((skill) => (
              <button
                key={skill.label}
                className="kb-skill"
                disabled={asking}
                onClick={() => void run(skill.prompt)}
              >
                {skill.label}
              </button>
            ))}
            <span className="settings-hint kb-hybrid-hint">向量 + 关键词混合检索</span>
          </div>

          {!status?.ready && (
            <div className="settings-hint">
              还没有索引：到「设置 → AI 与语音 → 知识库」选择 embedding 平台与模型，然后点右上角「构建索引」。
            </div>
          )}

          {turns.length === 0 && status?.ready && (
            <EmptyState
              compact
              icon={<Search size={18} />}
              title="问点什么"
              desc={
                selectedDoc
                  ? '当前范围是左侧选中的文档；点「清除范围」可以跨视频提问。'
                  : '比如「哪期视频讲过 WBI 签名」「把这几期的结论按时间线整理一下」。'
              }
            />
          )}

          {turns.map((turn, turnIndex) => {
            const hits = turn.hits.filter((hit) => hitFilter === 'all' || hit.kind === hitFilter);
            return (
              <article className="kb-turn" key={`${turn.q}-${turnIndex}`}>
                <div className="kb-turn-q">
                  <span className="kb-turn-mark">Q</span>
                  <span>{turn.q}</span>
                  <span className="kb-turn-scope">{turn.scope}</span>
                  <span className="kb-turn-mode">{turn.mode === 'search' ? '检索' : '提问'}</span>
                </div>
                {turn.a && (
                  <div className="knowledge-answer kb-answer">
                    <Markdown content={turn.a} />
                  </div>
                )}
                {turn.hits.length > 0 && (
                  <div className="knowledge-hits">
                    <div className="knowledge-hits-title">
                      引用片段（{hits.length}/{turn.hits.length}）
                      <span className="kb-filters">
                        {HIT_FILTERS.map((item) => (
                          <button
                            key={item.id}
                            className={hitFilter === item.id ? 'is-active' : ''}
                            onClick={() => setHitFilter(item.id)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </span>
                    </div>
                    {hits.map((hit, index) => (
                      <button
                        key={`${hit.videoId}-${hit.startMs}-${index}`}
                        className="knowledge-hit"
                        title={hit.text.slice(0, 300)}
                        onClick={() => void window.bsub.openLibrarySource(hit.videoId)}
                      >
                        <span className="knowledge-hit-index">[{index + 1}]</span>
                        <span className="knowledge-hit-title">{hit.title || '未命名'}</span>
                        <span className="knowledge-hit-time">
                          {hit.kind === 'subtitle'
                            ? clock(hit.startMs)
                            : KIND_LABEL[hit.kind] || '资料'}
                        </span>
                        <span className="knowledge-hit-score">{hit.score.toFixed(2)}</span>
                        <span className="knowledge-hit-text">{hit.text.slice(0, 120)}</span>
                      </button>
                    ))}
                    {hits.length === 0 && (
                      <div className="settings-hint">这个类型没有命中片段，换一个筛选试试。</div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </main>
      </div>
    </div>
  );
}