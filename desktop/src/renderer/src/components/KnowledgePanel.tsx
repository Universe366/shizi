import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCopy,
  Database,
  ExternalLink,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import type {
  KbChunk,
  KbDocument,
  KbHit,
  KbLearningStatus,
  KbProgress,
  KbStatus,
  LibraryCollection
} from '../../../shared/types';
import { clock } from '../../../shared/kb';
import { EmptyState } from './ui/EmptyState';
import { Markdown } from './Markdown';

type Mode = 'ask' | 'search';
type HitFilter = 'all' | 'subtitle' | 'summary' | 'note';
type StatusFilter = 'all' | KbLearningStatus;
type Scope =
  | { type: 'all' }
  | { type: 'collection'; id: number; name: string }
  | { type: 'video'; id: number; title: string };

interface Turn {
  q: string;
  a: string;
  hits: KbHit[];
  mode: Mode;
  scope: string;
  videoId?: number;
}

const STATUS_LABEL: Record<KbLearningStatus, string> = {
  new: '未学',
  learning: '学习中',
  review: '待复习',
  mastered: '已掌握'
};

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'new', label: '未学' },
  { id: 'learning', label: '学习中' },
  { id: 'review', label: '待复习' },
  { id: 'mastered', label: '已掌握' }
];

const HIT_FILTERS: Array<{ id: HitFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'subtitle', label: '字幕' },
  { id: 'summary', label: '总结' },
  { id: 'note', label: '笔记' }
];

const KIND_LABEL: Record<string, string> = {
  subtitle: '字幕',
  summary: '总结',
  note: '笔记',
  meta: '资料'
};

const SKILLS = [
  { label: '总结资料', prompt: '用要点总结这些资料，并标出每条要点来自哪个视频。' },
  { label: '对比观点', prompt: '对比这些视频对同一问题的说法，列出分歧和一致点。' },
  { label: '关键概念', prompt: '列出这些资料里的关键概念，并各用一句话解释。' },
  { label: '按时间线', prompt: '按视频或时间顺序梳理这些资料里的关键结论。' }
];

const SCOPE_KEY = 'kb-scope';
const FONT_KEY = 'kb-reading-font';

function readScope(): Scope {
  try {
    const raw = JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}');
    if (raw?.type === 'video' && Number(raw.id)) {
      return { type: 'video', id: Number(raw.id), title: String(raw.title || '文档') };
    }
    if (raw?.type === 'collection' && Number(raw.id)) {
      return { type: 'collection', id: Number(raw.id), name: String(raw.name || '合集') };
    }
  } catch {
    // ignore
  }
  return { type: 'all' };
}

