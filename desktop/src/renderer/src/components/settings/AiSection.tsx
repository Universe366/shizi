import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AiPlatform, AppSettings } from '../../../../shared/types';
import { ModelChips, SettingsSection } from './SettingsSection';
import {
  capabilityKey,
  effectiveModelCapabilities,
  inferModelCapabilities
} from '../../../../shared/modelCapabilities';

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

    <div className="settings-label">协议</div>
    <div className="settings-inline">
      <select
        className="settings-input"
        value={active.kind || ''}
        onChange={(event) => updatePlatform({ kind: event.target.value })}
      >
        <option value="">OpenAI 兼容</option>
        <option value="anthropic">Anthropic 原生（/v1/messages）</option>
        <option value="gemini">Gemini 原生（generateContent）</option>
        <option value="azure">Azure OpenAI（部署名）</option>
      </select>
    </div>
    {active.kind === 'azure' && (
      <>
        <div className="settings-label">api-version</div>
        <input
          className="settings-input"
          value={active.apiVersion || '2024-10-21'}
          spellCheck={false}
          onChange={(event) => updatePlatform({ apiVersion: event.target.value })}
        />
        <div className="settings-hint">
          Azure 的「模型」填部署名（deployment），Base URL 填资源地址（https://xxx.openai.azure.com）。
        </div>
      </>
    )}

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

    {(() => {
      const key = capabilityKey(active.id, active.model);
      const inferred = inferModelCapabilities(active.kind, active.model);
      const override = draft.ai.capabilities?.[key] || {};
      const capability = effectiveModelCapabilities(active.kind, active.model, override);
      const setCapability = (patch: { vision?: boolean; audio?: boolean }) =>
        updateAi({
          capabilities: {
            ...(draft.ai.capabilities || {}),
            [key]: { ...override, ...patch }
          }
        });
      return (
        <div className="model-capabilities">
          <div className="model-capabilities-head">
            <span className="settings-label">模型能力</span>
            <span className="settings-hint">
              {inferred.vision || inferred.audio ? '已自动识别，可手动覆盖' : '未识别到图片/音频能力'}
            </span>
          </div>
          <div className="model-capabilities-chips">
            <label className="model-capability is-locked" title="文本输入始终启用">
              <input type="checkbox" checked readOnly disabled /> 文本
            </label>
            <label className="model-capability" title="关闭后对话框不会向该模型发送图片">
              <input
                type="checkbox"
                checked={capability.vision}
                onChange={(event) => setCapability({ vision: event.target.checked })}
              />
              图片
            </label>
            <label className="model-capability" title="音频输入能力；仅在支持音频的接口/模型上使用">
              <input
                type="checkbox"
                checked={capability.audio}
                onChange={(event) => setCapability({ audio: event.target.checked })}
              />
              音频
            </label>
          </div>
          <div className="settings-hint">
            识别依据模型名（如 gpt-4o / claude / gemini / qwen-vl）；识别不准时在这里改。
          </div>
        </div>
      );
    })()}

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

    <details className="settings-details">
      <summary>额外 API Key（可选，限流时自动轮换）</summary>
      <div className="settings-hint">
        主 Key 返回 401 / 403 / 429 / 5xx 时按顺序换用下一个，最多 5 个。
      </div>
      {(active.extraKeys || []).map((key, index) => (
        <div className="settings-inline" key={`extra-${index}`}>
          <input
            className="settings-input"
            type={showKey[`${active.id}:extra`] ? 'text' : 'password'}
            value={key === '__CLEAR__' ? '' : key}
            placeholder={`额外 Key ${index + 1}`}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              const next = [...(active.extraKeys || [])];
              next[index] = event.target.value;
              updatePlatform({ extraKeys: next });
            }}
          />
          <button
            className="mini-btn"
            onClick={() =>
              updatePlatform({
                extraKeys: (active.extraKeys || []).filter((_, item) => item !== index)
              })
            }
          >
            删除
          </button>
        </div>
      ))}
      <div className="settings-inline">
        <button
          className="mini-btn"
          disabled={(active.extraKeys || []).length >= 5}
          onClick={() => updatePlatform({ extraKeys: [...(active.extraKeys || []), ''] })}
        >
          <Plus size={12} />
          添加 Key
        </button>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={showKey[`${active.id}:extra`] === true}
            onChange={() =>
              setShowKey((previous) => ({
                ...previous,
                [`${active.id}:extra`]: !previous[`${active.id}:extra`]
              }))
            }
          />
          显示
        </label>
      </div>
    </details>

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
