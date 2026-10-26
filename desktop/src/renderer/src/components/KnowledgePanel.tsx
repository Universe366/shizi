import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { KbHit, KbStatus } from '../../../shared/types';
import { clock } from '../../../shared/kb';
import { Markdown } from './Markdown';

/** 工作台 → 知识库：跨视频提问，回答带 [n] 引用，可跳到对应视频。 */
export function KnowledgePanel() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [hits, setHits] = useState<KbHit[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<KbStatus | null>(null);

  useEffect(() => {
    void window.bsub.kbStatus().then((response) => {
      if (response.ok) setStatus(response.data);
    });
  }, []);

  const ask = async (preset?: string) => {
    const text = String(preset ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setError('');
    setAnswer('');
    setHits([]);
    try {
      const response = await window.bsub.kbAsk(text);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setAnswer(response.data.text);
      setHits(response.data.hits);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="knowledge-panel">
      <div className="knowledge-head">
        <div>
          <div className="knowledge-title">问我的库</div>
          <div className="settings-hint">
            跨视频检索字幕、总结与笔记；回答里的 [n] 对应下面列出的片段。
            {status
              ? ` 当前索引：${status.chunks} 块 / ${status.videos} 个视频${status.ready ? '' : '（还没构建）'}`
              : ''}
          </div>
        </div>
      </div>

      <div className="knowledge-ask">
        <textarea
          className="settings-input knowledge-input"
          rows={2}
          value={question}
          placeholder="例如：这几期视频里对「本地 ASR」的结论有什么差异？"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <button className="mini-btn primary" disabled={!question.trim() || asking} onClick={() => void ask()}>
          {asking ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
          提问
        </button>
      </div>

      {!status?.ready && (
        <div className="settings-hint">
          还没有索引：到「设置 → AI 与语音 → 知识库」选择 embedding 平台与模型，然后点「构建 / 重建索引」。
        </div>
      )}

      {error && <div className="warn-card">{error}</div>}

      {answer && (
        <div className="knowledge-answer">
          <Markdown content={answer} />
        </div>
      )}

      {hits.length > 0 && (
        <div className="knowledge-hits">
          <div className="knowledge-hits-title">引用片段（{hits.length}）</div>
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
                {hit.kind === 'subtitle' ? clock(hit.startMs) : hit.kind === 'summary' ? '总结' : hit.kind === 'note' ? '笔记' : '资料'}
              </span>
              <span className="knowledge-hit-score">{hit.score.toFixed(2)}</span>
              <span className="knowledge-hit-text">{hit.text.slice(0, 120)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
