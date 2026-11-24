import type { AppSettings, BrowserToolbarSettings } from '../../../../shared/types';
import { DEFAULT_BROWSER_TOOLBAR } from '../../../../shared/browserToolbar';
import { SettingsSection } from './SettingsSection';

/** 浏览器工具栏：属于浏览器，不属于「外观」。 */
export function BrowserToolbarSection({
  value,
  onChange
}: {
  value: AppSettings['general'];
  onChange: (patch: Partial<AppSettings['general']>) => void;
}) {
  const toolbar: BrowserToolbarSettings = {
    ...DEFAULT_BROWSER_TOOLBAR,
    ...(value.browserToolbar || {})
  };
  const toggle = (key: keyof BrowserToolbarSettings, checked: boolean) =>
    onChange({ browserToolbar: { ...toolbar, [key]: checked } });

  return (
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
              onChange={(event) => toggle(key, event.target.checked)}
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
  );
}
