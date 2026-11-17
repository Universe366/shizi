import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { PluginInfo, PluginMarketItem } from '../../../../shared/plugins';
import { SettingsSection } from './SettingsSection';

/**
 * 应用插件管理（不是浏览器扩展）。
 * 插件是「manifest.json + 静态 UI + 声明式能力」，安装后复制到 userData/plugins。
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRemove, setPendingRemove] = useState('');
  const [url, setUrl] = useState('');
  const [marketUrl, setMarketUrl] = useState('');
  const [marketEntries, setMarketEntries] = useState<PluginMarketItem[]>([]);
  const [marketBusy, setMarketBusy] = useState('');

  const refresh = useCallback(async () => {
    const result = await window.bsub.listPlugins();
    if (result.ok) {
      setPlugins(result.data.plugins);
      setError('');
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshMarket = useCallback(
    async (urlOverride?: string) => {
      setMarketBusy('load');
      try {
        const result = await window.bsub.fetchPluginMarket(urlOverride);
        if (result.ok) {
          setMarketEntries(result.data.entries);
          setError('');
        } else {
          setMarketEntries([]);
          setError(result.error);
        }
      } finally {
        setMarketBusy('');
      }
    },
    []
  );

  useEffect(() => {
    let alive = true;
    void window.bsub.getPluginMarketUrl().then((result) => {
      if (!alive || !result.ok || !result.data) return;
      setMarketUrl(result.data);
      void refreshMarket(result.data);
    });
    return () => {
      alive = false;
    };
  }, [refreshMarket]);

  const withBusy = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error)?.message || String(failure));
    } finally {
      setBusy('');
    }
  };

  const install = () =>
    withBusy('install', async () => {
      const result = await window.bsub.installPlugin();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.data) return;
      setNotice(`已安装「${result.data.name}」，面板已加到侧栏`);
      await refresh();
    });

  const installArchive = () =>
    withBusy('install-archive', async () => {
      const result = await window.bsub.installPluginArchive();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.data) return;
      setNotice(`已安装「${result.data.name}」，面板已加到侧栏`);
      await refresh();
    });

  const installUrl = () =>
    withBusy('install-url', async () => {
      const result = await window.bsub.installPluginUrl(url.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl('');
      setNotice(`已从链接安装「${result.data.name}」`);
      await refresh();
    });

  const saveMarketUrl = () =>
    withBusy('market-url', async () => {
      const result = await window.bsub.setPluginMarketUrl(marketUrl.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.data ? '市场地址已保存' : '已清空市场地址');
      if (result.data) await refreshMarket(result.data);
    });

  const installFromMarket = (entry: PluginMarketItem) =>
    withBusy(`market-${entry.id}`, async () => {
      const result = await window.bsub.installPluginUrl(entry.zip, entry.sha256 || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(`已安装「${result.data.name}」v${result.data.version}`);
      await refresh();
      await refreshMarket();
    });

  const toggle = (plugin: PluginInfo) =>
    withBusy(plugin.id, async () => {
      const result = await window.bsub.togglePlugin(plugin.id, !plugin.enabled);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    });

  const remove = (plugin: PluginInfo) =>
    withBusy(plugin.id, async () => {
      if (pendingRemove !== plugin.id) {
        setPendingRemove(plugin.id);
        return;
      }
      const result = await window.bsub.removePlugin(plugin.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingRemove('');
      setNotice(`已移除「${plugin.name}」`);
      await refresh();
    });

  const reveal = (plugin: PluginInfo) =>
    withBusy(`reveal-${plugin.id}`, async () => {
      const result = await window.bsub.revealPlugin(plugin.id);
      if (!result.ok) setError(result.error);
    });

  return (
    <SettingsSection
      title="插件"
      description="安装第三方插件：manifest + 静态界面，能力按权限申请"
      defaultOpen={false}
    >
      <div className="settings-hint">
        插件是独立目录（manifest.json + 入口页面），安装后复制到本机数据目录；插件界面跑在隔离
        iframe 里，只能调用自己申请过的能力（storage / library.read / page.read / net.fetch /
        tabs.open）。已安装 {plugins.length} 个。
      </div>

      <div className="settings-inline">
        <button className="mini-btn" disabled={busy === 'install'} onClick={() => void install()}>
          <Plus size={14} /> 安装插件目录
        </button>
        <button
          className="mini-btn"
          disabled={busy === 'install-archive'}
          onClick={() => void installArchive()}
        >
          <Plus size={14} /> 从 zip 安装
        </button>
        <button
          className="mini-btn"
          disabled={busy === 'refresh'}
          onClick={() => void withBusy('refresh', refresh)}
        >
          <RotateCw size={14} /> 刷新
        </button>
      </div>

      <div className="settings-inline">
        <input
          className="settings-input"
          placeholder="https://example.com/plugin.zip"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && url.trim()) void installUrl();
          }}
        />
        <button
          className="mini-btn"
          disabled={!url.trim() || busy === 'install-url'}
          onClick={() => void installUrl()}
        >
          从链接安装
        </button>
      </div>

      <div className="settings-hint" style={{ marginTop: 12 }}>
        插件市场：填一个索引 JSON 地址（形如 <code>{'{ "plugins": [...] }'}</code>），可直接安装或更新。
      </div>
      <div className="settings-inline">
        <input
          className="settings-input"
          placeholder="https://example.com/plugins.json"
          value={marketUrl}
          onChange={(event) => setMarketUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && marketUrl.trim()) void saveMarketUrl();
          }}
        />
        <button className="mini-btn" disabled={busy === 'market-url'} onClick={() => void saveMarketUrl()}>
          保存地址
        </button>
        <button
          className="mini-btn"
          disabled={marketBusy === 'load' || !marketUrl.trim()}
          onClick={() => void refreshMarket()}
        >
          刷新市场
        </button>
      </div>

      {marketEntries.map((entry) => {
        const current = Boolean(entry.installedVersion) && !entry.updateAvailable;
        return (
          <div key={entry.id} className="ext-row">
            <div className="ext-main">
              <div className="ext-name">
                {entry.name}
                <span className="ext-badge">v{entry.version}</span>
                {entry.author && <span className="ext-badge">{entry.author}</span>}
                <span className={`ext-badge${current ? ' is-on' : ''}`}>
                  {entry.installedVersion
                    ? entry.updateAvailable
                      ? `已装 v${entry.installedVersion}`
                      : '已安装'
                    : '未安装'}
                </span>
              </div>
              <div className="ext-path">{entry.description || entry.id}</div>
              {entry.tags.length > 0 && <div className="ext-path">{entry.tags.join(' · ')}</div>}
              {entry.minAppVersion && (
                <div className="ext-path">需要拾字 ≥ {entry.minAppVersion}</div>
              )}
              {!entry.compatible && (
                <div className="settings-hint settings-error">当前版本过低，无法安装</div>
              )}
            </div>
            <div className="ext-actions">
              <button
                className="mini-btn"
                disabled={current || !entry.compatible || busy === `market-${entry.id}`}
                onClick={() => void installFromMarket(entry)}
              >
                {!entry.compatible
                  ? '版本不兼容'
                  : entry.updateAvailable
                    ? '更新'
                    : current
                      ? '已安装'
                      : '安装'}
              </button>
            </div>
          </div>
        );
      })}

      {error && <div className="settings-hint settings-error">操作失败：{error}</div>}
      {notice && !error && <div className="settings-hint">{notice}</div>}

      {!plugins.length && (
        <div className="settings-hint">
          还没有插件。插件需要包含 manifest.json，并声明 contributes.panels 或
          contributes.commands。
        </div>
      )}

      {plugins.map((plugin) => (
        <div key={plugin.id} className="ext-row">
          <div className="ext-main">
            <div className="ext-name">
              {plugin.name}
              <span className="ext-badge">v{plugin.version}</span>
              <span className={`ext-badge${plugin.enabled && !plugin.error ? ' is-on' : ''}`}>
                {plugin.error ? '异常' : plugin.enabled ? '已启用' : '已停用'}
              </span>
              {plugin.author && <span className="ext-badge">{plugin.author}</span>}
            </div>
            <div className="ext-path">{plugin.description || plugin.id}</div>
            <div className="ext-path">
              面板 {plugin.panels.length} · 命令 {plugin.commands.length} · 权限{' '}
              {plugin.permissions.length ? plugin.permissions.join(', ') : '无'}
            </div>
            {plugin.error && <div className="settings-hint settings-error">{plugin.error}</div>}
          </div>
          <div className="ext-actions">
            <label className="settings-check">
              <input
                type="checkbox"
                checked={plugin.enabled}
                disabled={busy === plugin.id}
                onChange={() => void toggle(plugin)}
              />
              启用
            </label>
            <button
              className="mini-btn"
              disabled={busy === `reveal-${plugin.id}`}
              onClick={() => void reveal(plugin)}
              title="在资源管理器里打开"
            >
              <FolderOpen size={14} />
            </button>
            <button
              className={`mini-btn${pendingRemove === plugin.id ? ' is-danger' : ''}`}
              disabled={busy === plugin.id}
              onClick={() => void remove(plugin)}
              title={pendingRemove === plugin.id ? '再点一次确认删除' : '移除插件'}
            >
              <Trash2 size={14} />
              {pendingRemove === plugin.id ? '确认' : ''}
            </button>
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}
