import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCopy,
  Database,
  ExternalLink,
  History as HistoryIcon,
  Layers,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import type {
  KbCard,
  KbChunk,
  KbDocument,
  KbHit,
  KbLearningStatus,
  KbProgress,
  KbQaEntry,
  KbStatus,
  LibraryCollection
} from '../../../shared/types';
import type { KbReviewGrade } from '../../../shared/kbReview';
import { clock } from '../../../shared/kb';
import { EmptyState } from './ui/EmptyState';
import { Markdown } from './Markdown';

type Mode = 'ask' | 'search';
type MainTab = 'ask' | 'doc' | 'review' | 'history';
type CardFilter = 'due' | 'all';
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
  const [tab, setTab] = useState<MainTab>('ask');
  const [mode, setMode] = useState<Mode>('ask');
  const [question, setQuestion] = useState('');
  const [docQuery, setDocQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurn, setActiveTurn] = useState(0);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [history, setHistory] = useState<KbQaEntry[]>([]);
  const [cards, setCards] = useState<KbCard[]>([]);
  const [cardFilter, setCardFilter] = useState<CardFilter>('due');
  const [revealed, setRevealed] = useState<number[]>([]);
  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState({ front: '', back: '' });
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

  const relatedQa = useMemo(() => {
    if (!selectedDoc) return [];
    return history
      .filter((entry) => entry.hits.some((hit) => hit.videoId === selectedDoc.videoId))
      .slice(0, 6);
  }, [history, selectedDoc]);

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

  const loadHistory = async (videoId?: number) => {
    const response = await window.bsub.kbHistory?.({ videoId, limit: 50 });
    if (response?.ok) setHistory(response.data);
  };

  const loadCards = async (filter: CardFilter = cardFilter) => {
    const response = await window.bsub.kbCards?.({ dueOnly: filter === 'due', limit: 100 });
    if (response?.ok) setCards(response.data);
  };

  useEffect(() => {
    void loadStatus();
    void loadDocs();
    void loadCollections();
    void loadHistory();
    void loadCards('due');
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
      void loadHistory();
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

  const addCard = async (front: string, back: string) => {
    const response = await window.bsub.kbCardAdd?.({
      videoId: scope.type === 'video' ? scope.id : undefined,
      front,
      back
    });
    if (!response?.ok) {
      setError(response?.error || '添加卡片失败');
      return;
    }
    setCardDraft({ front: '', back: '' });
    setCardFormOpen(false);
    setMessage('已加入复习队列');
    await loadCards(cardFilter);
  };

  const saveCardFromTurn = (turn: Turn) => {
    const sources = turn.hits
      .slice(0, 5)
      .map((hit, index) => `[${index + 1}] ${hit.title} @${clock(hit.startMs)}`)
      .join('\n');
    void addCard(turn.q, `${turn.a || '（仅检索）'}\n\n${sources}`);
  };

  const reviewCard = async (id: number, grade: KbReviewGrade) => {
    const response = await window.bsub.kbCardReview?.(id, grade);
    if (!response?.ok) {
      setError(response?.error || '复习失败');
      return;
    }
    setRevealed((current) => current.filter((item) => item !== id));
    await loadCards(cardFilter);
  };

  const removeCard = async (id: number) => {
    const response = await window.bsub.kbCardDelete?.(id);
    if (!response?.ok) {
      setError(response?.error || '删除失败');
      return;
    }
    setCards((current) => current.filter((card) => card.id !== id));
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
            <button
              className={tab === 'review' ? 'is-active' : ''}
              onClick={() => {
                setTab('review');
                void loadCards(cardFilter);
              }}
            >
              <Layers size={12} /> 复习
              {cards.length > 0 && <span className="kb-tab-badge">{cards.length}</span>}
            </button>
            <button
              className={tab === 'history' ? 'is-active' : ''}
              onClick={() => {
                setTab('history');
                void loadHistory();
              }}
            >
              <HistoryIcon size={12} /> 历史
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
                    <button
                      className="mini-btn"
                      title="把这条问答加入复习队列"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveCardFromTurn(turn);
                      }}
                    >
                      <Layers size={11} /> 存为复习卡
                    </button>
                    <span className="settings-hint">
                      {turn.hits.length} 个引用
                      {activeTurn === turnIndex ? ' · 右侧查看' : ''}
                    </span>
                  </div>
                </article>
              ))}
            </>
          ) : tab === 'doc' ? (
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
                    <div className="kb-doc-section-title">
                      相关问题
                      <span className="settings-hint">{relatedQa.length} 条</span>
                    </div>
                    {relatedQa.length ? (
                      <div className="kb-related-list">
                        {relatedQa.map((entry) => (
                          <button
                            key={entry.id}
                            className="kb-related-row"
                            onClick={() => {
                              setTurns([
                                {
                                  q: entry.question,
                                  a: entry.answer,
                                  hits: entry.hits,
                                  mode: entry.mode,
                                  scope: entry.scopeLabel
                                }
                              ]);
                              setActiveTurn(0);
                              setTab('ask');
                            }}
                          >
                            <span className="kb-related-q">{entry.question}</span>
                            <span className="kb-related-meta">
                              {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-hint">
                        还没有问题引用过这篇；在问答里提问后会自动建立关联。
                      </div>
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
          ) : tab === 'review' ? (
            <>
              <div className="kb-memory-head">
                <div className="kb-filters">
                  <button
                    className={cardFilter === 'due' ? 'is-active' : ''}
                    onClick={() => {
                      setCardFilter('due');
                      void loadCards('due');
                    }}
                  >
                    到期
                  </button>
                  <button
                    className={cardFilter === 'all' ? 'is-active' : ''}
                    onClick={() => {
                      setCardFilter('all');
                      void loadCards('all');
                    }}
                  >
                    全部
                  </button>
                </div>
                <span className="settings-hint">{cards.length} 张卡片</span>
                <button className="mini-btn" onClick={() => setCardFormOpen((value) => !value)}>
                  <Plus size={11} /> 新建卡片
                </button>
              </div>

              {cardFormOpen && (
                <div className="kb-card-form">
                  <input
                    className="settings-input"
                    placeholder="正面：一个问题或要点"
                    value={cardDraft.front}
                    onChange={(event) => setCardDraft({ ...cardDraft, front: event.target.value })}
                  />
                  <textarea
                    className="settings-input"
                    rows={3}
                    placeholder="背面：答案、结论或原文摘录"
                    value={cardDraft.back}
                    onChange={(event) => setCardDraft({ ...cardDraft, back: event.target.value })}
                  />
                  <div className="kb-card-form-actions">
                    <button className="mini-btn" onClick={() => setCardFormOpen(false)}>
                      取消
                    </button>
                    <button
                      className="mini-btn primary"
                      disabled={!cardDraft.front.trim() || !cardDraft.back.trim()}
                      onClick={() => void addCard(cardDraft.front, cardDraft.back)}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}

              {cards.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Layers size={18} />}
                  title={cardFilter === 'due' ? '今天没有到期卡片' : '还没有复习卡片'}
                  desc="问答里的「存为复习卡」或右上角「新建卡片」都会进入这里；记住 / 模糊 / 忘记会按间隔重复重新排期。"
                />
              ) : (
                <div className="kb-card-list">
                  {cards.map((card) => {
                    const shown = revealed.includes(card.id);
                    return (
                      <article className="kb-card" key={card.id}>
                        <div className="kb-card-front">{card.front}</div>
                        {shown ? (
                          <div className="kb-card-back">{card.back}</div>
                        ) : (
                          <button
                            className="mini-btn"
                            onClick={() => setRevealed((current) => [...current, card.id])}
                          >
                            显示答案
                          </button>
                        )}
                        {shown && (
                          <div className="kb-card-grades">
                            <button className="mini-btn" onClick={() => void reviewCard(card.id, 'again')}>
                              忘记
                            </button>
                            <button className="mini-btn" onClick={() => void reviewCard(card.id, 'hard')}>
                              模糊
                            </button>
                            <button
                              className="mini-btn primary"
                              onClick={() => void reviewCard(card.id, 'good')}
                            >
                              记住
                            </button>
                            <button className="mini-btn" title="删除卡片" onClick={() => void removeCard(card.id)}>
                              <Trash2 size={11} />
                            </button>
                            <span className="settings-hint">
                              间隔 {card.intervalDays || 0} 天 · 连续 {card.streak}
                            </span>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="kb-memory-head">
                <span className="settings-hint">{history.length} 条问答记录</span>
                <button className="mini-btn" onClick={() => void loadHistory()}>
                  <RefreshCw size={11} /> 刷新
                </button>
              </div>
              {history.length === 0 ? (
                <EmptyState
                  compact
                  icon={<HistoryIcon size={18} />}
                  title="还没有问答历史"
                  desc="提问或检索后会自动记录；点历史可以恢复当时的回答和引用，也能看到哪些文档被引用过。"
                />
              ) : (
                <div className="kb-history-list">
                  {history.map((entry) => (
                    <button
                      key={entry.id}
                      className="kb-history-row"
                      onClick={() => {
                        setTurns([
                          {
                            q: entry.question,
                            a: entry.answer,
                            hits: entry.hits,
                            mode: entry.mode,
                            scope: entry.scopeLabel
                          }
                        ]);
                        setActiveTurn(0);
                        setTab('ask');
                      }}
                    >
                      <span className="kb-history-q">{entry.question}</span>
                      <span className="kb-history-meta">
                        {entry.scopeLabel} · {new Date(entry.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {entry.mode === 'search' ? '检索' : '提问'} · {entry.hits.length} 引用
                      </span>
                    </button>
                  ))}
                </div>
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
