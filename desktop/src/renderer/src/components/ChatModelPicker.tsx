import type { AiPlatform } from '../../../shared/types';
import {
  capabilityKey,
  effectiveContextWindow,
  effectiveModelCapabilities,
  formatContextWindow
} from '../../../shared/modelCapabilities';
import { ProviderBrandIcon } from './settings/ProviderBrandIcon';

export interface ModelRef {
  platformId: string;
  model: string;
}

interface Props {
  platforms: AiPlatform[];
  defaultModel: ModelRef | null;
  modelOverride: ModelRef | null;
  capabilityOverrides: Record<
    string,
    { vision?: boolean; audio?: boolean; contextWindow?: number }
  >;
  currentProfileName?: string;
  currentPlatformName?: string;
  currentModel: string;
  menuOpen: boolean;
  query: string;
  overridePlatform: boolean;
  onToggle: () => void;
  onQuery: (value: string) => void;
  onUseModel: (platformId: string, model: string) => void;
  onClearOverride: () => void;
  onSaveDefault: () => void;
}

/** 对话模型选择器：跨平台模型、搜索、能力标签、临时覆盖与默认模型。 */
export function ChatModelPicker({
  platforms,
  defaultModel,
  modelOverride,
  capabilityOverrides,
  currentProfileName,
  currentPlatformName,
  currentModel,
  menuOpen,
  query,
  overridePlatform,
  onToggle,
  onQuery,
  onUseModel,
  onClearOverride,
  onSaveDefault
}: Props) {
  return (
    <div className="chat-model-picker">
      <button
        type="button"
        className="chat-chip chat-model-chip"
        disabled={Boolean(currentProfileName)}
        title={
          currentProfileName
            ? '当前使用助手档案，模型由档案决定'
            : '选择对话模型（可跨服务商）'
        }
        onClick={onToggle}
      >
        {currentPlatformName || '模型'} · {currentModel || '未选'}
        {modelOverride ? '（临时）' : ''}
      </button>
      {menuOpen && (
        <div className="chat-model-menu">
          <input
            className="settings-input chat-model-search"
            value={query}
            placeholder="搜索模型…"
            spellCheck={false}
            onChange={(event) => onQuery(event.target.value)}
          />
          {platforms
            .filter((platform) => platform.enabled !== false)
            .map((platform) => {
              const models = (platform.models?.length ? platform.models : [platform.model])
                .filter(Boolean)
                .filter((model) =>
                  query.trim() ? model.toLowerCase().includes(query.trim().toLowerCase()) : true
                );
              return (
                <div key={platform.id} className="chat-model-group">
                  <div className="chat-model-group-title">
                    <ProviderBrandIcon
                      name={platform.name}
                      kind={platform.kind}
                      size={12}
                      style={{ marginRight: 4, verticalAlign: '-2px' }}
                    />
                    {platform.name}
                  </div>
                  {models.map((model) => (
                    <button
                      key={model}
                      type="button"
                      className={`chat-model-option${
                        (modelOverride
                          ? platform.id === modelOverride.platformId &&
                            model === modelOverride.model
                          : platform.id === defaultModel?.platformId &&
                            model === defaultModel?.model)
                          ? ' is-active'
                          : ''
                      }`}
                      onClick={() => onUseModel(platform.id, model)}
                    >
                      {model}
                      {(() => {
                        const override = capabilityOverrides[capabilityKey(platform.id, model)];
                        const capability = effectiveModelCapabilities(
                          platform.kind,
                          model,
                          override
                        );
                        const context = formatContextWindow(
                          effectiveContextWindow(model, override?.contextWindow)
                        );
                        return (
                          <>
                            {context && <span className="chat-model-tag">{context}</span>}
                            {capability.vision && <span className="chat-model-tag">图片</span>}
                            {capability.audio && <span className="chat-model-tag">音频</span>}
                            {capability.web && (
                              <span className="chat-model-tag" title="支持模型内置联网">
                                联网
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </button>
                  ))}
                </div>
              );
            })}
          <div className="chat-model-footer">
            {modelOverride && (
              <button type="button" onClick={onClearOverride}>
                跟随默认
              </button>
            )}
            <button
              type="button"
              disabled={!overridePlatform || !modelOverride}
              onClick={onSaveDefault}
            >
              设为全局默认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
