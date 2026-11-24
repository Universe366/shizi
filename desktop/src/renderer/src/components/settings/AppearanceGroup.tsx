import { Monitor, Moon, Sun } from 'lucide-react';
import type { AppSettings, ThemeMode } from '../../../../shared/types';
import { COLOR_SCHEMES } from '../../../../shared/colorSchemes';
import { SettingsSection } from './SettingsSection';

type General = AppSettings['general'];

interface Props {
  value: General;
  onChange: (patch: Partial<General>) => void;
}

const THEMES: Array<{ id: ThemeMode; label: string; desc: string; icon: typeof Sun }> = [
  { id: 'system', label: '跟随系统', desc: '随 Windows 深浅色切换', icon: Monitor },
  { id: 'light', label: '浅色', desc: '明亮、适合白天', icon: Sun },
  { id: 'dark', label: '深色', desc: '低亮度、适合夜间', icon: Moon }
];

/** 外观：只留主题、强调色、密度。 */
export function AppearanceGroup({ value, onChange }: Props) {
  return (
    <>
      <SettingsSection title="外观" defaultOpen>
        <div className="settings-group-desc">
          只保留真正影响观感的几项：深浅色、强调色、密度。其余交给系统默认。
        </div>

        <div className="settings-label">主题</div>
        <div className="appearance-theme-grid">
          {THEMES.map((theme) => {
            const Icon = theme.icon;
            const active = value.theme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={`appearance-theme-card${active ? ' is-active' : ''}`}
                aria-pressed={active}
                aria-label={`主题：${theme.label}`}
                onClick={() => onChange({ theme: theme.id })}
              >
                <span className={`appearance-theme-preview is-${theme.id}`} aria-hidden>
                  <Icon size={14} />
                </span>
                <span className="appearance-theme-name">{theme.label}</span>
                <span className="appearance-theme-desc">{theme.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="settings-hint">
          深色主题会同时应用到内置网页；浅色/跟随系统同理，不需要单独再开网页深色。
        </div>

        <div className="settings-label">界面配色</div>
        <div className="settings-swatches">
          {COLOR_SCHEMES.filter((scheme) => scheme.id !== 'custom').map((scheme) => {
            const active = (value.colorScheme || 'custom') === scheme.id;
            return (
              <button
                key={scheme.id}
                type="button"
                className={`settings-swatch${active ? ' is-active' : ''}`}
                title={scheme.label}
                onClick={() => onChange({ colorScheme: scheme.id })}
              >
                <span
                  className="settings-swatch-dot"
                  style={{
                    background:
                      scheme.id === 'custom'
                        ? `linear-gradient(135deg, ${scheme.light.accent}, ${scheme.dark.accent})`
                        : scheme.light.accent
                  }}
                />
                <span>{scheme.label}</span>
              </button>
            );
          })}
        </div>

        <div className="settings-label">界面密度</div>
        <div className="appearance-segment">
          {([
            ['comfortable', '舒适'],
            ['compact', '紧凑']
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={(value.density || 'comfortable') === id ? 'is-active' : ''}
              aria-pressed={(value.density || 'comfortable') === id}
              onClick={() => onChange({ density: id })}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={value.verticalTabs === true}
            onChange={(event) => onChange({ verticalTabs: event.target.checked })}
          />
          垂直标签栏（标签放到左侧）
        </label>


      </SettingsSection>

    </>
  );
}
