import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['general'];
  onChange: (patch: Partial<AppSettings['general']>) => void;
}

/** 通用：网络代理。影响内置浏览器、AI 与联网检索。 */
export function GeneralGroup({ value, onChange }: Props) {
  const proxy = value.proxy || { mode: 'system', url: '', bypass: '' };
  const patch = (next: Partial<AppSettings['general']['proxy']>) =>
    onChange({ proxy: { ...proxy, ...next } });

  return (
    <SettingsSection title="通用" defaultOpen>
      <div className="settings-group">
        <div className="settings-group-title">网络代理</div>
        <div className="settings-group-desc">
          影响内置浏览器、AI 请求与联网检索。改完立即生效，不需要重启。
        </div>
        <div className="settings-inline">
          <select
            className="settings-input"
            value={proxy.mode}
            onChange={(event) =>
              patch({ mode: event.target.value as 'system' | 'custom' | 'none' })
            }
          >
            <option value="system">跟随系统代理</option>
            <option value="custom">自定义代理</option>
            <option value="none">不使用代理（直连）</option>
          </select>
        </div>
        {proxy.mode === 'custom' && (
          <>
            <div className="settings-label">代理地址</div>
            <input
              className="settings-input"
              value={proxy.url}
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
              spellCheck={false}
              onChange={(event) => patch({ url: event.target.value })}
            />
            <div className="settings-label">绕过代理</div>
            <input
              className="settings-input"
              value={proxy.bypass}
              placeholder="localhost,127.0.0.1,::1"
              spellCheck={false}
              onChange={(event) => patch({ bypass: event.target.value })}
            />
          </>
        )}
        <div className="settings-hint">
          常见报错「连接超时 / API 请求失败」先检查这里：开了加速器但选「直连」会连不上。
        </div>
      </div>
    </SettingsSection>
  );
}
