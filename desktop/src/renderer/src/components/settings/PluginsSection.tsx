import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { PluginInfo } from '../../../../shared/plugins';
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
          disabled={busy === 'refresh'}
          onClick={() => void withBusy('refresh', refresh)}
        >
          <RotateCw size={14} /> 刷新
        </button>
      </div>

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
