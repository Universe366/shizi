import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['general']['quickAsk'];
  onChange: (patch: Partial<AppSettings['general']['quickAsk']>) => void;
}

/** 全局快捷取词：任意应用选中文字后热键唤起桌宠。 */
export function QuickAskSection({ value, onChange }: Props) {
  return (
    <SettingsSection title="快捷取词" defaultOpen={false}>
      <div className="settings-hint">
        在任意应用里选中文字后按热键，桌宠会带上这段文字弹出，可继续解释、翻译或提问。
        原理是向当前应用发送一次 Ctrl+C，少数不支持复制的窗口会取不到。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用全局快捷取词
      </label>
      <div className="settings-field">
        <div className="settings-label">热键（Electron 加速键写法）</div>
        <input
          className="settings-input"
          value={value.accelerator}
          placeholder="Control+Alt+X"
          spellCheck={false}
          onChange={(event) => onChange({ accelerator: event.target.value })}
        />
      </div>
      <div className="settings-hint">例：Control+Alt+X、Control+Shift+X；与其它软件冲突时换一个。</div>
    </SettingsSection>
  );
}
