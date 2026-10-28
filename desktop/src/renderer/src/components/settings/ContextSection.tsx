import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['ai'];
  onChange: (patch: Partial<AppSettings['ai']>) => void;
}

/** 对话上下文：长对话自动压缩较早消息，避免超出模型上下文窗口。 */
export function ContextSection({ value, onChange }: Props) {
  const enabled = value.contextAutoCompress !== false;
  return (
    <SettingsSection title="对话上下文" defaultOpen={false}>
      <div className="settings-hint">
        对话很长时，自动把较早消息压缩成摘要，只保留最近几条，避免超出模型上下文窗口。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ contextAutoCompress: event.target.checked })}
        />
        自动压缩较长对话
      </label>
      {enabled && (
        <>
          <div className="settings-inline">
            <div className="settings-field">
              <div className="settings-label">保留最近消息数</div>
              <input
                className="settings-input"
                type="number"
                min={2}
                max={50}
                value={value.contextKeepRecent}
                onChange={(event) =>
                  onChange({
                    contextKeepRecent: Math.min(
                      50,
                      Math.max(2, Number(event.target.value) || 10)
                    )
                  })
                }
              />
            </div>
            <div className="settings-field">
              <div className="settings-label">触发阈值（估算 tokens）</div>
              <input
                className="settings-input"
                type="number"
                min={2000}
                max={200000}
                step={1000}
                value={value.contextCompressTokens}
                onChange={(event) =>
                  onChange({
                    contextCompressTokens: Math.min(
                      200000,
                      Math.max(2000, Number(event.target.value) || 24000)
                    )
                  })
                }
              />
            </div>
          </div>
          <div className="settings-hint">
            压缩会额外调用一次当前对话模型，摘要按会话缓存，不会每轮重复。
          </div>
        </>
      )}
    </SettingsSection>
  );
}
