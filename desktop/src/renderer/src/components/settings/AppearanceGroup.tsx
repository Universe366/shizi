import type { AppSettings, ThemeMode } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

/** 外观：主题、字号、侧栏与标签栏布局。 */
export function AppearanceGroup({ value, onChange }: Props) {
  return (
    <SettingsSection title="外观" defaultOpen>
      <div className="settings-label">主题</div>
      <select
        className="settings-input"
        value={value.theme}
        onChange={(event) => onChange({ theme: event.target.value as ThemeMode })}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>

      <div className="settings-label">主题色</div>
      <div className="settings-inline">
        <input
          className="settings-color"
          type="color"
          value={value.accentColor || '#4f6f8f'}
          onChange={(event) => onChange({ accentColor: event.target.value })}
        />
        <input
          className="settings-input"
          value={value.accentColor || '#4f6f8f'}
          spellCheck={false}
          onChange={(event) => onChange({ accentColor: event.target.value })}
        />
      </div>

      <div className="settings-label">界面密度</div>
      <select
        className="settings-input"
        value={value.density || 'comfortable'}
        onChange={(event) =>
          onChange({ density: event.target.value as 'comfortable' | 'compact' })
        }
      >
        <option value="comfortable">舒适</option>
        <option value="compact">紧凑</option>
      </select>

      <div className="settings-label">界面字号（{Math.round((value.fontScale || 1) * 100)}%）</div>
      <input
        className="settings-range"
        type="range"
        min={0.8}
        max={1.6}
        step={0.05}
        value={value.fontScale || 1}
        onChange={(event) => onChange({ fontScale: Number(event.target.value) })}
      />

      <div className="settings-label">侧栏宽度（px，也可直接拖动侧栏边缘）</div>
      <input
        className="settings-input"
        type="number"
        min={260}
        max={560}
        step={10}
        value={value.sidebarWidth || 320}
        onChange={(event) =>
          onChange({
            sidebarWidth: Math.min(560, Math.max(260, Number(event.target.value) || 320))
          })
        }
      />

      <div className="settings-label">侧栏位置</div>
      <select
        className="settings-input"
        value={value.sidebarPosition || 'left'}
        onChange={(event) => onChange({ sidebarPosition: event.target.value as 'left' | 'right' })}
      >
        <option value="left">左侧</option>
        <option value="right">右侧</option>
      </select>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.sidebarCollapsed === true}
          onChange={(event) => onChange({ sidebarCollapsed: event.target.checked })}
        />
        折叠侧栏（只保留图标）
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.verticalTabs === true}
          onChange={(event) => onChange({ verticalTabs: event.target.checked })}
        />
        垂直标签栏（标签放在左侧）
      </label>
      {value.verticalTabs === true && (
        <div className="settings-field">
          <div className="settings-label">
            标签栏宽度（{value.verticalTabsWidth ?? 220}px，也可直接拖标签栏右边缘）
          </div>
          <input
            className="settings-range"
            type="range"
            min={160}
            max={360}
            step={10}
            value={Math.min(360, Math.max(160, value.verticalTabsWidth ?? 220))}
            onChange={(event) => onChange({ verticalTabsWidth: Number(event.target.value) })}
          />
        </div>
      )}

      <div className="settings-label">起始页壁纸</div>
      <select
        className="settings-input"
        value={value.startWallpaper || 'aurora'}
        onChange={(event) =>
          onChange({
            startWallpaper: event.target.value as
              | 'aurora'
              | 'midnight'
              | 'paper'
              | 'mint'
              | 'peach'
          })
        }
      >
        <option value="aurora">极光</option>
        <option value="midnight">夜空</option>
        <option value="paper">纸白</option>
        <option value="mint">薄荷</option>
        <option value="peach">蜜桃</option>
      </select>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.startWeather !== false}
          onChange={(event) => onChange({ startWeather: event.target.checked })}
        />
        起始页显示天气（Open-Meteo）
      </label>
      <input
        className="settings-input"
        value={value.startCity || '上海'}
        maxLength={20}
        placeholder="城市，例如 上海"
        onChange={(event) => onChange({ startCity: event.target.value })}
      />

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.startHotSearch !== false}
          onChange={(event) => onChange({ startHotSearch: event.target.checked })}
        />
        起始页显示 B 站热搜
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoStart === true}
          onChange={(event) => onChange({ autoStart: event.target.checked })}
        />
        开机自动启动拾字
      </label>
      <div className="settings-hint">使用系统登录项；关闭后下次启动不再自动运行。</div>

      <details className="settings-advanced">
        <summary>自定义 CSS（高级）</summary>
        <div className="settings-hint">
          会追加到界面样式表末尾，改错可能导致界面错位；清空即可恢复。
        </div>
        <textarea
          className="settings-textarea"
          rows={6}
          spellCheck={false}
          placeholder="例如：.chat-bubble { line-height: 1.7; }"
          value={value.customCss || ''}
          onChange={(event) => onChange({ customCss: event.target.value })}
        />
      </details>
    </SettingsSection>
  );
}
