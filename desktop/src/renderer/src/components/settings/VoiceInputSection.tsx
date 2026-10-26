import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['general']['dictation'];
  onChange: (patch: Partial<AppSettings['general']['dictation']>) => void;
}

/** 语音输入：侧栏麦克风 + 全局听写热键。 */
export function VoiceInputSection({ value, onChange }: Props) {
  return (
    <SettingsSection title="语音输入" defaultOpen={false}>
      <div className="settings-hint">
        侧栏对话输入框的麦克风按钮，录一段话自动转成文字；下面的全局听写可以在任意应用里用热键说话。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用全局听写（识别后粘贴到当前前台应用）
      </label>
      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">热键（Electron 加速键写法）</div>
          <input
            className="settings-input"
            value={value.accelerator}
            placeholder="Control+Alt+V"
            spellCheck={false}
            onChange={(event) => onChange({ accelerator: event.target.value })}
          />
        </div>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoPaste}
          onChange={(event) => onChange({ autoPaste: event.target.checked })}
        />
        识别后自动粘贴（关闭则只写入剪贴板）
      </label>
      <div className="settings-hint">
        例：Control+Alt+V、Control+Shift+空格 写成 Control+Shift+Space。与其它软件冲突时换个组合即可。
      </div>
    </SettingsSection>
  );
}
