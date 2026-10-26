import type { RadialSettings, WheelActionId } from '../../../../shared/types';
import { WHEEL_ACTION_LABELS, WHEEL_ACTION_ORDER } from '../../../../shared/wheelActions';
import { SettingsSection } from './SettingsSection';

/** 鼠标轮盘：全局热键呼出，8 个扇区可自由配置。 */
export function RadialSection({
  value,
  onChange
}: {
  value: RadialSettings;
  onChange: (next: RadialSettings) => void;
}) {
  return (
    <SettingsSection title="快捷轮盘" defaultOpen={false}>
      <div className="settings-hint">
        按热键在窗口中央呼出轮盘，点击扇区或按 1–8 执行；Esc 关闭。参考 StarPie 的 8 方位轮盘。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        启用快捷轮盘
      </label>
      <div className="settings-label">全局热键</div>
      <input
        className="settings-input"
        value={value.hotkey}
        placeholder="Control+Alt+R"
        spellCheck={false}
        onChange={(event) => onChange({ ...value, hotkey: event.target.value })}
      />
      <div className="settings-label">8 个扇区（从正上方开始顺时针）</div>
      <div className="radial-config">
        {Array.from({ length: 8 }).map((_, index) => (
          <label key={index} className="radial-config-row">
            <span>{index + 1}</span>
            <select
              className="settings-input"
              value={value.sectors[index] || 'none'}
              onChange={(event) => {
                const sectors = [...value.sectors];
                sectors[index] = event.target.value as WheelActionId;
                onChange({ ...value, sectors });
              }}
            >
              {WHEEL_ACTION_ORDER.map((action) => (
                <option key={action} value={action}>
                  {WHEEL_ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </SettingsSection>
  );
}
