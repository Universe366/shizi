import { Loader2 } from 'lucide-react';
import type { AiPlatform } from '../../../shared/types';

interface Props {
  platforms: AiPlatform[];
  selection: string[];
  targetCount: number;
  comparing: boolean;
  onToggle: (key: string) => void;
  onRun: () => void;
}

/** 多模型对比选择面板。 */
export function ChatComparePanel({
  platforms,
  selection,
  targetCount,
  comparing,
  onToggle,
  onRun
}: Props) {
  return (
    <div className="chat-compare-panel">
      <div className="settings-hint">
        选 2–3 个平台，用同一个问题并排回答；对比模式不启用 MCP 工具与联网。
      </div>
      <div className="chat-compare-options">
        {platforms
          .filter((platform) => platform.enabled !== false)
          .map((platform) => {
            const models = (platform.models?.length ? platform.models : [platform.model]).filter(
              Boolean
            );
            if (!models.length) return null;
            return (
              <div key={platform.id} className="chat-compare-group">
                <div className="chat-compare-group-title">{platform.name}</div>
                {models.map((model) => {
                  const key = `${platform.id}::${model}`;
                  const legacy = selection.includes(platform.id) && model === platform.model;
                  const checked = selection.includes(key) || legacy;
                  return (
                    <label key={key} className="chat-tool-option" title={model}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selection.length >= 3}
                        onChange={() => onToggle(key)}
                      />
                      <span>{model}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
      </div>
      <button className="mini-btn primary" disabled={targetCount < 2 || comparing} onClick={onRun}>
        {comparing ? <Loader2 size={12} className="spin" /> : null}
        开始对比
      </button>
    </div>
  );
}
