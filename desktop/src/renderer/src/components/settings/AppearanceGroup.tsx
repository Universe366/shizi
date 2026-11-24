import { Monitor, Moon, Sun } from 'lucide-react';
import type { AppSettings, BrowserToolbarSettings, ThemeMode } from '../../../../shared/types';
import { COLOR_SCHEMES } from '../../../../shared/colorSchemes';
import { DEFAULT_BROWSER_TOOLBAR } from '../../../../shared/browserToolbar';
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

/** 外观：主题、配色、布局与工具栏。默认只露出常用项，细节收进折叠区。 */
export function AppearanceGroup({ value, onChange }: Props) {
  const toolbar: BrowserToolbarSettings = { ...DEFAULT_BROWSER_TOOLBAR, ...(value.browserToolbar || {}) };
  const toggleToolbar = (key: keyof BrowserToolbarSettings, checked: boolean) =>
    onChange({ browserToolbar: { ...toolbar, [key]: checked } });

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


        <details className="settings-advanced">
          <summary>起始页外观</summary>
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
        </details>
      </SettingsSection>

      <SettingsSection title="浏览器工具栏" defaultOpen={false}>
        <div className="settings-group-desc">
          选择地址栏上显示的按钮；主菜单和设置至少保留一个入口。
        </div>
        <div className="settings-check-grid">
          {([
            ['back', '后退'],
            ['forward', '前进'],
            ['reload', '刷新'],
            ['engine', '搜索引擎切换'],
            ['speed', '播放倍速'],
            ['zoom', '缩放百分比'],
            ['bookmark', '收藏'],
            ['startFavorite', '添加到起始页'],
            ['library', '工作台'],
            ['home', '主页'],
            ['downloads', '下载'],
            ['dark', '网页深色模式'],
            ['settings', '设置'],
            ['menu', '主菜单']
          ] as Array<[keyof BrowserToolbarSettings, string]>).map(([key, label]) => (
            <label className="settings-check" key={key}>
              <input
                type="checkbox"
                checked={toolbar[key]}
                onChange={(event) => toggleToolbar(key, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="settings-inline">
          <label className="settings-check">
            <input
              type="checkbox"
              checked={value.bookmarkBar !== false}
              onChange={(event) => onChange({ bookmarkBar: event.target.checked })}
            />
            显示书签栏（地址栏下方）
          </label>
        </div>
        <div className="settings-inline">
          <button
            className="mini-btn"
            onClick={() => onChange({ browserToolbar: { ...DEFAULT_BROWSER_TOOLBAR } })}
          >
            恢复默认工具栏
          </button>
        </div>
      </SettingsSection>
    </>
  );
}
