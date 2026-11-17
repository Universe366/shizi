import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { BrowserExtensionStatus } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface ExtensionState {
  enabled: boolean;
  items: BrowserExtensionStatus[];
}

/**
 * 浏览器扩展管理。
 *
 * 扩展直接由 Chromium 加载（session.loadExtension），这里只负责列表、启停、卸载，
 * 以及把加载失败的原因显示出来——修 manifest 或 API 兼容性还得靠用户。
 */
export function BrowserExtensionsSection() {
  const [state, setState] = useState<ExtensionState>({ enabled: true, items: [] });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRemove, setPendingRemove] = useState('');

  const refresh = useCallback(async () => {
    const result = await window.bsub.listBrowserExtensions();
    if (result.ok) {
      setState(result.data);
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

  const add = () =>
    withBusy('add', async () => {
      const result = await window.bsub.addBrowserExtension();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.data) return;
      setNotice(`已添加「${result.data.name}」`);
      await refresh();
    });

  const addArchive = () =>
    withBusy('add-archive', async () => {
      const result = await window.bsub.addBrowserExtensionArchive();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.data) return;
      setNotice(`已安装「${result.data.name}」`);
      await refresh();
    });

  const toggleGlobal = (enabled: boolean) =>
    withBusy('global', async () => {
      const result = await window.bsub.setBrowserExtensionsEnabled(enabled);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setState(result.data);
    });

  const toggleItem = (item: BrowserExtensionStatus) =>
    withBusy(item.id, async () => {
      const result = await window.bsub.toggleBrowserExtension(item.id, !item.enabled);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    });

  const remove = (item: BrowserExtensionStatus) =>
    withBusy(item.id, async () => {
      if (pendingRemove !== item.id) {
        setPendingRemove(item.id);
        return;
      }
      const result = await window.bsub.removeBrowserExtension(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingRemove('');
      setNotice(`已移除「${item.name}」`);
      await refresh();
    });

  const reveal = (item: BrowserExtensionStatus) =>
    withBusy(`reveal-${item.id}`, async () => {
      const result = await window.bsub.revealBrowserExtension(item.id);
      if (!result.ok) setError(result.error);
    });

  const enabledCount = state.items.filter((item) => item.enabled).length;

  return (
    <SettingsSection
      title="浏览器扩展"
      description="加载 Chrome/Edge 扩展（解压目录），扩展只在内置浏览器标签页生效"
      defaultOpen={false}
    >
      <label className="settings-check">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => void toggleGlobal(event.target.checked)}
        />
        启用浏览器扩展
      </label>

      <div className="settings-hint">
        支持 Chrome/Edge 的 MV3 扩展：解压目录，或直接从 .zip / .crx 安装。已启用 {enabledCount} /{' '}
        {state.items.length} 个；扩展跑在内置标签页里，侧栏网页不加载扩展。Chromium 的扩展 API
        并非全部实现（例如侧栏、原生消息、部分声明式规则），扩展管理页会显示加载错误。
      </div>

      <div className="settings-inline">
        <button className="mini-btn" disabled={busy === 'add'} onClick={() => void add()}>
          <Plus size={14} /> 添加扩展目录
        </button>
        <button
          className="mini-btn"
          disabled={busy === 'add-archive'}
          onClick={() => void addArchive()}
        >
          <Plus size={14} /> 从 zip / crx 安装
        </button>
        <button className="mini-btn" disabled={busy === 'refresh'} onClick={() => void withBusy('refresh', refresh)}>
          <RotateCw size={14} /> 刷新状态
        </button>
      </div>

      {error && <div className="settings-hint settings-error">操作失败：{error}</div>}
      {notice && !error && <div className="settings-hint">{notice}</div>}

      {!state.items.length && (
        <div className="settings-hint">
          还没有扩展。在 Chrome/Edge 里找到扩展目录（解压后包含 manifest.json 的文件夹），点「添加扩展目录」。
        </div>
      )}

      {state.items.map((item) => (
        <div key={item.id} className="ext-row">
          <div className="ext-main">
            <div className="ext-name">
              {item.name}
              <span className="ext-badge">MV{item.manifestVersion}</span>
              <span className={`ext-badge${item.loaded ? ' is-on' : ''}`}>
                {item.loaded ? '已加载' : item.enabled ? '未加载' : '已停用'}
              </span>
              {item.version && <span className="ext-badge">v{item.version}</span>}
            </div>
            <div className="ext-path" title={item.path}>
              {item.path}
            </div>
            {item.error && <div className="settings-hint settings-error">{item.error}</div>}
          </div>
          <div className="ext-actions">
            <label className="settings-check">
              <input
                type="checkbox"
                checked={item.enabled}
                disabled={busy === item.id}
                onChange={() => void toggleItem(item)}
              />
              启用
            </label>
            <button
              className="mini-btn"
              disabled={busy === `reveal-${item.id}`}
              onClick={() => void reveal(item)}
              title="在资源管理器里打开"
            >
              <FolderOpen size={14} />
            </button>
            <button
              className={`mini-btn${pendingRemove === item.id ? ' is-danger' : ''}`}
              disabled={busy === item.id}
              onClick={() => void remove(item)}
              title={pendingRemove === item.id ? '再点一次确认删除' : '移除扩展'}
            >
              <Trash2 size={14} />
              {pendingRemove === item.id ? '确认' : ''}
            </button>
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}
