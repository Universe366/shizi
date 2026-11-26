import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, DefaultBrowserStatus } from '../../../../shared/types';
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

  const [defaultBrowser, setDefaultBrowser] = useState<DefaultBrowserStatus | null>(null);
  const [defaultNotice, setDefaultNotice] = useState('');
  const [defaultBusy, setDefaultBusy] = useState(false);

  const refreshDefaultBrowser = useCallback(() => {
    void window.bsub?.defaultBrowserStatus?.().then((response) => {
      if (response?.ok) setDefaultBrowser(response.data);
    });
  }, []);

  useEffect(() => {
    refreshDefaultBrowser();
    // 用户从系统「默认应用」回来后刷新一次，和 Chrome/Edge 一样以系统状态为准。
    const onFocus = () => refreshDefaultBrowser();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDefaultBrowser]);

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
      setDefaultBrowser(response.data.status);
      if (response.data.status.isDefault) {
        setDefaultNotice('拾字已是默认浏览器');
      } else if (response.data.settingsOpened) {
        setDefaultNotice('已登记到「默认应用」，请在打开的设置里选中「拾字」');
      } else {
        setDefaultNotice('已登记到「默认应用」，但没能自动打开系统设置');
      }
    } finally {
      setDefaultBusy(false);
    }
  };

  const openDefaultApps = async () => {
    if (!window.bsub?.openDefaultApps) {
      await makeDefault();
      return;
    }
    setDefaultBusy(true);
    setDefaultNotice('');
    try {
      const response = await window.bsub.openDefaultApps();
      if (!response.ok) {
        setDefaultNotice(response.error);
        return;
      }
      setDefaultNotice(
        response.data.opened
          ? '已打开系统「默认应用」，选中「拾字」即可'
          : '没能自动打开系统设置，请手动打开「设置 → 应用 → 默认应用」'
      );
      refreshDefaultBrowser();
    } finally {
      setDefaultBusy(false);
    }
  };

  const statusText = !defaultBrowser
    ? '检测中…'
    : defaultBrowser.isDefault
      ? '拾字已是默认浏览器'
      : defaultBrowser.currentDefault
        ? `系统当前默认：${defaultBrowser.currentDefault}`
        : '拾字还不是默认浏览器';

  return (
    <>
    <SettingsSection title="启动与主页" defaultOpen>
      <div className="settings-group-desc">
        启动拾字时打开什么，以及地址栏「主页」按钮去哪里。启动行为下次启动生效。
      </div>
      <div className="settings-inline">
        <select
          className="settings-input"
          value={value.startupMode || 'restore'}
          onChange={(event) =>
            onChange({ startupMode: event.target.value as 'start' | 'restore' | 'url' })
          }
        >
          <option value="restore">恢复上次会话</option>
          <option value="start">打开起始页</option>
          <option value="url">打开指定网页</option>
        </select>
      </div>
      {value.startupMode === 'url' && (
        <>
          <div className="settings-label">启动网址</div>
          <input
            className="settings-input"
            value={value.startupUrl || ''}
            placeholder="https://www.bilibili.com/"
            spellCheck={false}
            onChange={(event) => onChange({ startupUrl: event.target.value })}
          />
        </>
      )}
      <div className="settings-label">主页按钮网址</div>
      <input
        className="settings-input"
        value={value.homeUrl || ''}
        placeholder="留空 = 起始页"
        spellCheck={false}
        onChange={(event) => onChange({ homeUrl: event.target.value })}
      />
      <div className="settings-hint">
        主页按钮在地址栏右侧，可在「外观与浏览器 → 浏览器工具栏」里隐藏。
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.downloadNotify !== false}
          onChange={(event) => onChange({ downloadNotify: event.target.checked })}
        />
        下载完成后弹系统通知
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.autoStart === true}
          onChange={(event) => onChange({ autoStart: event.target.checked })}
        />
        开机自动启动拾字
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.bilibiliCompat === true}
          onChange={(event) => onChange({ bilibiliCompat: event.target.checked })}
        />
        B 站兼容模式：播放时隐藏控制条（缓解点击延迟，重开标签生效）
      </label>

    </SettingsSection>

    <SettingsSection title="默认浏览器" defaultOpen>
      <div className="settings-group-desc">
        Windows 10/11 不允许程序直接修改默认浏览器，只能先把拾字登记到系统「默认应用」，
        再打开设置由你确认。点下面的按钮后，在列表里选中「拾字」并「设为默认」即可。
      </div>
      <div className="settings-inline">
        <span className="settings-hint">{statusText}</span>
        {defaultBrowser && !defaultBrowser.registered && (
          <span className="settings-hint">· 尚未登记到默认应用</span>
        )}
      </div>
      <div className="settings-inline">
        <button
          className="mini-btn primary"
          disabled={defaultBusy}
          onClick={() => void makeDefault()}
        >
          {defaultBusy ? '设置中…' : '设为默认浏览器'}
        </button>
        {defaultBrowser?.platform === 'win32' && (
          <button className="mini-btn" disabled={defaultBusy} onClick={() => void openDefaultApps()}>
            打开系统默认应用
          </button>
        )}
      </div>
      {defaultNotice && <div className="settings-hint">{defaultNotice}</div>}
      <div className="settings-hint">
        从系统设置回来后状态会自动刷新；如果列表里没有「拾字」，再点一次「设为默认浏览器」重新登记。
      </div>
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
