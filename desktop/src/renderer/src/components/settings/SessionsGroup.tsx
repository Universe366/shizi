import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 标签页与会话：恢复会话、后台休眠、关闭行为。 */
export function SessionsGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="标签页与会话" defaultOpen>
      <div className="settings-hint">
        启动行为（起始页 / 恢复上次会话 / 指定网页）已统一到「通用 → 启动与主页」。
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.closeToTray !== false}
          onChange={(event) => onChange({ closeToTray: event.target.checked })}
        />
        关闭窗口时缩到托盘
      </label>

      <div className="settings-label">后台标签休眠（分钟）</div>
      <input
        className="settings-input"
        type="number"
        min={1}
        max={120}
        value={value.suspendMinutes}
        onChange={(event) => onChange({ suspendMinutes: Number(event.target.value) || 5 })}
      />
      <div className="settings-hint">1–120 分钟；正在出声的标签不会被回收。</div>
    </SettingsSection>
  );
}