/** 工作台 → 知识库：文档树 + 问答/文档 + 引用栏，支持合集范围、学习状态与导出。 */
export function KnowledgePanel() {
  const [scope, setScope] = useState<Scope>(readScope);
  const [tab, setTab] = useState<'ask' | 'doc'>('ask');
  const [mode, setMode] = useState<Mode>('ask');
  const [question, setQuestion] = useState('');
  const [docQuery, setDocQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurn, setActiveTurn] = useState(0);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [detail, setDetail] = useState<{
    summary: string;
    note: string;
    url: string;
    chunks: KbChunk[];
  } | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    const raw = Number(localStorage.getItem(FONT_KEY));
    return Number.isFinite(raw) && raw >= 12 && raw <= 20 ? raw : 14;
  });
  const [railOpen, setRailOpen] = useState(true);
  const [progress, setProgress] = useState<KbProgress | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hitFilter, setHitFilter] = useState<HitFilter>('all');

  const selectedDoc = useMemo(
    () => (scope.type === 'video' ? docs.find((doc) => doc.videoId === scope.id) || null : null),
    [docs, scope]
  );

  const loadStatus = async () => {
    const response = await window.bsub.kbStatus();
    if (response.ok) setStatus(response.data);
  };

  const loadDocs = async () => {
    const response = await window.bsub.kbDocuments?.();
    if (response?.ok) setDocs(response.data);
  };

  const loadCollections = async () => {
    const response = await window.bsub.listCollections();
    if (response.ok) setCollections(response.data);
  };

  useEffect(() => {
    void loadStatus();
    void loadDocs();
    void loadCollections();
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

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
    } catch {
      // ignore
    }
    if (scope.type === 'collection') {
      setTab('ask');
    } else if (scope.type === 'video') {
      setTab('doc');
    }
  }, [scope]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {
      // ignore
    }
  }, [fontSize]);

  // 单篇文档的工作区数据（总结 / 笔记 / 索引片段）
  useEffect(() => {
    if (scope.type !== 'video') {
      setDetail(null);
      return;
    }
    let alive = true;
    void (async () => {
      const [item, chunks] = await Promise.all([
        window.bsub.getLibraryItem(scope.id),
        window.bsub.kbChunks?.(scope.id)
      ]);
      if (!alive) return;
      setDetail({
        summary: item.ok ? item.data.summary?.content || '' : '',
        note: item.ok ? item.data.note?.content || '' : '',
        url: item.ok ? item.data.video?.url || '' : '',
        chunks: chunks?.ok ? chunks.data : []
      });
    })();
    return () => {
      alive = false;
    };
  }, [scope]);

  const scopePayload = () => {
    if (scope.type === 'video') return { videoId: scope.id };
    if (scope.type === 'collection') return { collectionId: scope.id };
    return undefined;
  };

  const scopeLabel =
    scope.type === 'video' ? scope.title : scope.type === 'collection' ? scope.name : '全部文档';

  const filteredDocs = useMemo(() => {
    const keyword = docQuery.trim().toLowerCase();
    return docs.filter((doc) => {
      if (statusFilter !== 'all' && doc.status !== statusFilter) return false;
      if (!keyword) return true;
      return `${doc.title} ${doc.owner} ${doc.tags.join(' ')}`.toLowerCase().includes(keyword);
    });
  }, [docQuery, docs, statusFilter]);

  const run = async (preset?: string) => {
    const text = String(preset ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'search') {
        const response = await window.bsub.kbSearch(text, scopePayload());
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setTurns((current) =>
          [
            {
              q: text,
              a: '',
              hits: response.data,
              mode,
              scope: scopeLabel,
              videoId: scope.type === 'video' ? scope.id : undefined
            },
            ...current
          ].slice(0, 12)
        );
      } else {
        const response = await window.bsub.kbAsk(text, scopePayload());
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setTurns((current) =>
          [
            {
              q: text,
              a: response.data.text,
              hits: response.data.hits,
              mode,
              scope: scopeLabel,
              videoId: scope.type === 'video' ? scope.id : undefined
            },
            ...current
          ].slice(0, 12)
        );
      }
      setActiveTurn(0);
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

  const setStatusFor = async (videoId: number, next: KbLearningStatus) => {
    const response = await window.bsub.kbStatusSet(videoId, next);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setDocs((current) =>
      current.map((doc) => (doc.videoId === videoId ? { ...doc, status: response.data } : doc))
    );
  };

  const saveAsNote = async (turn: Turn) => {
    if (scope.type !== 'video') {
      setMessage('先选中一篇文档，再保存回答为笔记');
      return;
    }
    const item = await window.bsub.getLibraryItem(scope.id);
    if (!item.ok) {
      setError(item.error);
      return;
    }
    const sources = turn.hits
      .slice(0, 8)
      .map((hit, index) => `[${index + 1}] ${hit.title} @${clock(hit.startMs)}`)
      .join('\n');
    const block = [
      '',
      `## 问：${turn.q}`,
      '',
      turn.a || '（仅检索，没有回答）',
      '',
      sources ? `> 来源\n>${sources.split('\n').join('\n> ')}` : '',
      ''
    ].join('\n');
    const base = item.data.note?.content ? `${item.data.note.content}\n` : '';
    const response = await window.bsub.saveNote(scope.id, `${base}${block}`);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setDetail((current) => (current ? { ...current, note: response.data?.content || `${base}${block}` } : current));
    setMessage(`已保存到《${scope.title}》的笔记`);
  };

  const exportKb = async (format: 'markdown' | 'json') => {
    const response = await window.bsub.kbExport(format);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(response.data ? `已导出到 ${response.data}` : '已取消导出');
  };

  const jump = (hit: KbHit) => {
    void window.bsub.openLibrarySource(hit.videoId, hit.startMs);
  };

  const activeHits = turns[activeTurn]?.hits || [];
  const shownHits = activeHits.filter((hit) => hitFilter === 'all' || hit.kind === hitFilter);
  const totalChunks = docs.reduce((sum, doc) => sum + doc.chunks, 0);
  const readyDocs = docs.filter((doc) => doc.indexed > 0).length;

  return (
    <div className="knowledge-panel kb-panel">
      <header className="kb-head">
        <div>
          <div className="knowledge-title">知识库</div>
          <div className="settings-hint">
            {docs.length} 篇文档 · {totalChunks} 块 · {readyDocs} 篇已生成向量
          </div>
        </div>
        <div className="kb-head-actions">
          <span className={`kb-status${status?.ready ? ' is-ready' : ''}`}>
            <Database size={12} />
            {status ? `${status.chunks} 块 / ${status.videos} 个视频` : '读取中…'}
          </span>
          <select
            className="mini-select kb-export"
            value=""
            onChange={(event) => {
              const value = event.target.value as 'markdown' | 'json';
              if (value) void exportKb(value);
              event.currentTarget.value = '';
            }}
          >
            <option value="">导出…</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
          <button className="mini-btn" onClick={() => void loadStatus()} title="刷新状态">
            <RefreshCw size={12} />
          </button>
          <button className="mini-btn primary" disabled={indexing} onClick={() => void buildIndex()}>
            {indexing ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
            {status?.ready ? '重建索引' : '构建索引'}
          </button>
          <button
            className="mini-btn"
            title={railOpen ? '收起引用栏' : '展开引用栏'}
            onClick={() => setRailOpen((value) => !value)}
          >
            {railOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
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
      {message && <div className="settings-hint">{message}</div>}

      <div className={`kb-layout${railOpen ? ' has-rail' : ''}`}>
        <aside className="kb-side">
          <div className="kb-side-search">
            <Search size={13} />
            <input
              className="settings-input"
              value={docQuery}
              placeholder="搜索标题 / UP / 标签…"
              spellCheck={false}
              onChange={(event) => setDocQuery(event.target.value)}
            />
          </div>
          <div className="kb-side-filters">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                className={statusFilter === item.id ? 'is-active' : ''}
                onClick={() => setStatusFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="kb-doc-list">
            <button
              className={`kb-doc-row${scope.type === 'all' ? ' is-active' : ''}`}
              onClick={() => setScope({ type: 'all' })}
            >
              <span className="kb-doc-main">
                <span className="kb-doc-title">全部文档</span>
                <span className="kb-doc-meta">{totalChunks} 块 · 跨视频检索</span>
              </span>
            </button>

            {collections.length > 0 && (
              <div className="kb-tree-label">合集</div>
            )}
            {collections.map((collection) => (
              <button
                key={`c-${collection.id}`}
                className={`kb-doc-row kb-tree-group${
                  scope.type === 'collection' && scope.id === collection.id ? ' is-active' : ''
                }`}
                onClick={() =>
                  setScope({ type: 'collection', id: collection.id, name: collection.name })
                }
              >
                <span className="kb-doc-main">
                  <span className="kb-doc-title">{collection.name}</span>
                  <span className="kb-doc-meta">{collection.count} 个视频</span>
                </span>
              </button>
            ))}

            {docs.length > 0 && <div className="kb-tree-label">视频</div>}
            {filteredDocs.map((doc) => (
              <button
                key={doc.videoId}
                className={`kb-doc-row${scope.type === 'video' && scope.id === doc.videoId ? ' is-active' : ''}`}
                onClick={() =>
                  setScope({ type: 'video', id: doc.videoId, title: doc.title })
                }
                title={doc.title}
              >
                <span className={`kb-status-dot is-${doc.status}`} title={STATUS_LABEL[doc.status]} />
                <span className="kb-doc-main">
                  <span className="kb-doc-title">{doc.title}</span>
                  <span className="kb-doc-meta">
                    {doc.owner || '未知 UP'} · {doc.chunks} 块 · {STATUS_LABEL[doc.status]}
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
          <div className="kb-tabs">
            <button className={tab === 'ask' ? 'is-active' : ''} onClick={() => setTab('ask')}>
              问答
            </button>
            <button
              className={tab === 'doc' ? 'is-active' : ''}
              disabled={scope.type !== 'video'}
              onClick={() => setTab('doc')}
            >
              文档
            </button>
            <span className="kb-scope-chip" title={scopeLabel}>
              {scopeLabel}
            </span>
            {scope.type !== 'all' && (
              <button className="mini-btn" onClick={() => setScope({ type: 'all' })}>
                <X size={11} /> 清除
              </button>
            )}
          </div>

          {tab === 'ask' ? (
            <>
              <div className="knowledge-ask kb-ask">
                <textarea
                  className="settings-input knowledge-input"
                  rows={2}
                  value={question}
                  placeholder={
                    scope.type === 'video'
                      ? `只问《${scope.title}》这一篇…`
                      : scope.type === 'collection'
                        ? `只在这个合集「${scope.name}」里提问…`
                        : '例如：这几期视频里对「本地 ASR」的结论有什么差异？'
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
                    <button
                      className={mode === 'ask' ? 'is-active' : ''}
                      onClick={() => setMode('ask')}
                    >
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
                  desc="左侧可以按合集或单篇收窄范围；答案会引用具体片段，点引用可跳到视频时间。"
                />
              )}

              {turns.map((turn, turnIndex) => (
                <article
                  className={`kb-turn${turnIndex === activeTurn ? ' is-active' : ''}`}
                  key={`${turn.q}-${turnIndex}`}
                  onClick={() => setActiveTurn(turnIndex)}
                >
                  <div className="kb-turn-q">
                    <span className="kb-turn-mark">Q</span>
                    <span>{turn.q}</span>
                    <span className="kb-turn-scope">{turn.scope}</span>
                    <span className="kb-turn-mode">
                      {turn.mode === 'search' ? '检索' : '提问'}
                    </span>
                  </div>
                  {turn.a && (
                    <div className="knowledge-answer kb-answer">
                      <Markdown content={turn.a} />
                    </div>
                  )}
                  <div className="kb-turn-actions">
                    <button
                      className="mini-btn"
                      disabled={scope.type !== 'video'}
                      title={
                        scope.type === 'video'
                          ? '把这条回答追加到当前文档笔记'
                          : '先选中一篇文档'
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        void saveAsNote(turn);
                      }}
                    >
                      <ClipboardCopy size={11} /> 存为笔记
                    </button>
                    <span className="settings-hint">
                      {turn.hits.length} 个引用
                      {activeTurn === turnIndex ? ' · 右侧查看' : ''}
                    </span>
                  </div>
                </article>
              ))}
            </>
          ) : (
            <>
              {!selectedDoc ? (
                <EmptyState compact desc="左侧选一篇视频，查看总结、笔记和索引片段。" />
              ) : (
                <article className="kb-doc-body" style={{ fontSize: `${fontSize}px` }}>
                  <header className="kb-doc-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="kb-doc-heading" title={selectedDoc.title}>
                        {selectedDoc.title}
                      </div>
                      <div className="settings-hint">
                        {selectedDoc.owner || '未知 UP'} · {selectedDoc.chunks} 块 ·{' '}
                        {selectedDoc.indexed} 向量
                        {selectedDoc.tags.length ? ` · ${selectedDoc.tags.join(' / ')}` : ''}
                      </div>
                    </div>
                    <div className="kb-doc-head-actions">
                      {(['new', 'learning', 'review', 'mastered'] as KbLearningStatus[]).map(
                        (item) => (
                          <button
                            key={item}
                            className={`kb-status-pick${
                              selectedDoc.status === item ? ' is-active' : ''
                            }`}
                            onClick={() => void setStatusFor(selectedDoc.videoId, item)}
                          >
                            {STATUS_LABEL[item]}
                          </button>
                        )
                      )}
                      <button
                        className="mini-btn"
                        onClick={() => void window.bsub.openLibrarySource(selectedDoc.videoId)}
                      >
                        <ExternalLink size={11} /> 打开视频
                      </button>
                    </div>
                  </header>

                  <section className="kb-doc-section">
                    <div className="kb-doc-section-title">
                      概况
                      <span className="kb-font-tools">
                        <button className="mini-btn" onClick={() => setFontSize((v) => Math.max(12, v - 1))}>
                          A−
                        </button>
                        <button className="mini-btn" onClick={() => setFontSize((v) => Math.min(20, v + 1))}>
                          A+
                        </button>
                      </span>
                    </div>
                    {detail?.summary ? (
                      <Markdown content={detail.summary} />
                    ) : (
                      <div className="settings-hint">这篇还没有总结。</div>
                    )}
                  </section>

                  <section className="kb-doc-section">
                    <div className="kb-doc-section-title">笔记</div>
                    {detail?.note ? (
                      <Markdown content={detail.note} />
                    ) : (
                      <div className="settings-hint">还没有笔记；问答里可以「存为笔记」。</div>
                    )}
                  </section>

                  <section className="kb-doc-section">
                    <div className="kb-doc-section-title">
                      索引片段
                      <span className="settings-hint">{detail?.chunks.length || 0} 块</span>
                    </div>
                    <div className="kb-doc-chunks">
                      {(detail?.chunks || []).slice(0, 80).map((chunk, index) => (
                        <button
                          key={`${chunk.startMs}-${index}`}
                          className="kb-doc-chunk"
                          onClick={() => void window.bsub.openLibrarySource(selectedDoc.videoId, chunk.startMs)}
                        >
                          <span className="kb-doc-chunk-time">
                            {chunk.kind === 'subtitle' ? clock(chunk.startMs) : KIND_LABEL[chunk.kind] || '资料'}
                          </span>
                          <span className="kb-doc-chunk-text">{chunk.text.slice(0, 160)}</span>
                        </button>
                      ))}
                      {!detail?.chunks.length && (
                        <div className="settings-hint">还没有索引片段，先构建索引。</div>
                      )}
                    </div>
                  </section>
                </article>
              )}
            </>
          )}
        </main>

        {railOpen && (
          <aside className="kb-rail">
            <div className="kb-rail-head">
              <span>引用来源</span>
              <span className="settings-hint">
                {turns[activeTurn] ? `第 ${activeTurn + 1} 条回答` : '暂无'}
              </span>
            </div>
            <div className="kb-filters">
              {HIT_FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={hitFilter === item.id ? 'is-active' : ''}
                  onClick={() => setHitFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="kb-rail-list">
              {shownHits.map((hit, index) => (
                <div className="kb-rail-hit" key={`${hit.videoId}-${hit.startMs}-${index}`}>
                  <div className="kb-rail-hit-head">
                    <span className="knowledge-hit-index">[{index + 1}]</span>
                    <span className="kb-rail-hit-title" title={hit.title}>
                      {hit.title || '未命名'}
                    </span>
                    <span className="kb-rail-hit-kind">
                      {hit.kind === 'subtitle' ? clock(hit.startMs) : KIND_LABEL[hit.kind] || '资料'}
                    </span>
                  </div>
                  <div className="kb-rail-hit-text">{hit.text.slice(0, 180)}</div>
                  <div className="kb-rail-hit-actions">
                    {hit.kind === 'subtitle' && hit.startMs > 0 ? (
                      <button className="mini-btn" onClick={() => jump(hit)}>
                        跳到 {clock(hit.startMs)}
                      </button>
                    ) : null}
                    <button className="mini-btn" onClick={() => void window.bsub.openLibrarySource(hit.videoId)}>
                      <ExternalLink size={11} /> 打开
                    </button>
                    <span className="kb-rail-hit-score">{hit.score.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              {!shownHits.length && (
                <div className="settings-hint">
                  {activeHits.length ? '这个类型没有命中片段' : '提问后这里会列出引用片段'}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
