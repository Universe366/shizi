import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { AiPlatform, AppSettings, KbProgress, KbStatus } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['knowledge'];
  platforms: AiPlatform[];
  onChange: (patch: Partial<AppSettings['knowledge']>) => void;
}

/** 知识库：跨视频字幕/总结/笔记的 embedding 索引。 */
export function KnowledgeSection({ value, platforms, onChange }: Props) {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [progress, setProgress] = useState<KbProgress | null>(null);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const response = await window.bsub.kbStatus();
    if (response.ok) setStatus(response.data);
  };

  useEffect(() => {
    void refresh();
    return window.bsub.onKbProgress((event) => setProgress(event));
  }, []);

  const build = async () => {
    if (building) return;
    setBuilding(true);
    setNotice('');
    setProgress({ phase: 'collect', done: 0, total: 1, message: '准备索引…' });
    try {
      const response = await window.bsub.kbIndex();
      if (!response.ok) {
        setNotice(`构建失败：${response.error}`);
        setProgress(null);
        return;
      }
      setStatus(response.data);
      setNotice(`索引完成：${response.data.chunks} 块 / ${response.data.videos} 个视频`);
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  };

  return (
    <SettingsSection title="知识库" defaultOpen={false}>
      <div className="settings-hint">
        把库里所有视频的字幕、总结和笔记切块并生成向量，之后可以在工作台「知识库」页跨视频提问。
        需要支持 OpenAI 兼容 <code>/embeddings</code> 的平台。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用知识库
      </label>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">向量来源</div>
          <select
            className="settings-input"
            value={value.provider || 'platform'}
            onChange={(event) =>
              onChange({ provider: event.target.value as 'platform' | 'local' })
            }
          >
            <option value="platform">AI 平台（OpenAI 兼容）</option>
            <option value="local">内置本地模型（离线）</option>
          </select>
        </div>
      </div>
      {(value.provider || 'platform') === 'local' ? (
        <div className="settings-hint">
          使用内置 bge-small-zh-v1.5（512 维）：模型在「AI 与语音 → 本地模型管理」下载，
          由 onnxruntime 在本机推理，不联网、不需要 Key。切换来源后需要重建索引。
        </div>
      ) : (
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">Embedding 平台</div>
            <select
              className="settings-input"
              value={value.platformId}
              onChange={(event) => onChange({ platformId: event.target.value })}
            >
              <option value="">跟随当前平台</option>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <div className="settings-label">Embedding 模型</div>
            <input
              className="settings-input"
              value={value.model}
              placeholder="text-embedding-3-small / BAAI/bge-m3"
              spellCheck={false}
              onChange={(event) => onChange({ model: event.target.value })}
            />
          </div>
        </div>
      )}
      <div className="settings-inline">
        <button className="mini-btn" disabled={!value.enabled || building} onClick={() => void refresh()}>
          <RefreshCw size={12} /> 刷新状态
        </button>
        <button
          className="mini-btn primary"
          disabled={!value.enabled || building}
          onClick={() => void build()}
          title="会删除旧索引并重新调用 embedding（可能计费）"
        >
          {building ? <Loader2 size={12} className="spin" /> : null}
          构建 / 重建索引
        </button>
        {status && (
          <span className="settings-hint">
            {status.chunks} 块 · {status.videos} 个视频 · {status.modelLabel || status.model}
          </span>
        )}
      </div>
      {progress && <div className="settings-hint">{progress.message}</div>}
      {notice && <div className="settings-hint">{notice}</div>}
      <div className="settings-hint">
        重建会重新调用 embedding，可能产生费用；普通使用建议只在大量新增内容后再点。
      </div>
    </SettingsSection>
  );
}
