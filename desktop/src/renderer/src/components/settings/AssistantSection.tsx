import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { AiPlatform, AppSettings, AssistantProfile, McpToolOption, SkillItem } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['ai'];
  skills: SkillItem[];
  platforms: AiPlatform[];
  updateAi: (patch: Partial<AppSettings['ai']>) => void;
}

function newProfile(): AssistantProfile {
  return {
    id: `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: '新助手',
    icon: '🤖',
    description: '',
    prompt: '',
    platformId: '',
    model: '',
    skillIds: [],
    toolMode: 'all',
    toolIds: [],
    web: false,
    temperature: null,
    maxTokens: null
  };
}

/** 助手档案：提示词 + 模型 + 技能 + MCP 工具 + 联网，一次套用到对话。 */
export function AssistantSection({ value, skills, platforms, updateAi }: Props) {
  const profiles = value.profiles || [];
  const [tools, setTools] = useState<McpToolOption[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);

  const loadTools = async () => {
    setLoadingTools(true);
    try {
      const response = await window.bsub.mcpAllTools();
      if (response.ok) setTools(response.data);
    } finally {
      setLoadingTools(false);
    }
  };

  useEffect(() => {
    // 只有已经在用「手动勾选工具」的档案才自动拉取，避免每次开设置都启动本地 MCP 进程。
    if (profiles.some((profile) => profile.toolMode === 'custom')) {
      void loadTools();
    }
    // 仅首次挂载
  }, []);

  const patchProfile = (id: string, patch: Partial<AssistantProfile>) => {
    updateAi({
      profiles: profiles.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile
      )
    });
  };

  const removeProfile = (id: string) => {
    updateAi({ profiles: profiles.filter((profile) => profile.id !== id) });
  };

  return (
    <SettingsSection title="助手档案" defaultOpen={false}>
      <div className="settings-hint">
        把「提示词 + 模型 + 技能 + 工具 + 联网」存成档案；在对话输入框的工具栏选择后一次生效。
      </div>
      <div className="settings-inline">
        <button
          className="mini-btn"
          onClick={() => updateAi({ profiles: [...profiles, newProfile()] })}
        >
          <Plus size={12} /> 新增助手
        </button>
        <button className="mini-btn" disabled={loadingTools} onClick={() => void loadTools()}>
          {loadingTools ? <Loader2 size={12} className="spin" /> : null}
          刷新 MCP 工具
        </button>
      </div>

      {!profiles.length && (
        <div className="settings-hint">还没有助手档案。新建一个后，可在对话输入框的「+」里选择。</div>
      )}

      {profiles.map((profile) => (
        <div key={profile.id} className="assistant-card">
          <div className="settings-inline">
            <input
              className="settings-input assistant-icon"
              value={profile.icon}
              maxLength={4}
              title="图标（emoji 或短字符）"
              onChange={(event) => patchProfile(profile.id, { icon: event.target.value })}
            />
            <input
              className="settings-input"
              value={profile.name}
              onChange={(event) => patchProfile(profile.id, { name: event.target.value })}
            />
            <button className="mini-btn" onClick={() => removeProfile(profile.id)}>
              <Trash2 size={12} />
            </button>
          </div>

          <input
            className="settings-input"
            placeholder="一句话描述（可选）"
            value={profile.description}
            onChange={(event) => patchProfile(profile.id, { description: event.target.value })}
          />

          <div className="settings-label">提示词</div>
          <textarea
            className="settings-textarea"
            rows={4}
            placeholder="例如：只依据字幕回答，先给结论，再列依据，引用时带 [mm:ss]。"
            value={profile.prompt}
            onChange={(event) => patchProfile(profile.id, { prompt: event.target.value })}
          />

          <div className="settings-inline">
            <div className="settings-field">
              <div className="settings-label">平台</div>
              <select
                className="settings-input"
                value={profile.platformId}
                onChange={(event) =>
                  patchProfile(profile.id, { platformId: event.target.value })
                }
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
              <div className="settings-label">模型</div>
              <input
                className="settings-input"
                placeholder="留空用平台默认"
                value={profile.model}
                spellCheck={false}
                onChange={(event) => patchProfile(profile.id, { model: event.target.value })}
              />
            </div>
          </div>

          <div className="settings-inline">
            <div className="settings-field">
              <div className="settings-label">温度（留空用全局）</div>
              <input
                className="settings-input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={profile.temperature ?? ''}
                onChange={(event) =>
                  patchProfile(profile.id, {
                    temperature: event.target.value === '' ? null : Number(event.target.value)
                  })
                }
              />
            </div>
            <div className="settings-field">
              <div className="settings-label">最大 token（留空用全局）</div>
              <input
                className="settings-input"
                type="number"
                min={256}
                max={64000}
                step={256}
                value={profile.maxTokens ?? ''}
                onChange={(event) =>
                  patchProfile(profile.id, {
                    maxTokens: event.target.value === '' ? null : Number(event.target.value)
                  })
                }
              />
            </div>
          </div>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={profile.web}
              onChange={(event) => patchProfile(profile.id, { web: event.target.checked })}
            />
            本轮强制联网
          </label>

          <div className="settings-inline">
            <div className="settings-field">
              <div className="settings-label">MCP 工具</div>
              <select
                className="settings-input"
                value={profile.toolMode}
                onChange={(event) => {
                  const mode = event.target.value as AssistantProfile['toolMode'];
                  patchProfile(profile.id, { toolMode: mode });
                  if (mode === 'custom' && !tools.length) void loadTools();
                }}
              >
                <option value="all">全部可用工具</option>
                <option value="none">不用 MCP</option>
                <option value="custom">只用手动勾选的</option>
              </select>
            </div>
          </div>

          {profile.toolMode === 'custom' && (
            <div className="assistant-tool-list">
              {!tools.length && (
                <div className="settings-hint">
                  没有 MCP 工具；先在「插件与集成 → MCP」添加服务。
                </div>
              )}
              {tools.map((tool) => (
                <label key={tool.id} className="settings-check" title={tool.description}>
                  <input
                    type="checkbox"
                    checked={profile.toolIds.includes(tool.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...profile.toolIds, tool.id]
                        : profile.toolIds.filter((id) => id !== tool.id);
                      patchProfile(profile.id, { toolIds: next });
                    }}
                  />
                  {tool.serverName} · {tool.name}
                </label>
              ))}
            </div>
          )}

          {skills.length > 0 && (
            <details className="settings-advanced">
              <summary>技能（{profile.skillIds.length}）</summary>
              {skills.map((skill) => (
                <label key={skill.id} className="settings-check">
                  <input
                    type="checkbox"
                    checked={profile.skillIds.includes(skill.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...profile.skillIds, skill.id]
                        : profile.skillIds.filter((id) => id !== skill.id);
                      patchProfile(profile.id, { skillIds: next });
                    }}
                  />
                  {skill.icon || '✨'} {skill.name}
                </label>
              ))}
            </details>
          )}
        </div>
      ))}
    </SettingsSection>
  );
}
