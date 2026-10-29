import { useEffect, useState } from 'react';
import type { AppSettings } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['general'];
  onChange: (patch: Partial<AppSettings['general']>) => void;
}

/** 网络代理：影响内置浏览器、AI 与联网检索。 */
export function GeneralGroup({ value, onChange }: Props) {
  const proxy = value.proxy || { mode: 'system', url: '', bypass: '' };
  const patch = (next: Partial<AppSettings['general']['proxy']>) =>
    onChange({ proxy: { ...proxy, ...next } });

  const [defaultBrowser, setDefaultBrowser] = useState<{ isDefault: boolean } | null>(null);
  const [defaultNotice, setDefaultNotice] = useState('');
  const [defaultBusy, setDefaultBusy] = useState(false);

  useEffect(() => {
    void window.bsub?.defaultBrowserStatus?.().then((response) => {
      if (response?.ok) setDefaultBrowser(response.data);
    });
  }, []);

  const makeDefault = async () => {
    setDefaultBusy(true);
    setDefaultNotice('');
    try {
      const response = await window.bsub?.setDefaultBrowser?.();
      if (!response) {
        setDefaultNotice('当前版本不支持设置默认浏览器');
        return;
      }
      if (!response.ok) {
        setDefaultNotice(response.error);
        return;
      }
      setDefaultBrowser({ isDefault: response.data.isDefault });
      setDefaultNotice(
        response.data.isDefault
          ? '已设为默认浏览器'
          : response.data.settingsOpened
            ? '已注册协议，请在 Windows 默认应用里选择「拾字」'
            : '已注册 http/https 协议'
      );
    } finally {
      setDefaultBusy(false);
    }
  };

  return (
    <>
    <SettingsSection title="默认浏览器" defaultOpen>
      <div className="settings-group-desc">
        把拾字注册为 http / https 链接的处理程序。Windows 10/11 受系统保护，
        会打开「默认应用」设置，需要手动选择「拾字」；macOS / Linux 由系统确认。
      </div>
      <div className="settings-inline">
        <span className="settings-hint">
          当前：{defaultBrowser?.isDefault ? '已是默认浏览器' : '不是默认浏览器'}
        </span>
        <button
          className="mini-btn primary"
          disabled={defaultBusy}
          onClick={() => void makeDefault()}
        >
          {defaultBusy ? '设置中…' : '设为默认浏览器'}
        </button>
      </div>
      {defaultNotice && <div className="settings-hint">{defaultNotice}</div>}
    </SettingsSection>

    <SettingsSection title="网络代理" defaultOpen>
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
    </>
  );
}
