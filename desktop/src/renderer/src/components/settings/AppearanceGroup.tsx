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

const LAYOUT_PRESETS: Array<{
  id: string;
  label: string;
  desc: string;
  patch: Partial<General>;
}> = [
  {
    id: 'compact',
    label: '紧凑',
    desc: '更多内容，适合小屏',
    patch: { density: 'compact', fontScale: 0.95, sidebarWidth: 280, verticalTabsWidth: 160 }
  },
  {
    id: 'standard',
    label: '标准',
    desc: '默认比例',
    patch: { density: 'comfortable', fontScale: 1, sidebarWidth: 300, verticalTabsWidth: 180 }
  },
  {
    id: 'relaxed',
    label: '宽松',
    desc: '更大字号与留白',
    patch: { density: 'comfortable', fontScale: 1.08, sidebarWidth: 340, verticalTabsWidth: 200 }
  }
];

/** 外观：主题、配色、布局与工具栏。默认只露出常用项，细节收进折叠区。 */
export function AppearanceGroup({ value, onChange }: Props) {
  const toolbar: BrowserToolbarSettings = { ...DEFAULT_BROWSER_TOOLBAR, ...(value.browserToolbar || {}) };
  const toggleToolbar = (key: keyof BrowserToolbarSettings, checked: boolean) =>
    onChange({ browserToolbar: { ...toolbar, [key]: checked } });

  const sidebarWidth = value.sidebarWidth || 300;
  const tabWidth = value.verticalTabsWidth ?? 180;
  const activePreset = LAYOUT_PRESETS.find(
    (preset) =>
      preset.patch.density === (value.density || 'comfortable') &&
      Math.abs(Number(preset.patch.fontScale) - Number(value.fontScale || 1)) < 0.001 &&
      Math.abs(Number(preset.patch.sidebarWidth) - sidebarWidth) < 1 &&
      Math.abs(Number(preset.patch.verticalTabsWidth) - tabWidth) < 1
  );

  return (
    <>
      <SettingsSection title="外观" defaultOpen>
        <div className="settings-group-desc">
          通常只需要选一个主题、一个布局预设；细节都收在下面的折叠区里。
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
          {COLOR_SCHEMES.map((scheme) => {
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

        {(value.colorScheme || 'custom') === 'custom' && (
          <>
            <div className="settings-label">自定义主题色</div>
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
          </>
        )}

        <div className="settings-label">布局预设</div>
        <div className="appearance-preset-grid">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`appearance-preset${activePreset?.id === preset.id ? ' is-active' : ''}`}
              aria-pressed={activePreset?.id === preset.id}
              onClick={() => onChange(preset.patch)}
            >
              <span className="appearance-preset-name">{preset.label}</span>
              <span className="appearance-preset-desc">{preset.desc}</span>
            </button>
          ))}
        </div>

        <div className="settings-label">侧栏宽度（{sidebarWidth}px，也可直接拖动侧栏边缘）</div>
        <input
          className="settings-range"
          type="range"
          min={240}
          max={480}
          step={10}
          aria-label="侧栏宽度"
          value={Math.min(480, Math.max(240, sidebarWidth))}
          onChange={(event) => onChange({ sidebarWidth: Number(event.target.value) })}
        />

        <div className="settings-label">侧栏位置</div>
        <div className="appearance-segment">
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={value.sidebarPosition === side ? 'is-active' : ''}
              aria-pressed={value.sidebarPosition === side}
              aria-label={`侧栏位置：${side === 'left' ? '左侧' : '右侧'}`}
              onClick={() => onChange({ sidebarPosition: side })}
            >
              {side === 'left' ? '左侧' : '右侧'}
            </button>
          ))}
        </div>

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
              标签栏宽度（{tabWidth}px，也可直接拖标签栏右边缘）
            </div>
            <input
              className="settings-range"
              type="range"
              min={140}
              max={320}
              step={10}
              aria-label="标签栏宽度"
              value={Math.min(320, Math.max(140, tabWidth))}
              onChange={(event) => onChange({ verticalTabsWidth: Number(event.target.value) })}
            />
          </div>
        )}

        <div className="settings-label">界面字号（{Math.round((value.fontScale || 1) * 100)}%）</div>
        <input
          className="settings-range"
          type="range"
          min={0.8}
          max={1.6}
          step={0.05}
          aria-label="界面字号"
          value={value.fontScale || 1}
          onChange={(event) => onChange({ fontScale: Number(event.target.value) })}
        />

        <details className="settings-advanced">
          <summary>细节调整</summary>
          <div className="settings-label">界面圆角（{value.uiRadius ?? 14}px）</div>
          <input
            className="settings-range"
            type="range"
            min={6}
            max={24}
            step={1}
            aria-label="界面圆角"
            value={value.uiRadius ?? 14}
            onChange={(event) => onChange({ uiRadius: Number(event.target.value) })}
          />

          <label className="settings-check">
            <input
              type="checkbox"
              checked={value.uiGlass !== false}
              onChange={(event) => onChange({ uiGlass: event.target.checked })}
            />
            毛玻璃面板（半透明 + 背景模糊）
          </label>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={value.uiMotion !== false}
              onChange={(event) => onChange({ uiMotion: event.target.checked })}
            />
            界面动效（关闭后减少过渡与呼吸动画）
          </label>

          <div className="settings-hint">
            自定义 CSS 会追加到界面样式表末尾，改错可能导致界面错位；清空即可恢复。
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

        <details className="settings-advanced">
          <summary>起始页与启动</summary>
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

      <SettingsSection title="站点缩放" defaultOpen={false}>
        <div className="settings-group-desc">
          各站点记住的缩放比例；清除后会回到 100%。
        </div>
        {Object.keys(value.siteZoom || {}).length === 0 ? (
          <div className="settings-hint">还没有记住任何站点。</div>
        ) : (
          <div className="site-zoom-list">
            {Object.entries(value.siteZoom || {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([host, zoom]) => (
                <div className="site-zoom-row" key={host}>
                  <span title={host}>{host}</span>
                  <span>{Math.round(Number(zoom) * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...(value.siteZoom || {}) };
                      delete next[host];
                      onChange({ siteZoom: next });
                    }}
                  >
                    清除
                  </button>
                </div>
              ))}
          </div>
        )}
        {Object.keys(value.siteZoom || {}).length > 0 && (
          <button
            type="button"
            className="settings-inline"
            onClick={() => onChange({ siteZoom: {} })}
          >
            清除全部站点缩放
          </button>
        )}
      </SettingsSection>

      <SettingsSection title="站点深色例外" defaultOpen={false}>
        <div className="settings-group-desc">
          这些站点不会跟随程序的网页深色模式；可随时恢复。
        </div>
        {(value.siteDarkDisabled || []).length === 0 ? (
          <div className="settings-hint">所有站点都跟随程序深色模式。</div>
        ) : (
          <div className="site-zoom-list">
            {(value.siteDarkDisabled || []).map((host) => (
              <div className="site-zoom-row" key={host}>
                <span title={host}>{host}</span>
                <span>深色关闭</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      siteDarkDisabled: (value.siteDarkDisabled || []).filter(
                        (item) => item !== host
                      )
                    })
                  }
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
        {(value.siteDarkDisabled || []).length > 0 && (
          <button
            type="button"
            className="settings-inline"
            onClick={() => onChange({ siteDarkDisabled: [] })}
          >
            全部恢复深色
          </button>
        )}
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
            ['startFavorite', '收藏到起始页'],
            ['library', '工作台'],
            ['home', '起始页'],
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
