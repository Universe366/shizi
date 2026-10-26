import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AiPlatform, AppSettings } from '../../../../shared/types';
import { ModelChips, SettingsSection } from './SettingsSection';

interface AiSectionProps {
  draft: AppSettings;
  active: AiPlatform | null;
  updateAi: (patch: Partial<AppSettings['ai']>) => void;
  updatePlatform: (patch: Partial<AiPlatform>) => void;
  addPlatform: () => void;
  removePlatform: () => void;
  testConnection: (kind: 'ai' | 'asr' | 'search') => void;
  probeModels: (kind: 'ai' | 'asr') => void;
  platformBusy: string;
  modelCache: Record<string, string[]>;
  showKey: Record<string, boolean>;
  setShowKey: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  setEditingAiId: (id: string) => void;
  platformStatus: (kind: 'ai' | 'asr' | 'search') => ReactNode;
}

/** AI 平台：平台选择、Base URL/模型/Key、连通性与模型探测、生成参数。 */
export function AiSection({
  draft,
  active,
  updateAi,
  updatePlatform,
  addPlatform,
  removePlatform,
  testConnection,
  probeModels,
  platformBusy,
  modelCache,
  showKey,
  setShowKey,
  setEditingAiId,
  platformStatus
}: AiSectionProps) {
  if (!active) return null;

  return (
<SettingsSection title="AI 平台" defaultOpen={true}>
  <div className="settings-hint">
    决定总结、对话、翻译用哪个模型。Key 只保存在本机设置里，不会上传到别处。
  </div>

  <div className="settings-group">
    <div className="settings-group-title">使用哪个平台</div>
    <div className="settings-inline">
      <select
        className="settings-input"
        value={active?.id || ''}
        onChange={(event) => setEditingAiId(event.target.value)}
      >
        {draft.ai.platforms.map((platform) => (
          <option key={platform.id} value={platform.id}>
            {platform.name}
            {platform.id === draft.ai.activeId ? '（使用中）' : ''}
            {!platform.apiKey ? ' · 未配 Key' : ''}
          </option>
        ))}
      </select>
      {active && active.id !== draft.ai.activeId && (
        <button
          className="mini-btn primary"
          onClick={() => updateAi({ activeId: active.id })}
        >
          设为使用中
        </button>
      )}
      <button className="mini-btn" title="新增平台" onClick={addPlatform}>
        <Plus size={12} />
      </button>
      <button
        className="mini-btn"
        title="删除当前平台"
        disabled={draft.ai.platforms.length <= 1}
        onClick={removePlatform}
      >
        <Trash2 size={12} />
      </button>
    </div>
    {active.id !== draft.ai.activeId && (
      <div className="settings-hint">
        正在编辑「{active.name}」；点「设为使用中」后，总结和对话才会用它。
      </div>
    )}
  </div>

  <div className="settings-group">
    <div className="settings-group-title">连接信息</div>
    <div className="settings-group-desc">
      地址和模型名要填平台文档里的值；不确定时先点「测试连接」。
    </div>

    <div className="settings-label">平台名称</div>
    <input
      className="settings-input"
      value={active.name}
      onChange={(event) => updatePlatform({ name: event.target.value })}
    />

    <div className="settings-label">接口地址（Base URL）</div>
    <input
      className="settings-input"
      value={active.baseUrl}
      spellCheck={false}
      onChange={(event) => updatePlatform({ baseUrl: event.target.value })}
    />

    <div className="settings-label">模型</div>
    <input
      className="settings-input"
      list={`ai-models-${active.id}`}
      value={active.model}
      spellCheck={false}
      onChange={(event) => updatePlatform({ model: event.target.value })}
    />
    <datalist id={`ai-models-${active.id}`}>
      {(modelCache[active.id] || active.models || []).map((model) => (
        <option key={model} value={model} />
      ))}
    </datalist>

    <div className="settings-label">API Key</div>
    <div className="settings-inline">
      <input
        className="settings-input"
        type={showKey[active.id] ? 'text' : 'password'}
        value={active.apiKey === '__CLEAR__' ? '' : active.apiKey}
        placeholder="留空保存不改动"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => updatePlatform({ apiKey: event.target.value })}
      />
      <button
        className="mini-btn"
        onClick={() =>
          setShowKey((previous) => ({ ...previous, [active.id]: !previous[active.id] }))
        }
      >
        {showKey[active.id] ? '隐藏' : '显示'}
      </button>
      <button
        className="mini-btn"
        onClick={() => updatePlatform({ apiKey: '__CLEAR__' })}
      >
        清除
      </button>
    </div>

    <div className="settings-inline">
      <button
        className="mini-btn primary"
        disabled={platformBusy === 'ai:test'}
        onClick={() => void testConnection('ai')}
      >
        {platformBusy === 'ai:test' ? <Loader2 size={12} className="spin" /> : <Wifi size={12} />}
        测试连接
      </button>
      <button
        className="mini-btn"
        disabled={platformBusy === 'ai:probe'}
        title="调用平台接口，拉取当前账号可用的模型列表"
        onClick={() => void probeModels('ai')}
      >
        {platformBusy === 'ai:probe' ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
        获取模型列表
      </button>
      {active.homepage && (
        <button className="mini-btn" onClick={() => void window.bsub.newTab(active.homepage!)}>
          官网
        </button>
      )}
      {active.keyUrl && (
        <button className="mini-btn" onClick={() => void window.bsub.newTab(active.keyUrl!)}>
          获取 Key
        </button>
      )}
    </div>
    {platformStatus('ai')}
    <ModelChips
      key={active.id}
      models={modelCache[active.id] || active.models || []}
      current={active.model}
      probed={Boolean(modelCache[active.id])}
      onPick={(model) => updatePlatform({ model })}
    />

    <details className="settings-advanced">
      <summary>预设的官网 / 申请 Key 链接</summary>
      <div className="settings-label">官网地址</div>
      <input
        className="settings-input"
        value={active.homepage || ''}
        placeholder="https://"
        onChange={(event) => updatePlatform({ homepage: event.target.value })}
      />
      <div className="settings-label">申请 Key 链接</div>
      <input
        className="settings-input"
        value={active.keyUrl || ''}
        placeholder="https://"
        onChange={(event) => updatePlatform({ keyUrl: event.target.value })}
      />
    </details>
  </div>

  <div className="settings-group">
    <div className="settings-group-title">回答方式</div>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.ai.stream !== false}
        onChange={(event) => updateAi({ stream: event.target.checked })}
      />
      流式输出（边生成边显示；关闭后等完整回答再显示）
    </label>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.ai.sendOnEnter !== false}
        onChange={(event) => updateAi({ sendOnEnter: event.target.checked })}
      />
      回车发送消息（关闭后改为 Ctrl / Cmd + 回车）
    </label>

    <details className="settings-advanced">
      <summary>高级设置</summary>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">温度（0–2，越高越发散）</div>
          <input
            className="settings-input"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.ai.temperature}
            onChange={(event) => updateAi({ temperature: Number(event.target.value) })}
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">最大 token</div>
          <input
            className="settings-input"
            type="number"
            min={256}
            max={64000}
            step={256}
            value={draft.ai.maxTokens}
            onChange={(event) => updateAi({ maxTokens: Number(event.target.value) })}
          />
        </div>
      </div>
    </details>
  </div>

  <div className="settings-group">
    <div className="settings-group-title">总结与对话的行为</div>
    <div className="settings-group-desc">这几项会改变生成速度和可用的上下文，默认值适合大多数人。</div>

    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.ai.preProofread === true}
        onChange={(event) => updateAi({ preProofread: event.target.checked })}
      />
      总结前先 AI 校对字幕（更慢，会多一次 AI 调用）
    </label>

    <label className="settings-check" title="只影响是否默认展开，不改变模型是否思考，也不改变速度">
      <input
        type="checkbox"
        checked={draft.ai.expandReasoning === true}
        onChange={(event) => updateAi({ expandReasoning: event.target.checked })}
      />
      默认展开模型的思考过程（只影响显示）
    </label>

    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.ai.appTools !== false}
        onChange={(event) => updateAi({ appTools: event.target.checked })}
      />
      允许 AI 查询本地库（只读：搜字幕、读总结和笔记）
    </label>
  </div>
</SettingsSection>
  );
}
